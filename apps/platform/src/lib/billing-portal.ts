import type Stripe from "stripe";
import { billingAccounts } from "@agentcaller/database";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "./auth";
import { billingPolicy } from "./billing-policy";
import { database } from "./database";
import { stripeClient } from "./stripe";

const portalEnv = z.object({
  STRIPE_PORTAL_CONFIGURATION_ID: z.string().regex(/^bpc_[A-Za-z0-9]+$/),
});

export function isBillingPortalConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  return portalEnv.safeParse(env).success;
}

/**
 * Invoices charge the card pinned on the billing account, which only changes through the
 * consented Checkout setup. A portal that can add or remove cards would silently diverge from
 * that card, so the session refuses any configuration that enables payment method updates.
 */
export async function humanBillingPortalUrl(
  clientId: string,
  env: Record<string, string | undefined> = process.env,
  stripe: Stripe = stripeClient(),
  db = database(),
) {
  const settings = portalEnv.safeParse(env);
  if (!settings.success)
    throw new ApiError(503, "Billing portal is not configured");
  const policy = billingPolicy(env);
  const [account] = await db
    .select({ customerId: billingAccounts.stripeCustomerId })
    .from(billingAccounts)
    .where(eq(billingAccounts.clientId, clientId));
  if (!account?.customerId)
    throw new ApiError(404, "Billing portal is unavailable");
  const configuration = await stripe.billingPortal.configurations.retrieve(
    settings.data.STRIPE_PORTAL_CONFIGURATION_ID,
  );
  if (
    !configuration.active ||
    configuration.livemode !== policy.livemode ||
    configuration.features.payment_method_update.enabled
  )
    throw new ApiError(503, "Billing portal is misconfigured");
  const session = await stripe.billingPortal.sessions.create({
    customer: account.customerId,
    configuration: configuration.id,
    return_url: new URL("/app/billing", policy.origin).href,
  });
  const url = new URL(session.url);
  if (url.protocol !== "https:" || url.hostname !== "billing.stripe.com")
    throw new ApiError(503, "Billing portal link is unavailable");
  return url.href;
}
