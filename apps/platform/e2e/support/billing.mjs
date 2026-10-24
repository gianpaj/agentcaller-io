import { expect } from "@playwright/test";
import Stripe from "stripe";
import { callTool } from "./agent-client.mjs";

async function fixture(path, input) {
  const response = await fetch(
    process.env.E2E_CONTROL_URL + "/control/" + path,
    {
      method: input === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "x-e2e-token": process.env.E2E_CONTROL_TOKEN,
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    },
  );
  if (!response.ok)
    throw new Error(
      "Stripe fixture operation failed: " + path + " (" + response.status + ")",
    );
  return response.json();
}
export function stripeCommand(action, input = {}) {
  return fixture("command", { target: "stripe", action, ...input });
}
export async function stripeState() {
  return (await fixture("state")).stripe;
}

export async function deliverStripeEvent(type, objectId, options = {}) {
  const event = await stripeCommand("event", {
    type,
    objectId,
    ...(options.eventId ? { eventId: options.eventId } : {}),
  });
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
    ...(options.timestamp ? { timestamp: options.timestamp } : {}),
  });
  const response = await fetch(
    process.env.NEXT_PUBLIC_APP_URL + "/api/stripe/webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": options.signature ?? signature,
      },
      body: options.tamper ? payload + " " : payload,
    },
  );
  return { eventId: event.id, status: response.status, event };
}
export async function drainBillingHttp() {
  const response = await fetch(
    process.env.NEXT_PUBLIC_APP_URL + "/api/internal/billing/drain",
    {
      method: "POST",
      headers: { authorization: "Bearer " + process.env.CRON_SECRET },
    },
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).not.toHaveProperty("skipped");
  return body;
}

/** Drives our own approval UI; only Stripe's hosted boundary is fake. */
export async function enrollBilling(page, token, options = {}) {
  const setup = await callTool(token, "setup_billing", {
    idempotencyKey: options.key ?? "billing-enroll",
  });
  expect(setup.isError).toBeUndefined();
  await page.goto(setup.setupUrl);
  await expect(
    page.getByRole("heading", { name: "Authorize monthly billing" }),
  ).toBeVisible();
  await page
    .getByLabel("Name to use when introducing your call")
    .fill(options.contactName ?? "Test Caller");
  await page
    .getByLabel("Monthly integration limit (USD cents)")
    .fill(String(options.monthlyLimitCents ?? 1000));
  await page
    .getByLabel("Per-call limit (USD cents)")
    .fill(String(options.perCallLimitCents ?? 100));
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Agree and save a card with Stripe" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Simulated Stripe Checkout" }),
  ).toBeVisible();
  const session = (await stripeState()).objects.find(
    (object) =>
      object.object === "checkout.session" &&
      object.client_reference_id === setup.setupRequestId,
  );
  expect(session).toBeTruthy();
  const result = {
    ...setup,
    sessionId: session.id,
    customerId: session.customer,
    returnUrl: session.success_url,
  };
  if (options.complete === false) return result;
  let completed;
  if (
    options.visitReturn === false ||
    options.cardCustomerId ||
    options.intentCustomerId ||
    options.sessionCustomerId
  ) {
    completed = await stripeCommand("complete-checkout", {
      sessionId: session.id,
      ...Object.fromEntries(
        ["cardCustomerId", "intentCustomerId", "sessionCustomerId"]
          .filter((key) => options[key])
          .map((key) => [key, options[key]]),
      ),
    });
  } else {
    await page
      .getByRole("button", { name: "Complete simulated card setup" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Checking your card" }),
    ).toBeVisible();
    completed = await stripeCommand("complete-checkout", {
      sessionId: session.id,
    });
  }
  Object.assign(result, completed);
  if (options.deliver === false) return result;
  const delivery = await deliverStripeEvent(
    "checkout.session.completed",
    session.id,
  );
  expect(delivery.status).toBe(200);
  result.eventId = delivery.eventId;
  await drainBillingHttp();
  if (
    !options.cardCustomerId &&
    !options.intentCustomerId &&
    !options.sessionCustomerId
  ) {
    await expect
      .poll(async () => (await callTool(token, "get_billing_status")).status)
      .toBe("ready");
  }
  return result;
}
