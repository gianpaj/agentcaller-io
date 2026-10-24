import { test, expect } from "./support/fixtures.mjs";
import { runAccounting, runVoiceScenario } from "./support/jobs.mjs";
import { drainBillingHttp } from "./support/billing.mjs";

test("month-end accounting advances without expiring wall-clock credentials", async ({
  request,
}) => {
  const endpoint =
    process.env.NEXT_PUBLIC_APP_URL + "/api/internal/billing/drain";
  expect((await request.post(endpoint)).status()).toBe(401);
  await runAccounting();
  await drainBillingHttp();
});

test("worker callbacks use the running platform authentication boundary", async () => {
  await runVoiceScenario({ proof: true });
});
