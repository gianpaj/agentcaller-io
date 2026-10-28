import { test } from "node:test";
import assert from "node:assert/strict";
import { drainBillingHttp } from "../../apps/platform/e2e/support/billing.mjs";

test("a successful HTTP response cannot hide a skipped billing drain", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ skipped: "stripe_not_configured" }),
  );
  await assert.rejects(drainBillingHttp(), /skipped/);
});

test("a completed billing drain returns its accounting result", async (t) => {
  const result = { processed: 0 };
  t.mock.method(globalThis, "fetch", async () => Response.json(result));
  assert.deepEqual(await drainBillingHttp(), result);
});
