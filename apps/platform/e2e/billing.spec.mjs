import { test, expect, connectFreshAgent } from "./support/fixtures.mjs";
import { callTool } from "./support/agent-client.mjs";
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
