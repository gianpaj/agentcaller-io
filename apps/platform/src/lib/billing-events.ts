import {
  billingAccounts,
  billingInvoices,
  billingSetupRequests,
  stripeEvents,
} from "@agentcaller/database";
import { and, eq, inArray, lte, or, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import { stripeClient } from "./stripe";
import { database } from "./database";
import { getStripeEnv } from "./env";
import { billingAudit, lockBillingAccount } from "./billing-store";
import { reconcileCheckoutSession } from "./billing-setup";
import { reconcileMonthlyInvoice } from "./billing-invoices";

const objectId = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
export async function blockBillingAccount(
  accountId: string,
  reason: string,
  eventId: string,
  db = database(),
  now = new Date(),
) {
  await db.transaction(async (tx) => {
    const account = await lockBillingAccount(tx, accountId, undefined, false);
    await tx
      .update(billingAccounts)
      .set({
        status: account.status === "revoked" ? "revoked" : "suspended",
        blockReason:
          account.status === "suspended" &&
          account.blockReason !== "saved_card_unavailable"
            ? account.blockReason
            : reason,
        updatedAt: now,
      })
      .where(eq(billingAccounts.id, account.id));
    await billingAudit(
      tx,
      account,
      `stripe:${eventId}:review`,
      "stripe_review_required",
      "stripe",
      eventId,
      { reason },
    );
  });
}
async function processEvent(
  row: typeof stripeEvents.$inferSelect,
  stripe: Stripe,
  db: ReturnType<typeof database>,
  now: Date,
) {
  if (row.type.startsWith("checkout.session."))
    return reconcileCheckoutSession(row.objectId, stripe, db, now);
  if (row.type.startsWith("setup_intent.")) {
    const intent = await stripe.setupIntents.retrieve(row.objectId);
    if (intent.livemode !== row.livemode)
      throw new Error("Setup environment mismatch");
    const [request] = await db
      .select()
      .from(billingSetupRequests)
      .where(
        eq(
          billingSetupRequests.id,
          intent.metadata?.setup_request_id ??
            "00000000-0000-0000-0000-000000000000",
        ),
      );
    if (!request || ["revoked", "expired", "ready"].includes(request.status))
      return;
    if (!request.stripeSessionId) throw new Error("Session mapping pending");
    return reconcileCheckoutSession(request.stripeSessionId, stripe, db, now);
  }
  if (row.type.startsWith("invoice.")) {
    if (row.type === "invoice.deleted") {
      const [mapping] = await db
        .select()
        .from(billingInvoices)
        .where(eq(billingInvoices.stripeInvoiceId, row.objectId));
      if (mapping)
        await blockBillingAccount(
          mapping.billingAccountId,
          "invoice_deleted_review",
          row.eventId,
          db,
          now,
        );
      return;
    }
    // A webhook can arrive before a create response maps the invoice ID. Retry rather than drop it.
    const invoice = await stripe.invoices.retrieve(row.objectId);
    const [mapping] = await db
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.stripeInvoiceId, row.objectId));
    if (!mapping && invoice.metadata?.billing_invoice_id)
      throw new Error("Invoice mapping pending");
    return reconcileMonthlyInvoice(row.objectId, stripe, db, now);
  }
  if (row.type === "payment_method.detached") {
    const method = await stripe.paymentMethods.retrieve(row.objectId);
    const accounts = await db
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.paymentMethodId, row.objectId));
    for (const account of accounts)
      if (
        method.livemode === account.livemode &&
        objectId(method.customer) !== account.stripeCustomerId
      )
        await blockBillingAccount(
          account.id,
          "saved_card_unavailable",
          row.eventId,
          db,
          now,
        );
    return;
  }
  if (row.type === "customer.updated") {
    const customer = await stripe.customers.retrieve(row.objectId);
    const [account] = await db
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.stripeCustomerId, row.objectId));
    if (!account) return;
    if (customer.deleted)
      return blockBillingAccount(
        account.id,
        "stripe_customer_unavailable",
        row.eventId,
        db,
        now,
      );
    if (customer.livemode !== account.livemode)
      throw new Error("Customer environment mismatch");
    if (account.paymentMethodId) {
      const method = await stripe.paymentMethods.retrieve(
        account.paymentMethodId,
      );
      if (objectId(method.customer) !== customer.id || method.type !== "card")
        await blockBillingAccount(
          account.id,
          "saved_card_unavailable",
          row.eventId,
          db,
          now,
        );
    }
    return;
  }
  // Refunds, credits and disputes are observations for operator review, never invented cash or waivers.
  let customerId: string | undefined;
  if (row.type.startsWith("credit_note.")) {
    const credit = await stripe.creditNotes.retrieve(row.objectId);
    if (credit.livemode !== row.livemode)
      throw new Error("Credit environment mismatch");
    customerId = objectId(credit.customer);
  } else {
    let chargeId: string | undefined;
    if (row.type.startsWith("refund."))
      chargeId = objectId((await stripe.refunds.retrieve(row.objectId)).charge);
    else if (row.type.startsWith("charge.dispute."))
      chargeId = objectId(
        (await stripe.disputes.retrieve(row.objectId)).charge,
      );
    else if (row.type === "charge.refunded") chargeId = row.objectId;
    if (chargeId) {
      const charge = await stripe.charges.retrieve(chargeId);
      if (charge.livemode !== row.livemode)
        throw new Error("Charge environment mismatch");
      customerId = objectId(charge.customer);
    }
  }
  if (customerId) {
    const [account] = await db
      .select()
      .from(billingAccounts)
      .where(
        and(
          eq(billingAccounts.stripeCustomerId, customerId),
          eq(billingAccounts.livemode, row.livemode),
        ),
      );
    if (account)
      await blockBillingAccount(
        account.id,
        "stripe_adjustment_review",
        row.eventId,
        db,
        now,
      );
  }
}

