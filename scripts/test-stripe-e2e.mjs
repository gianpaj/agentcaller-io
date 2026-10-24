import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startRuntime } from "../apps/platform/e2e/support/runtime.mjs";

const runtime = await startRuntime();
let child;
let stopping = false;
async function cleanup() {
  if (stopping) return;
  stopping = true;
  child?.kill("SIGTERM");
  await runtime.stop();
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await cleanup();
    process.exit(130);
  });
try {
  const args = process.argv
    .slice(2)
    .filter((arg, index) => !(index === 0 && arg === "--"));
  child = spawn("corepack", ["pnpm", "exec", "playwright", "test", ...args], {
    cwd: fileURLToPath(new URL("../apps/platform", import.meta.url)),
    env: runtime.env,
    stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (code) console.error(runtime.diagnostics());
  process.exitCode = code;
} finally {
  await cleanup();
}
