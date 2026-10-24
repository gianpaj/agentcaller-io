import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNoLocalEnvFiles } from "../../apps/platform/e2e/support/runtime.mjs";

for (const filename of [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
]) {
  test("refuses Next development configuration in " + filename, async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentcaller-env-"));
    try {
      await writeFile(
        join(directory, filename),
        "SYNTHETIC_ENV_PROBE=unexpected\n",
      );
      await assert.rejects(
        assertNoLocalEnvFiles(directory),
        /Next would load local configuration/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("allows a clean worktree and the environment example", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentcaller-env-"));
  try {
    await assertNoLocalEnvFiles(directory);
    await writeFile(
      join(directory, ".env.example"),
      "SYNTHETIC_ENV_PROBE=example\n",
    );
    await assertNoLocalEnvFiles(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
