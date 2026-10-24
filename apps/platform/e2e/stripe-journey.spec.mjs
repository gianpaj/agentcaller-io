import { test, expect, connectFreshAgent } from "./support/fixtures.mjs";
import { callTool } from "./support/agent-client.mjs";
import {
  enrollBilling,
  stripeState,
  stripeCommand,
  deliverStripeEvent,
} from "./support/billing.mjs";
import { runFundedCall } from "./support/calls.mjs";
import { runAccounting } from "./support/jobs.mjs";

test("a new human and agent complete calls, inspect usage and collect one monthly invoice", async ({
  page,
  db,
}) => {
  expect((await db`select count(*)::int as n from client_profiles`)[0].n).toBe(
    0,
  );
  const agent = await connectFreshAgent(page);
  await enrollBilling(page, agent.token);
  expect(
    (await stripeState()).objects.filter((o) => o.object === "charge"),
  ).toHaveLength(0);

  const first = await runFundedCall(agent.token, { key: "first-call" });
  expect(first.call.fundingSource).toBe("stripe_postpaid");
  expect(first.quote.maximumCents).toBe(80);
  expect(first.status).toMatchObject({
    state: "completed",
    usageState: "finalized",
    finalCents: 60,
    paymentState: "accrued",
  });
  expect((await callTool(agent.token, "get_usage")).data).toHaveLength(1);

  const replay = await callTool(agent.token, "schedule_call", {
    ...first.input,
    idempotencyKey: "first-call",
  });
  expect(replay.id).toBe(first.call.id);
  const changed = await callTool(agent.token, "schedule_call", {
    ...first.input,
    clientReference: "changed",
    idempotencyKey: "first-call",
  });
  expect(changed.isError).toBe(true);

  const second = await runFundedCall(agent.token, { key: "second-call" });
  expect(second.status.finalCents).toBe(60);
  const usage = await callTool(agent.token, "get_usage");
  expect(usage.data).toHaveLength(2);
  expect(usage.data.reduce((sum, row) => sum + row.finalCents, 0)).toBe(120);
  expect(JSON.stringify(usage)).not.toContain("invoice.stripe.com");

  const legs =
    await db`select connected_at, ended_at, sip_call_id from call_legs`;
  expect(legs).toHaveLength(4);
  expect(new Set(legs.map((leg) => leg.sip_call_id)).size).toBe(4);
  for (const leg of legs) {
    expect(leg.connected_at).toBeTruthy();
    expect(leg.ended_at > leg.connected_at).toBe(true);
  }
  expect(
    (
      await db`select count(*)::int as n from call_attempts where rooms_cleaned_at is not null`
    )[0].n,
  ).toBe(2);
  const [period] = await db`select * from billing_periods`;
  expect(period).toMatchObject({
    spent_cents: 120,
    reserved_cents: 0,
    collected_cents: 0,
  });
  const billingAt = new Date(period.ends_at).toISOString();
  await runAccounting(billingAt);
  const [invoice] = await db`select * from billing_invoices`;
  expect(invoice.expected_cents).toBe(120);
  expect(invoice.stripe_invoice_id).toBeTruthy();
  expect(
    (await stripeState()).requests.filter(
      (r) => r.method === "POST" && r.path === "/v1/invoiceitems",
    ),
  ).toHaveLength(1);

  await stripeCommand("invoice-outcome", {
    invoiceId: invoice.stripe_invoice_id,
    outcome: "paid",
  });
  const delivery = await deliverStripeEvent(
    "invoice.paid",
    invoice.stripe_invoice_id,
  );
  expect(delivery.status).toBe(200);
  await runAccounting(billingAt);
  expect(
    (
      await db`select collected_cents, reserved_cents, total_cents, status from billing_periods`
    )[0],
  ).toEqual({
    collected_cents: 120,
    reserved_cents: 0,
    total_cents: 120,
    status: "closed",
  });
  expect(
    (
      await db`select stripe_status, amount_paid, amount_remaining from billing_invoices`
    )[0],
  ).toMatchObject({
    stripe_status: "paid",
    amount_paid: 120,
    amount_remaining: 0,
  });

  expect(
    (
      await deliverStripeEvent("invoice.paid", invoice.stripe_invoice_id, {
        eventId: delivery.eventId,
      })
    ).status,
  ).toBe(200);
  await runAccounting(billingAt);
  expect((await db`select count(*)::int as n from billing_invoices`)[0].n).toBe(
    1,
  );
  expect(
    (await db`select collected_cents from billing_periods`)[0].collected_cents,
  ).toBe(120);
  expect(
    (await stripeState()).objects.filter((o) => o.object === "invoice_payment"),
  ).toHaveLength(1);
  expect(
    (await stripeState()).objects.filter((o) => o.object === "charge"),
  ).toHaveLength(1);
  expect((await db`select count(*)::int as n from calls`)[0].n).toBe(2);

  await page.goto("/app/billing");
  await expect(
    page.getByRole("button", { name: "Open private Stripe invoice" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Open private Stripe invoice" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Simulated Stripe invoice" }),
  ).toBeVisible();
  console.info(
    JSON.stringify({
      scenario: "fresh-user-agent-monthly-collection",
      calls: 2,
      invoices: 1,
      expectedCents: 120,
      collectedCents: 120,
    }),
  );
});
