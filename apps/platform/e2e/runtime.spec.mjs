import { test, expect } from "./support/fixtures.mjs";
import { runAccounting, runVoiceScenario } from "./support/jobs.mjs";

test("month-end accounting advances without expiring wall-clock credentials", async ({
  request,
}) => {
  const endpoint =
    process.env.NEXT_PUBLIC_APP_URL + "/api/internal/billing/drain";
  expect((await request.post(endpoint)).status()).toBe(401);
  await runAccounting();
  expect(
    (
      await request.post(endpoint, {
        headers: { authorization: "Bearer " + process.env.CRON_SECRET },
      })
    ).status(),
  ).toBe(200);
});

test("worker callbacks use the running platform authentication boundary", async () => {
  await runVoiceScenario({ proof: true });
});