/** Leases retry event delivery/reconciliation, never payment attempts. Store routing and safe error codes only. */
export async function drainStripeEvents(
  stripe: Stripe = stripeClient(),
  db = database(),
  now = new Date(),
  limit = 20,
) {
  let processed = 0,
    deferred = 0;
  for (let index = 0; index < limit; index++) {
    const leaseUntil = new Date(now.getTime() + 120_000);
    const row = await db.transaction(async (tx) => {
      const [next] = await tx
        .select()
        .from(stripeEvents)
        .where(
          and(
            eq(stripeEvents.livemode, getStripeEnv().livemode),
            inArray(stripeEvents.status, ["pending", "processing", "failed"]),
            lte(stripeEvents.nextAttemptAt, now),
            or(
              isNull(stripeEvents.leaseUntil),
              lte(stripeEvents.leaseUntil, now),
            ),
          ),
        )
        .orderBy(stripeEvents.receivedAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!next) return null;
      const [claimed] = await tx
        .update(stripeEvents)
        .set({ status: "processing", leaseUntil, attempts: next.attempts + 1 })
        .where(
          and(
            eq(stripeEvents.eventId, next.eventId),
            eq(stripeEvents.livemode, next.livemode),
          ),
        )
        .returning();
      return claimed!;
    });
    if (!row) break;
    const owns = and(
      eq(stripeEvents.eventId, row.eventId),
      eq(stripeEvents.livemode, row.livemode),
      eq(stripeEvents.leaseUntil, leaseUntil),
      eq(stripeEvents.attempts, row.attempts),
    );
    try {
      await processEvent(row, stripe, db, now);
      await db
        .update(stripeEvents)
        .set({
          status: "processed",
          processedAt: now,
          leaseUntil: null,
          lastError: null,
        })
        .where(owns);
      processed++;
    } catch {
      await db
        .update(stripeEvents)
        .set({
          status: "failed",
          leaseUntil: null,
          nextAttemptAt: new Date(
            now.getTime() +
              Math.min(3600_000, 30_000 * 2 ** Math.min(row.attempts, 7)),
          ),
          lastError: "stripe_reconciliation_required",
        })
        .where(owns);
      deferred++;
    }
  }
  return { processed, deferred };
}
