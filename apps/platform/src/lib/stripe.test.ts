import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  cardSetupParams,
  monthlyInvoiceParams,
  stripeSetupOperationKey,
  verifiedSetupCard,
} from "./stripe";
import {
  getStripeEnv,
  getStripeWebhookEnv,
  getBillingSetupTokenSecret,
  isStripeBillingEnabled,
} from "./env";

const reference = {
  accountId: "11111111-1111-4111-8111-111111111111",
  requestId: "22222222-2222-4222-8222-222222222222",
  connectionId: "33333333-3333-4333-8333-333333333333",
  generation: 1,
  cardGeneration: 0,
  customerId: "cus_offline",
};
const expires = new Date("2026-10-18T12:30:00Z");
const expected = { ...reference, sessionId: "cs_offline", livemode: false };
function setup() {
  const params = cardSetupParams(
    reference,
    "https://agentcaller.example",
    expires,
  );
  return {
    id: "cs_offline",
    mode: "setup",
    currency: "usd",
    status: "complete",
    livemode: false,
    customer: reference.customerId,
    client_reference_id: reference.requestId,
    metadata: params.metadata,
    setup_intent: {
      id: "seti_offline",
      customer: reference.customerId,
      usage: "off_session",
      status: "succeeded",
      livemode: false,
      metadata: params.setup_intent_data!.metadata,
      payment_method: {
        id: "pm_offline",
        type: "card",
        customer: reference.customerId,
        livemode: false,
        card: { brand: "visa", last4: "0000", exp_month: 1, exp_year: 2030 },
      },
    },
  };
}
const verify = (value: unknown) =>
  verifiedSetupCard(value as Stripe.Checkout.Session, expected);

describe("Stripe server-only configuration", () => {
  it("does not require keys for a disabled admission flag", () => {
    expect(isStripeBillingEnabled({})).toBe(false);
    expect(() => getStripeEnv({})).toThrow();
    expect(() =>
      getStripeEnv({ STRIPE_SECRET_KEY: "pk_test_notASecret" }),
    ).toThrow();
    expect(
      getStripeEnv({ STRIPE_SECRET_KEY: "sk_test_offline" }).livemode,
    ).toBe(false);
    expect(
      getStripeEnv({ STRIPE_SECRET_KEY: "sk_live_offline" }).livemode,
    ).toBe(true);
    expect(() =>
      getStripeWebhookEnv({ STRIPE_SECRET_KEY: "sk_test_offline" }),
    ).toThrow();
  });
  it("requires an independent setup-token secret", () => {
    const secret = "isolated-unit-test-secret-material-only";
    expect(
      getBillingSetupTokenSecret({ BILLING_SETUP_TOKEN_SECRET: secret }),
    ).toBe(secret);
    expect(() =>
      getBillingSetupTokenSecret({
        BILLING_SETUP_TOKEN_SECRET: secret,
        API_KEY_PEPPER: secret,
      }),
    ).toThrow();
    expect(() =>
      getBillingSetupTokenSecret({ BILLING_SETUP_TOKEN_SECRET: "short" }),
    ).toThrow();
  });
});
describe("hosted enrollment API contract", () => {
  it("creates only card setup, with no charge, subscription or unsupported usage field", () => {
    const params = cardSetupParams(
      reference,
      "https://agentcaller.example",
      expires,
    );
    expect(params).toMatchObject({
      mode: "setup",
      currency: "usd",
      allowed_payment_method_types: ["card"],
      customer: reference.customerId,
      client_reference_id: reference.requestId,
      expires_at: expires.getTime() / 1000,
    });
    for (const name of [
      "line_items",
      "amount",
      "payment_intent_data",
      "subscription_data",
      "payment_method_types",
    ])
      expect(params).not.toHaveProperty(name);
    expect(params.setup_intent_data).not.toHaveProperty("usage");
    expect(params.success_url).toBe(
      "https://agentcaller.example/billing/connect/return",
    );
    expect(stripeSetupOperationKey(reference)).toBe(
      stripeSetupOperationKey({ ...reference }),
    );
    expect(stripeSetupOperationKey(reference)).not.toBe(
      stripeSetupOperationKey({ ...reference, generation: 2 }),
    );
  });
  it("rejects untrusted setup return origins", () => {
    for (const origin of [
      "https://agentcaller.example/other",
      "https://user:password@agentcaller.example",
      "http://public.example",
      "https://agentcaller.example/?request=secret",
    ])
      expect(() => cardSetupParams(reference, origin, expires)).toThrow();
  });
  it("requires a complete owner-bound intent and attached card", () => {
    expect(verify(setup())).toEqual({
      paymentMethodId: "pm_offline",
      setupIntentId: "seti_offline",
      brand: "visa",
      last4: "0000",
      expiryMonth: 1,
      expiryYear: 2030,
    });
  });
  it("rejects mismatched sessions, environment and browser-return lookalikes", () => {
    const sample = setup();
    for (const patch of [
      { id: "cs_other" },
      { mode: "payment" },
      { currency: "eur" },
      { status: "open" },
      { customer: "cus_other" },
      { livemode: true },
      { client_reference_id: reference.accountId },
      { setup_intent: "seti_unexpanded" },
    ])
      expect(() => verify({ ...sample, ...patch })).toThrow();
  });
  it("rejects stale generations and mismatched setup intent or card ownership", () => {
    const sample = setup();
    for (const patch of [
      { status: "requires_action" },
      { usage: "on_session" },
      { livemode: true },
      { customer: "cus_other" },
      { metadata: { ...sample.setup_intent.metadata, generation: "2" } },
      {
        payment_method: {
          ...sample.setup_intent.payment_method,
          customer: "cus_other",
        },
      },
      {
        payment_method: {
          ...sample.setup_intent.payment_method,
          type: "sepa_debit",
        },
      },
      { payment_method: "pm_unexpanded" },
    ])
      expect(() =>
        verify({
          ...sample,
          setup_intent: { ...sample.setup_intent, ...patch },
        }),
      ).toThrow();
  });
});
describe("monthly one-off invoice API contract", () => {
  it("holds a card-funded draft with explicit selection and no subscription", () => {
    const params = monthlyInvoiceParams({
      customerId: reference.customerId,
      paymentMethodId: "pm_offline",
      accountId: reference.accountId,
      invoiceId: reference.requestId,
      periodId: reference.connectionId,
    });
    expect(params).toMatchObject({
      auto_advance: false,
      collection_method: "charge_automatically",
      pending_invoice_items_behavior: "exclude",
      default_payment_method: "pm_offline",
      payment_settings: { payment_method_types: ["card"] },
      currency: "usd",
    });
    expect(params).not.toHaveProperty("subscription");
  });
});
