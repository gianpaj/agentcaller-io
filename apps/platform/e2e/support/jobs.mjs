import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const exec = promisify(execFile);
function vitestCli(packageJson) {
  const require = createRequire(packageJson);
  return join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
}
const accountingCli = vitestCli(new URL("../../package.json", import.meta.url));
const voiceCli = vitestCli(
  new URL("../../../voice-agent/package.json", import.meta.url),
);

export async function runAccounting(at) {
  await exec(
    process.execPath,
    [
      accountingCli,
      "run",
      "--config",
      "vitest.e2e.config.mjs",
      "e2e/accounting.test.mjs",
    ],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...process.env, E2E_BILLING_AT: at ?? "" },
      timeout: 45_000,
      maxBuffer: 1048576,
    },
  );
}
export async function runVoiceScenario(scenario = {}) {
  await exec(
    process.execPath,
    [voiceCli, "run", "--config", "vitest.e2e.config.mjs"],
    {
      cwd: fileURLToPath(new URL("../../../voice-agent", import.meta.url)),
      env: { ...process.env, E2E_VOICE_SCENARIO: JSON.stringify(scenario) },
      timeout: 45_000,
      maxBuffer: 1048576,
    },
  );
}
