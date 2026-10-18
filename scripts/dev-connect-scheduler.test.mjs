import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScheduler, schedulerSecret } from "./dev-connect-scheduler.mjs";

const secret = "offline-test-secret-".repeat(3);
function harness() {
  const controller = new AbortController();
  const logs = [];
  return {
    controller,
    logs,
    options: {
      secret,
      signal: controller.signal,
      intervalMs: 1,
      log: {
        info: (...args) => logs.push(args),
        error: (...args) => logs.push(args),
      },
    },
  };
}

test("loads CRON_SECRET from the platform file, with shell precedence", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentcaller-scheduler-"));
  const file = join(dir, ".env.local");
  try {
    writeFileSync(file, `CRON_SECRET='${secret}'\n`);
    assert.equal(schedulerSecret({}, file), secret);
    assert.equal(
      schedulerSecret({ CRON_SECRET: "shell-secret-".repeat(4) }, file),
      "shell-secret-".repeat(4),
    );
    assert.throws(
      () => schedulerSecret({ CRON_SECRET: "short" }, file),
      /CRON_SECRET/,
    );
    assert.throws(
      () => schedulerSecret({}, join(dir, "missing")),
      /CRON_SECRET/,
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("ticks immediately with authentication, stays quiet on idle, and stops", async () => {
  const { controller, logs, options } = harness();
  let calls = 0;
  await runScheduler({
    ...options,
    fetchTick: async (url, request) => {
      calls++;
      assert.equal(url, "http://localhost:3000/api/internal/connect/drain");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.Authorization, `Bearer ${secret}`);
      assert.equal(request.redirect, "error");
      if (calls === 2) controller.abort();
      return Response.json({
        cleanup: { failedRooms: 0 },
        paidJobsBlocked: "Paid jobs are blocked",
      });
    },
  });
  assert.equal(calls, 2);
  assert.equal(logs.length, 2); // Startup and shutdown, no idle output.
  assert.ok(!JSON.stringify(logs).includes(secret));
});

test("recovers from startup connection refusal, HTTP errors, and invalid JSON", async () => {
  const { controller, logs, options } = harness();
  const outcomes = [
    new TypeError(secret),
    new TypeError(secret),
    new Response(secret, { status: 401 }),
    new Response(secret, { status: 500 }),
    new Response("invalid JSON"),
    Response.json(null),
    Response.json({ cleanup: { failedRooms: 2 } }),
  ];
  await runScheduler({
    ...options,
    fetchTick: async () => {
      const result = outcomes.shift();
      if (!outcomes.length) controller.abort();
      if (result instanceof Error) throw result;
      return result;
    },
  });
  const data = logs.map((entry) => entry[1]).filter(Boolean);
  assert.equal(data.filter((entry) => entry.failure === "network").length, 1);
  assert.ok(data.some((entry) => entry.status === 401));
  assert.ok(data.some((entry) => entry.status === 500));
  assert.ok(data.some((entry) => entry.failure === "invalid_response"));
  assert.ok(data.some((entry) => entry.failedRooms === 2));
  assert.ok(!JSON.stringify(logs).includes(secret));
});

test("slow drain requests never overlap", async () => {
  const { controller, options } = harness();
  let active = 0;
  let calls = 0;
  let maximum = 0;
  await runScheduler({
    ...options,
    fetchTick: async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      if (++calls === 2) controller.abort();
      return Response.json({});
    },
  });
  assert.equal(maximum, 1);
  assert.equal(calls, 2);
});

test("timeouts are logged and a later tick can succeed", async () => {
  const { controller, logs, options } = harness();
  let calls = 0;
  await runScheduler({
    ...options,
    timeoutMs: 5,
    fetchTick: async (_url, { signal }) => {
      if (++calls === 2) {
        controller.abort();
        return Response.json({});
      }
      return new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(
          () => reject(new Error("test deadline")),
          1000,
        );
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(keepAlive);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    },
  });
  assert.equal(calls, 2);
  assert.ok(logs.some((entry) => entry[1]?.failure === "timeout"));
});

test("shutdown aborts an in-flight request without reporting a failure", async () => {
  const { controller, logs, options } = harness();
  await runScheduler({
    ...options,
    fetchTick: async (_url, { signal }) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        controller.abort();
      });
    },
  });
  assert.equal(logs.length, 2);
});
