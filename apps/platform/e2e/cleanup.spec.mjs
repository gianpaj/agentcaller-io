import {
  test,
  expect,
  connectFreshAgent,
  control,
} from "./support/fixtures.mjs";
import { enrollBilling, drainBillingHttp } from "./support/billing.mjs";
import { runFundedCall, drainConnectHttp } from "./support/calls.mjs";
import { callTool } from "./support/agent-client.mjs";
import { runAccounting } from "./support/jobs.mjs";

test("uncertain room cleanup holds usage and prevents invoicing until reconciliation", async ({
  page,
  db,
}) => {
  const agent = await connectFreshAgent(page);
  await enrollBilling(page, agent.token);
  await control("command", {
    target: "livekit",
    action: "cleanup-failure",
    enabled: true,
  });
  const call = await runFundedCall(agent.token);
  expect(call.status).toMatchObject({
    state: "completed",
    usageState: "metering_pending",
    finalCents: null,
  });
  const [period] = await db`select * from billing_periods`;
  expect(period).toMatchObject({ spent_cents: 0, reserved_cents: 80 });
  const at = new Date(period.ends_at).toISOString();
  await runAccounting(at);
  expect(
    (await db`select status, reserved_cents from billing_periods`)[0],
  ).toMatchObject({ status: "closing", reserved_cents: 80 });
  expect((await db`select count(*)::int as n from billing_invoices`)[0].n).toBe(
    0,
  );
  await control("command", {
    target: "livekit",
    action: "cleanup-failure",
    enabled: false,
  });
  await drainConnectHttp();
  await drainBillingHttp();
  expect(
    await callTool(agent.token, "get_call_status", { callId: call.call.id }),
  ).toMatchObject({
    state: "completed",
    usageState: "finalized",
    finalCents: 60,
  });
  await runAccounting(at);
  expect(
    (
      await db`select spent_cents, reserved_cents, total_cents from billing_periods`
    )[0],
  ).toMatchObject({ spent_cents: 60, reserved_cents: 0, total_cents: 60 });
  expect((await db`select count(*)::int as n from billing_invoices`)[0].n).toBe(
    1,
  );
});
