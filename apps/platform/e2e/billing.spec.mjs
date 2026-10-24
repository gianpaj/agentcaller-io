import { test, expect, connectFreshAgent } from "./support/fixtures.mjs";
import { callTool } from "./support/agent-client.mjs";
import { runFundedCall } from "./support/calls.mjs";
import { runAccounting } from "./support/jobs.mjs";
import {
  enrollBilling,
  deliverStripeEvent,
  drainBillingHttp,
  stripeCommand,
  stripeState,
} from "./support/billing.mjs";

test("human approval and signed provider setup save a card without charging", async ({
  page,
  db,
}) => {
  const agent = await connectFreshAgent(page);
  const enrolled = await enrollBilling(page, agent.token);
  expect((await callTool(agent.token, "get_billing_status")).status).toBe(
    "ready",
  );
  const [account] =
    await db`select stripe_customer_id,payment_method_id,setup_intent_id,status,collection_consent from billing_accounts`;
  expect(account).toMatchObject({
    stripe_customer_id: enrolled.customerId,
    payment_method_id: enrolled.paymentMethodId,
    setup_intent_id: enrolled.setupIntentId,
    status: "active",
    collection_consent: true,
  });
  const state = await stripeState();
  expect(
    state.objects.filter(
      (object) =>
        object.object === "payment_intent" ||
        object.object === "charge" ||
        object.object === "invoice",
    ),
  ).toEqual([]);
  expect(state.unsupported).toEqual([]);
});

test("returning before provider confirmation grants no card authority; duplicate events activate once", async ({
  page,
  db,
}) => {
  const agent = await connectFreshAgent(page);
  const pending = await enrollBilling(page, agent.token, { complete: false });
  await page.goto(pending.returnUrl);
  await expect(
    page.getByRole("heading", { name: "Checking your card" }),
  ).toBeVisible();
  expect((await callTool(agent.token, "get_billing_status")).status).not.toBe(
    "ready",
  );
  expect(
    (await db`select payment_method_id from billing_accounts`)[0]
      .payment_method_id,
  ).toBeNull();
  await stripeCommand("complete-checkout", { sessionId: pending.sessionId });
  const first = await deliverStripeEvent(
    "checkout.session.completed",
    pending.sessionId,
  );
  expect(first.status).toBe(200);
  expect(
    (
      await deliverStripeEvent(
        "checkout.session.completed",
        pending.sessionId,
        { eventId: first.eventId },
      )
    ).status,
  ).toBe(200);
  await drainBillingHttp();
  expect((await callTool(agent.token, "get_billing_status")).status).toBe(
    "ready",
  );
  expect((await db`select count(*)::int as n from stripe_events`)[0].n).toBe(1);
  expect(
    (
      await db`select count(*)::int as n from billing_audit_events where kind='card_setup_verified'`
    )[0].n,
  ).toBe(1);
});

test("webhook confirmation works without returning to the application", async ({
  page,
  db,
}) => {
  const agent = await connectFreshAgent(page);
  await enrollBilling(page, agent.token, { visitReturn: false });
  expect(new URL(page.url()).origin).toBe("https://checkout.stripe.com");
  expect((await callTool(agent.token, "get_billing_status")).status).toBe(
    "ready",
  );
  expect((await db`select count(*)::int as n from calls`)[0].n).toBe(0);
});

test("foreign saved-card evidence and tampered webhook bodies cannot activate billing", async ({
  page,
  db,
}) => {
  const agent = await connectFreshAgent(page);
  const setup = await enrollBilling(page, agent.token, {
    cardCustomerId: "cus_foreign",
    deliver: false,
  });
  expect(
    (
      await deliverStripeEvent("checkout.session.completed", setup.sessionId, {
        tamper: true,
      })
    ).status,
  ).toBe(400);
  expect((await db`select count(*)::int as n from stripe_events`)[0].n).toBe(0);
  expect(
    (await deliverStripeEvent("checkout.session.completed", setup.sessionId))
      .status,
  ).toBe(200);
  await drainBillingHttp();
  expect((await callTool(agent.token, "get_billing_status")).status).not.toBe(
    "ready",
  );
  expect(
    (await db`select payment_method_id from billing_accounts`)[0]
      .payment_method_id,
  ).toBeNull();
  expect((await db`select status from stripe_events`)[0].status).toBe("failed");
});

