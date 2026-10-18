import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export function schedulerSecret(
  env = process.env,
  file = new URL("../apps/platform/.env.local", import.meta.url),
) {
  let fileEnv = {};
  try {
    if (env.CRON_SECRET === undefined)
      fileEnv = parseEnv(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const secret = env.CRON_SECRET ?? fileEnv.CRON_SECRET;
  if (!secret || secret.length < 32)
    throw new Error(
      "Set CRON_SECRET (at least 32 characters) in apps/platform/.env.local or the shell",
    );
  return secret;
}

export async function runScheduler({
  secret,
  signal,
  url = "http://localhost:3000/api/internal/connect/drain",
  intervalMs = 30_000,
  timeoutMs = 30_000,
  fetchTick = fetch,
  log = console,
}) {
  log.info(
    "[connect-scheduler] Started; ticking every 30 seconds on localhost:3000",
  );
  let unavailable = false;
  while (!signal.aborted) {
    const started = Date.now();
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetchTick(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        redirect: "error",
        signal: AbortSignal.any([signal, timeout]),
      });
      if (!response.ok) {
        // Error bodies can contain database or provider details. Log only status.
        await response.body?.cancel();
        log.error("[connect-scheduler] Tick failed", {
          stage: "drain",
          status: response.status,
        });
      } else {
        const result = await response.json();
        if (!result || typeof result !== "object" || Array.isArray(result))
          throw new SyntaxError("Invalid drain response");
        if (unavailable) log.info("[connect-scheduler] Platform is reachable");
        unavailable = false;
        if (
          typeof result.cleanup?.failedRooms === "number" &&
          result.cleanup.failedRooms > 0
        )
          log.error("[connect-scheduler] Room cleanup failed", {
            stage: "cleanup",
            failedRooms: result.cleanup.failedRooms,
          });
      }
    } catch (error) {
      if (signal.aborted) break;
      const failure = timeout.aborted
        ? "timeout"
        : error instanceof SyntaxError
          ? "invalid_response"
          : "network";
      if (failure !== "network" || !unavailable)
        log.error("[connect-scheduler] Tick failed; waiting for platform", {
          stage: "drain",
          failure,
        });
      unavailable = true;
    }
    // Await each request before scheduling another; slow requests never overlap.
    try {
      await delay(Math.max(0, intervalMs - (Date.now() - started)), undefined, {
        signal,
      });
    } catch {
      if (!signal.aborted) throw new Error("Scheduler wait failed");
    }
  }
  log.info("[connect-scheduler] Stopped");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await runScheduler({
      secret: schedulerSecret(),
      signal: controller.signal,
    });
  } catch {
    console.error(
      "[connect-scheduler] Startup failed; check CRON_SECRET (at least 32 characters) in apps/platform/.env.local or the shell",
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
