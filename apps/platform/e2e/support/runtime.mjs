import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { startPostgres } from "../../../../scripts/e2e/postgres.mjs";
import {
  openTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from "./database.mjs";
import { startCoordinator } from "./coordinator.mjs";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
export async function startRuntime() {
  const artifactDir = await mkdtemp(join(tmpdir(), "agentcaller-e2e-"));
  const pg = await startPostgres();
  let coordinator, child, sql;
  const stop = async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await coordinator?.stop();
    await sql?.end({ timeout: 2 });
    pg.stop();
    await rm(artifactDir, { recursive: true, force: true });
  };
  try {
    sql = openTestDatabase(pg.url);
    await migrateTestDatabase(sql);
    await resetTestDatabase(sql);
    const port = await freePort();
    const appUrl = "http://localhost:" + port;
    coordinator = await startCoordinator(appUrl);
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: "C.UTF-8",
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: pg.url,
      NEXT_PUBLIC_APP_URL: appUrl,
      SUPABASE_URL: coordinator.origin,
      SUPABASE_PUBLISHABLE_KEY: "e2e-publishable",
      E2E_CONTROL_URL: coordinator.origin,
      E2E_CONTROL_TOKEN: coordinator.token,
      E2E_OUTPUT_DIR: artifactDir,
      API_KEY_PEPPER: "e2e-api-pepper-000000000000000000000000",
      CRON_SECRET: "e2e-cron-secret-0000000000000000000000",
      AGENT_CALLBACK_SECRET: "e2e-worker-secret-00000000000000000000",
      BILLING_SETUP_TOKEN_SECRET: "e2e-billing-token-000000000000000000000",
      STRIPE_SECRET_KEY: "sk_test_e2e",
      STRIPE_WEBHOOK_SECRET: "whsec_e2e-signing-secret",
      STRIPE_PRICING_VERSION: "e2e-v1",
      STRIPE_BILLING_ENABLED: "true",
      MCP_ENABLED: "true",
      LIVEKIT_URL: coordinator.origin,
      LIVEKIT_API_KEY: "e2e",
      LIVEKIT_API_SECRET: "e2e",
      LIVEKIT_AGENT_EU: "e2e-eu",
      LIVEKIT_AGENT_US: "e2e-us",
      CONNECT_OPERATOR_CALLS_ENABLED: "false",
      PLATFORM_URL: appUrl,
      LIVEKIT_SIP_TRUNK_EU: "e2e-trunk",
      CONNECT_CALLER_ID_ES: "+34911234560",
      CONNECT_CALLER_ID_IT: "+39061234560",
      CONNECT_CALLBACK_CALLER_ID: "+34911234561",
    };
    const preload = fileURLToPath(
      new URL("./server-preload.mjs", import.meta.url),
    );
    let output = "";
    child = spawn(
      process.execPath,
      [
        "--import",
        preload,
        fileURLToPath(import.meta.resolve("next/dist/bin/next")),
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    // Keep only bounded, redacted diagnostics; never persist request URLs with setup tokens.
    const collect = (chunk) => {
      output = (
        output +
        chunk
          .toString()
          .replace(/([?&](?:request|code)=)[^\s&]+/g, "$1[redacted]")
      ).slice(-6000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const deadline = Date.now() + 90_000;
    while (true) {
      if (child.exitCode !== null)
        throw new Error("E2E Next process exited: " + output);
      try {
        const response = await fetch(appUrl + "/robots.txt", {
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) break;
      } catch {}
      if (Date.now() > deadline)
        throw new Error("E2E Next readiness timed out: " + output);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { env, appUrl, coordinator, sql, stop, diagnostics: () => output };
  } catch (error) {
    await stop();
    throw error;
  }
}
