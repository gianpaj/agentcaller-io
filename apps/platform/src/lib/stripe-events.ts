import Stripe from "stripe";
import { z } from "zod";
import { stripeEvents } from "@agentcaller/database";
import { ApiError } from "./auth";
import { database } from "./database";
import { getStripeWebhookEnv } from "./env";
import { stripeApiVersion } from "./stripe";

export const supportedStripeEvents: Stripe.Event.Type[] = [
  "checkout.session.completed",
  "checkout.session.expired",
  "setup_intent.succeeded",
  "setup_intent.setup_failed",
  "setup_intent.canceled",
  "invoice.created",
  "invoice.finalized",
  "invoice.finalization_failed",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.payment_succeeded",
  "invoice.paid",
  "invoice.updated",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "invoice.deleted",
  "payment_method.detached",
  "customer.updated",
  "credit_note.created",
  "credit_note.updated",
  "credit_note.voided",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
];

export function verifyStripeEvent(
  body: Buffer,
  signature: string | null,
  env = getStripeWebhookEnv(),
) {
  if (!signature) throw new ApiError(400, "Stripe signature is required");
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    throw new ApiError(400, "Invalid Stripe signature");
  }
  if (event.livemode !== env.livemode)
    throw new ApiError(400, "Stripe environment mismatch");
  if (event.api_version !== stripeApiVersion)
    throw new ApiError(400, "Unsupported Stripe event version");
  return event;
}

export async function receiveStripeEvent(event: Stripe.Event, db = database()) {
  if (!supportedStripeEvents.includes(event.type)) return;
  const object = z
    .object({ id: z.string().min(1).max(255) })
    .parse(event.data.object);
  const routing = z
    .object({
      id: z
        .string()
        .regex(/^evt_[A-Za-z0-9]+$/)
        .max(255),
      objectId: z.string().min(1).max(255),
    })
    .parse({ id: event.id, objectId: object.id });
  await db
    .insert(stripeEvents)
    .values({
      livemode: event.livemode,
      eventId: routing.id,
      type: event.type,
      objectId: routing.objectId,
      apiVersion: stripeApiVersion,
    })
    .onConflictDoNothing();
}
