import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import RequireExecutedScenarios from "../../apps/platform/e2e/support/reporter.mjs";

const exec = promisify(execFile);
const passed = { expectedStatus: "passed", results: [{ status: "passed" }] };

function reporter(scenarios) {
  const value = new RequireExecutedScenarios();
  value.onBegin({}, { allTests: () => scenarios });
  return value;
}

test("executed scenarios preserve a successful run", async () => {
  assert.equal(await reporter([passed]).onEnd({ status: "passed" }), undefined);
});

test("declared skips fail a successful run even without an attempt", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  assert.deepEqual(
    await reporter([passed, { expectedStatus: "skipped", results: [] }]).onEnd({
      status: "passed",
    }),
    { status: "failed" },
  );
  assert.deepEqual(log.mock.calls[0].arguments, [
    "Mocked Stripe E2E rejected 1 skipped scenario(s)",
  ]);
});

test("runtime skips also fail and diagnostics contain only a count", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const scenario = {
    title: "private scenario detail",
    expectedStatus: "passed",
    results: [
      { status: "skipped", error: { message: "private error detail" } },
    ],
  };
  assert.deepEqual(await reporter([scenario]).onEnd({ status: "passed" }), {
    status: "failed",
  });
  assert.deepEqual(log.mock.calls[0].arguments, [
    "Mocked Stripe E2E rejected 1 skipped scenario(s)",
  ]);
});

for (const status of ["failed", "timedout", "interrupted"]) {
  test("skips preserve an existing " + status + " result", async (t) => {
    t.mock.method(console, "error", () => {});
    assert.equal(
      await reporter([{ expectedStatus: "skipped", results: [] }]).onEnd({
        status,
      }),
      undefined,
    );
  });
}

test("a real Playwright invocation exits unsuccessfully for a skipped scenario", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentcaller-reporter-"));
  const playwright = new URL(
    "../../apps/platform/node_modules/@playwright/test/index.mjs",
    import.meta.url,
  );
  const cli = new URL(
    "../../apps/platform/node_modules/@playwright/test/cli.js",
    import.meta.url,
  );
  const gate = new URL(
    "../../apps/platform/e2e/support/reporter.mjs",
    import.meta.url,
  );
  try {
    await writeFile(
      join(directory, "skipped.spec.mjs"),
      "import { test } from " +
        JSON.stringify(playwright.href) +
        ";\ntest.skip('synthetic skipped scenario', () => {});\n",
    );
    await writeFile(
      join(directory, "playwright.config.mjs"),
      "export default { testDir: " +
        JSON.stringify(directory) +
        ", workers: 1, reporter: [[" +
        JSON.stringify(fileURLToPath(gate)) +
        "]] };\n",
    );
    const result = await exec(
      process.execPath,
      [
        fileURLToPath(cli),
        "test",
        "--config",
        join(directory, "playwright.config.mjs"),
      ],
      {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          CI: "true",
          NODE_OPTIONS: "",
        },
        timeout: 15_000,
        maxBuffer: 1048576,
      },
    ).then(
      (value) => ({ ...value, code: 0 }),
      (error) => error,
    );
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /Mocked Stripe E2E rejected 1 skipped scenario\(s\)/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