test("expired hosted setup stays unready and never grants spending", async ({
  page,
  db,
}) => {
  const agent = await connectFreshAgent(page);
  const setup = await enrollBilling(page, agent.token, { complete: false });
  await stripeCommand("expire-checkout", { sessionId: setup.sessionId });
  expect(
    (await deliverStripeEvent("checkout.session.expired", setup.sessionId))
      .status,
  ).toBe(200);
  await drainBillingHttp();
  expect((await db`select status from billing_setup_requests`)[0].status).toBe(
    "expired",
  );
  expect(
    (await db`select payment_method_id from billing_accounts`)[0]
      .payment_method_id,
  ).toBeNull();
});

async function billableMonth(page, token, db) {
  await enrollBilling(page, token);
  const call = await runFundedCall(token);
  expect(call.status).toMatchObject({
    usageState: "finalized",
    finalCents: 60,
  });
  const [period] =
    await db`select id,ends_at,spent_cents,reserved_cents from billing_periods`;
  expect(period).toMatchObject({ spent_cents: 60, reserved_cents: 0 });
  const monthEnd = new Date(period.ends_at).toISOString();
  await runAccounting(monthEnd);
  const [invoice] =
    await db`select id,stripe_invoice_id,issuance_state,expected_cents from billing_invoices`;
  expect(invoice).toMatchObject({
    issuance_state: "ready",
    expected_cents: 60,
  });
  expect(invoice.stripe_invoice_id).toBeTruthy();
  return { call, period, invoice, monthEnd };
}

