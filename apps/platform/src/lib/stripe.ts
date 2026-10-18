import Stripe from "stripe";
import { z } from "zod";
import { getStripeEnv } from "./env";

export const stripeApiVersion = "2026-09-30.endive" as const;
let cached: { key: string; client: Stripe } | undefined;
export function stripeClient() {
  const { STRIPE_SECRET_KEY } = getStripeEnv();
  if (cached?.key !== STRIPE_SECRET_KEY)
    cached = {
      key: STRIPE_SECRET_KEY,
      client: new Stripe(STRIPE_SECRET_KEY, {
        apiVersion: stripeApiVersion,
        maxNetworkRetries: 1,
        timeout: 10_000,
      }),
    };
  return cached.client;
}

const reference = z.object({
  accountId: z.uuid(),
  requestId: z.uuid(),
  connectionId: z.uuid(),
  generation: z.number().int().positive(),
  cardGeneration: z.number().int().nonnegative(),
  customerId: z.string().regex(/^cus_[A-Za-z0-9]+$/),
});
export type CardSetupReference = z.infer<typeof reference>;
function setupMetadata(input: CardSetupReference) {
  return {
    billing_account_id: input.accountId,
    setup_request_id: input.requestId,
    connection_id: input.connectionId,
    generation: String(input.generation),
    card_generation: String(input.cardGeneration),
  };
}

/** Caller persists this generation/operation before making the Stripe request. */
export function cardSetupParams(
  input: CardSetupReference,
  origin: string,
  expiresAt: Date,
): Stripe.Checkout.SessionCreateParams {
  reference.parse(input);
  const base = new URL(origin);
  if (
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    (base.protocol !== "https:" &&
      !(
        base.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
      ))
  )
    throw new Error("Invalid card setup application origin");
  if (!Number.isSafeInteger(expiresAt.getTime()))
    throw new Error("Invalid Checkout expiry");
  const metadata = setupMetadata(input);
  return {
    mode: "setup",
    customer: input.customerId,
    currency: "usd",
    allowed_payment_method_types: ["card"],
    client_reference_id: input.requestId,
    metadata,
    setup_intent_data: { metadata },
    success_url: new URL("/billing/connect/return", base).href,
    cancel_url: new URL("/billing/connect", base).href,
    expires_at: Math.floor(expiresAt.getTime() / 1000),
  };
}

export function stripeSetupOperationKey(input: CardSetupReference) {
  reference.parse(input);
  return `billing-setup:${input.requestId}:${input.generation}:checkout:v1`;
}

function objectId(value: string | { id: string } | null) {
  return typeof value === "string" ? value : value?.id;
}

/** Validate freshly retrieved, expanded objects. A browser return cannot call this into existence. */
export function verifiedSetupCard(
  session: Stripe.Checkout.Session,
  expected: CardSetupReference & { sessionId: string; livemode: boolean },
) {
  reference.parse(expected);
  const intent = session.setup_intent;
  if (
    session.id !== expected.sessionId ||
    session.mode !== "setup" ||
    session.currency !== "usd" ||
    session.status !== "complete" ||
    session.livemode !== expected.livemode ||
    session.client_reference_id !== expected.requestId ||
    objectId(session.customer) !== expected.customerId ||
    !intent ||
    typeof intent === "string"
  )
    throw new Error("Setup session binding mismatch");
  if (
    intent.status !== "succeeded" ||
    intent.usage !== "off_session" ||
    intent.livemode !== expected.livemode ||
    objectId(intent.customer) !== expected.customerId
  )
    throw new Error("Setup intent is not verified for future use");
  const metadata = setupMetadata(expected);
  for (const [name, value] of Object.entries(metadata))
    if (session.metadata?.[name] !== value || intent.metadata?.[name] !== value)
      throw new Error("Setup generation or owner mismatch");
  const method = intent.payment_method;
  if (
    !method ||
    typeof method === "string" ||
    method.type !== "card" ||
    !method.card ||
    method.livemode !== expected.livemode ||
    objectId(method.customer) !== expected.customerId
  )
    throw new Error("Saved card ownership mismatch");
  return {
    paymentMethodId: method.id,
    setupIntentId: intent.id,
    brand: method.card.brand,
    last4: method.card.last4,
    expiryMonth: method.card.exp_month,
    expiryYear: method.card.exp_year,
  };
}

export function monthlyInvoiceParams(input: {
  customerId: string;
  paymentMethodId: string;
  accountId: string;
  invoiceId: string;
  periodId: string;
}): Stripe.InvoiceCreateParams {
  z.object({
    customerId: z.string().regex(/^cus_[A-Za-z0-9]+$/),
    paymentMethodId: z.string().regex(/^pm_[A-Za-z0-9]+$/),
    accountId: z.uuid(),
    invoiceId: z.uuid(),
    periodId: z.uuid(),
  }).parse(input);
  return {
    customer: input.customerId,
    currency: "usd",
    collection_method: "charge_automatically",
    auto_advance: false,
    pending_invoice_items_behavior: "exclude",
    default_payment_method: input.paymentMethodId,
    payment_settings: { payment_method_types: ["card"] },
    metadata: {
      billing_account_id: input.accountId,
      billing_invoice_id: input.invoiceId,
      billing_period_id: input.periodId,
    },
  };
}
