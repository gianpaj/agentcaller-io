import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);

export async function runAccounting(at) {
  await exec(
    "corepack",
    [
      "pnpm",
      "exec",
      "vitest",
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
    "corepack",
    ["pnpm", "exec", "vitest", "run", "--config", "vitest.e2e.config.mjs"],
    {
      cwd: fileURLToPath(new URL("../../../voice-agent", import.meta.url)),
      env: { ...process.env, E2E_VOICE_SCENARIO: JSON.stringify(scenario) },
      timeout: 45_000,
      maxBuffer: 1048576,
    },
  );
}