test("monthly decline blocks spending; hosted recovery allocates successful card cash once", async ({
  page,
  db,
}) => {
  const agent = await connectFreshAgent(page);
  const { invoice, monthEnd } = await billableMonth(page, agent.token, db);
  await stripeCommand("invoice-outcome", {
    invoiceId: invoice.stripe_invoice_id,
    outcome: "failed",
  });
  expect(
    (
      await deliverStripeEvent(
        "invoice.payment_failed",
        invoice.stripe_invoice_id,
      )
    ).status,
  ).toBe(200);
  await runAccounting(monthEnd);
  expect((await callTool(agent.token, "get_billing_status")).status).toBe(
    "blocked",
  );
  expect(
    (await db`select status,block_reason from billing_accounts`)[0],
  ).toMatchObject({
    status: "past_due",
    block_reason: "invoice_payment_required",
  });
  expect(
    (await db`select collected_cents from billing_periods`)[0].collected_cents,
  ).toBe(0);
  const providerInvoice = (await stripeState()).objects.find(
    (object) => object.id === invoice.stripe_invoice_id,
  );
  await page.goto(providerInvoice.hosted_invoice_url);
  await page
    .getByRole("button", { name: "Complete simulated invoice payment" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Simulated invoice paid" }),
  ).toBeVisible();
  const event = await deliverStripeEvent(
    "invoice.paid",
    invoice.stripe_invoice_id,
  );
  expect(event.status).toBe(200);
  expect(
    (
      await deliverStripeEvent("invoice.paid", invoice.stripe_invoice_id, {
        eventId: event.eventId,
      })
    ).status,
  ).toBe(200);
  await runAccounting(monthEnd);
  await runAccounting(monthEnd);
  expect(
    (await db`select collected_cents from billing_periods`)[0].collected_cents,
  ).toBe(60);
  expect((await db`select count(*)::int as n from billing_invoices`)[0].n).toBe(
    1,
  );
  expect(
    (
      await db`select count(*)::int as n from billing_audit_events where kind='invoice_cash_confirmed'`
    )[0].n,
  ).toBe(1);
  expect((await db`select status from billing_accounts`)[0].status).toBe(
    "active",
  );
  const objects = (await stripeState()).objects;
  expect(
    objects.filter((object) => object.object === "invoiceitem"),
  ).toHaveLength(1);
  expect(
    objects.filter((object) => object.object === "invoice_payment"),
  ).toHaveLength(1);
});

test("a provider paid flag without allocated card evidence keeps the debt for review", async ({
  page,
  db,
}) => {
  const agent = await connectFreshAgent(page);
  const { invoice, monthEnd } = await billableMonth(page, agent.token, db);
  await stripeCommand("invoice-outcome", {
    invoiceId: invoice.stripe_invoice_id,
    outcome: "paid_without_cash",
  });
  expect(
    (await deliverStripeEvent("invoice.paid", invoice.stripe_invoice_id))
      .status,
  ).toBe(200);
  await runAccounting(monthEnd);
  expect(
    (await db`select collected_cents from billing_periods`)[0].collected_cents,
  ).toBe(0);
  expect(
    (await db`select status,block_reason from billing_accounts`)[0],
  ).toMatchObject({ status: "suspended", block_reason: "invoice_cash_review" });
  expect(
    (await db`select issuance_state,last_error from billing_invoices`)[0],
  ).toMatchObject({
    issuance_state: "unknown",
    last_error: "invoice_cash_review",
  });
});

test("lost invoice creation and finalization responses recover the same provider objects", async ({
  page,
  db,
}) => {
  const agent = await connectFreshAgent(page);
  await enrollBilling(page, agent.token);
  const call = await runFundedCall(agent.token);
  expect(call.status).toMatchObject({
    usageState: "finalized",
    finalCents: 60,
  });
  const [period] = await db`select ends_at from billing_periods`;
  const monthEnd = new Date(period.ends_at).toISOString();
  await stripeCommand("lose-response", { path: "/v1/invoices", count: 2 });
  await runAccounting(monthEnd);
  const providerInvoice = (await stripeState()).objects.find(
    (object) => object.object === "invoice",
  );
  expect(providerInvoice).toBeTruthy();
  expect(
    (await db`select stripe_invoice_id from billing_invoices`)[0]
      .stripe_invoice_id,
  ).toBeNull();
  await stripeCommand("lose-response", {
    path: "/v1/invoices/" + providerInvoice.id + "/finalize",
    count: 2,
  });
  await runAccounting(monthEnd);
  expect(
    (await db`select stripe_invoice_id from billing_invoices`)[0]
      .stripe_invoice_id,
  ).toBe(providerInvoice.id);
  await runAccounting(monthEnd);
  expect(
    (
      await db`select issuance_state,stripe_invoice_id from billing_invoices`
    )[0],
  ).toMatchObject({
    issuance_state: "ready",
    stripe_invoice_id: providerInvoice.id,
  });
  const state = await stripeState();
  expect(
    state.objects.filter((object) => object.object === "invoice"),
  ).toHaveLength(1);
  expect(
    state.objects.filter((object) => object.object === "invoiceitem"),
  ).toHaveLength(1);
  const creates = state.requests.filter(
    (request) => request.method === "POST" && request.path === "/v1/invoices",
  );
  expect(creates.length).toBeGreaterThan(1);
  expect(new Set(creates.map((request) => request.idempotencyKey)).size).toBe(
    1,
  );
  await stripeCommand("invoice-outcome", {
    invoiceId: providerInvoice.id,
    outcome: "paid",
  });
  expect(
    (await deliverStripeEvent("invoice.paid", providerInvoice.id)).status,
  ).toBe(200);
  await runAccounting(monthEnd);
  expect(
    (await db`select collected_cents from billing_periods`)[0].collected_cents,
  ).toBe(60);
});

test("authentication-required collection stays blocked and later payment cannot revive revoked spending", async ({
  page,
  db,
}) => {
  const agent = await connectFreshAgent(page);
  const { invoice, monthEnd } = await billableMonth(page, agent.token, db);
  await stripeCommand("invoice-outcome", {
    invoiceId: invoice.stripe_invoice_id,
    outcome: "action_required",
  });
  expect(
    (
      await deliverStripeEvent(
        "invoice.payment_action_required",
        invoice.stripe_invoice_id,
      )
    ).status,
  ).toBe(200);
  await runAccounting(monthEnd);
  expect(
    (await db`select action_required from billing_invoices`)[0].action_required,
  ).toBe(true);
  expect((await callTool(agent.token, "get_billing_status")).status).toBe(
    "blocked",
  );
  await page.goto("/app/billing");
  await page
    .getByRole("button", {
      name: "Revoke spending and cancel outstanding calls",
    })
    .click();
  await expect
    .poll(
      async () =>
        (await db`select status from billing_authorizations`)[0].status,
    )
    .toBe("revoked");
  await stripeCommand("invoice-outcome", {
    invoiceId: invoice.stripe_invoice_id,
    outcome: "paid",
  });
  expect(
    (await deliverStripeEvent("invoice.paid", invoice.stripe_invoice_id))
      .status,
  ).toBe(200);
  await runAccounting(monthEnd);
  expect(
    (await db`select collected_cents from billing_periods`)[0].collected_cents,
  ).toBe(60);
  expect((await db`select status from billing_authorizations`)[0].status).toBe(
    "revoked",
  );
  expect((await callTool(agent.token, "get_billing_status")).status).toBe(
    "blocked",
  );
});
