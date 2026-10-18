import {
  billingAccounts,
  billingCallUsage,
  billingInvoices,
  billingPeriods,
  billingSetupRequests,
  calls,
} from "@agentcaller/database";
import { and, eq, inArray, isNotNull, isNull, lte, asc, or } from "drizzle-orm";
import type Stripe from "stripe";
import { database } from "./database";
import { stripeClient } from "./stripe";
import { drainStripeEvents } from "./billing-events";
import { finalizeStripeUsage } from "./billing-usage";
import {
  beginBillingCheckout,
  reconcileCheckoutSession,
} from "./billing-setup";
import {
  closeBillingPeriod,
  issueMonthlyInvoice,
  reconcileMonthlyInvoice,
  syncInvoiceCollection,
} from "./billing-invoices";
import { cancelConnect } from "./connect-me";
import { stripeCallAuthority } from "./billing-authority";
import { lockCallBillingAccount } from "./billing-store";

/** Durable work is bounded per invocation and resumes from stored state after interruption. */
export async function drainBilling(
  stripe: Stripe = stripeClient(),
  db = database(),
  now = new Date(),
) {
  let deferred = 0;
  const attempt = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch {
      deferred++;
    }
  };
  const events = await drainStripeEvents(stripe, db, now, 10);
  await db
    .update(billingSetupRequests)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        inArray(billingSetupRequests.status, [
          "pending",
          "consented",
          "creating_checkout",
          "processing",
        ]),
        lte(billingSetupRequests.expiresAt, now),
      ),
    );
  const setups = await db
    .select()
    .from(billingSetupRequests)
    .where(
      and(
        inArray(billingSetupRequests.status, [
          "consented",
          "creating_checkout",
          "processing",
        ]),
        isNotNull(billingSetupRequests.operationStartedAt),
        or(
          isNull(billingSetupRequests.leaseUntil),
          lte(billingSetupRequests.leaseUntil, now),
        ),
      ),
    )
    .orderBy(asc(billingSetupRequests.updatedAt))
    .limit(10);
  for (const setup of setups)
    await attempt(async () => {
      if (setup.stripeSessionId)
        await reconcileCheckoutSession(setup.stripeSessionId, stripe, db, now);
      else if (setup.operationStartedAt)
        await beginBillingCheckout(
          setup.id,
          setup.expectedUserId,
          stripe,
          db,
          now,
        );
      await db
        .update(billingSetupRequests)
        .set({ updatedAt: now })
        .where(eq(billingSetupRequests.id, setup.id));
    });
  // Account blocking and UTC period boundaries cancel permissions before any further dialing.
  const active = await db
    .select()
    .from(calls)
    .where(
      and(eq(calls.fundingSource, "stripe_postpaid"), isNull(calls.endedAt)),
    )
    .orderBy(calls.updatedAt)
    .limit(50);
  for (const call of active)
    await attempt(async () => {
      const permitted = await db.transaction(async (tx) => {
        await lockCallBillingAccount(tx, call.id);
        const [current] = await tx
          .select()
          .from(calls)
          .where(eq(calls.id, call.id))
          .for("update");
        return (
          current &&
          (
            await stripeCallAuthority(
              tx,
              current,
              current.scheduledFor && current.scheduledFor > now
                ? current.scheduledFor
                : now,
            )
          )?.allowed
        );
      });
      if (!permitted) await cancelConnect(call.id, call.clientId, db);
    });
  const usage = await db
    .select({ callId: billingCallUsage.callReference })
    .from(billingCallUsage)
    .innerJoin(calls, eq(calls.id, billingCallUsage.callReference))
    .where(
      and(
        inArray(billingCallUsage.state, ["reserved", "metering_pending"]),
        isNotNull(calls.endedAt),
      ),
    )
    .orderBy(billingCallUsage.updatedAt)
    .limit(50);
  for (const row of usage)
    await attempt(() => finalizeStripeUsage(row.callId, db, now));
  const periods = await db
    .select()
    .from(billingPeriods)
    .where(
      and(
        inArray(billingPeriods.status, ["open", "closing"]),
        lte(billingPeriods.endsAt, now),
      ),
    )
    .orderBy(billingPeriods.endsAt)
    .limit(20);
  for (const period of periods)
    await attempt(() => closeBillingPeriod(period.id, db, now));
  const invoices = await db
    .select()
    .from(billingInvoices)
    .where(inArray(billingInvoices.issuanceState, ["pending", "creating"]))
    .orderBy(billingInvoices.updatedAt)
    .limit(10);
  for (const invoice of invoices)
    await attempt(() => issueMonthlyInvoice(invoice.id, stripe, db, now));
  const open = await db
    .select()
    .from(billingInvoices)
    .where(
      and(
        eq(billingInvoices.issuanceState, "ready"),
        inArray(billingInvoices.stripeStatus, ["draft", "open"]),
      ),
    )
    .orderBy(billingInvoices.reconciledAt)
    .limit(10);
  for (const invoice of open)
    if (invoice.stripeInvoiceId)
      await attempt(() =>
        reconcileMonthlyInvoice(invoice.stripeInvoiceId!, stripe, db, now),
      );
  const accounts = await db
    .select()
    .from(billingAccounts)
    .where(isNotNull(billingAccounts.stripeCustomerId))
    .orderBy(billingAccounts.updatedAt)
    .limit(20);
  for (const account of accounts)
    await attempt(() => syncInvoiceCollection(account.id, stripe, db, now));
  return {
    events,
    setups: setups.length,
    usage: usage.length,
    periods: periods.length,
    invoices: invoices.length,
    deferred,
  };
}
