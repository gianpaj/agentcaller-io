import { randomUUID } from "node:crypto";
import {
  billingAccounts,
  billingAuthorizations,
  billingCallUsage,
  billingInvoices,
  billingPeriods,
} from "@agentcaller/database";
import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type Stripe from "stripe";
import { ApiError } from "./auth";
import { database } from "./database";
import { billingAudit, lockBillingAccount } from "./billing-store";
import { monthlyInvoiceParams, stripeClient } from "./stripe";
import { getStripeEnv } from "./env";

class InvoiceEvidenceError extends Error {}

type Invoice = typeof billingInvoices.$inferSelect;
const retention = 23 * 3600_000;
const objectId = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;

/** Close only reconciled UTC months; unsettled holds never become invented usage. */
export async function closeBillingPeriod(
  id: string,
  db = database(),
  now = new Date(),
) {
  const [mapping] = await db
    .select()
    .from(billingPeriods)
    .where(eq(billingPeriods.id, id));
  if (!mapping || mapping.endsAt > now) return;
  return db.transaction(async (tx) => {
    const account = await lockBillingAccount(
      tx,
      mapping.billingAccountId,
      undefined,
      false,
    );
    const [period] = await tx
      .select()
      .from(billingPeriods)
      .where(eq(billingPeriods.id, id))
      .for("update");
    if (!period || period.status === "closed") return;
    await tx
      .update(billingPeriods)
      .set({ status: "closing", updatedAt: now })
      .where(eq(billingPeriods.id, id));
    const rows = await tx
      .select()
      .from(billingCallUsage)
      .where(eq(billingCallUsage.periodId, id));
    const reserved = rows
      .filter((row) => ["reserved", "metering_pending"].includes(row.state))
      .reduce((sum, row) => sum + row.reservedCents, 0);
    const spent = rows.reduce((sum, row) => sum + (row.finalCents ?? 0), 0);
    if (reserved !== period.reservedCents || spent !== period.spentCents) {
      await tx
        .update(billingAccounts)
        .set({
          status: "suspended",
          blockReason: "usage_counter_mismatch",
          updatedAt: now,
        })
        .where(eq(billingAccounts.id, account.id));
      await billingAudit(
        tx,
        account,
        `period:${id}:counter-mismatch`,
        "usage_counter_mismatch",
        "system",
        "billing-drain",
        { periodId: id },
      );
      return;
    }
    if (
      reserved ||
      rows.some((row) => !["finalized", "released"].includes(row.state))
    )
      return;
    // Stripe's USD minimum is 50 cents. Waive small totals instead of creating customer balance debt.
    const waivedCents = spent > 0 && spent < 50 ? spent : 0;
    const totalCents = spent - waivedCents;
    if (totalCents && (!account.stripeCustomerId || !account.paymentMethodId))
      return;
    if (totalCents)
      await tx
        .insert(billingInvoices)
        .values({
          clientId: account.clientId,
          billingAccountId: account.id,
          periodId: id,
          expectedCents: totalCents,
          stripeCustomerId: account.stripeCustomerId!,
          paymentMethodId: account.paymentMethodId!,
        })
        .onConflictDoNothing({ target: billingInvoices.periodId });
    await tx
      .update(billingPeriods)
      .set({
        status: "closed",
        totalCents,
        waivedCents,
        closedAt: now,
        updatedAt: now,
      })
      .where(eq(billingPeriods.id, id));
    await billingAudit(
      tx,
      account,
      `period:${id}:closed`,
      "period_closed",
      "system",
      "billing-drain",
      { periodId: id, totalCents, waivedCents },
    );
  });
}

function binding(invoice: Stripe.Invoice, row: Invoice, livemode: boolean) {
  if (
    invoice.livemode !== livemode ||
    objectId(invoice.customer) !== row.stripeCustomerId ||
    invoice.currency !== "usd" ||
    invoice.metadata?.billing_invoice_id !== row.id ||
    invoice.metadata.billing_account_id !== row.billingAccountId ||
    invoice.metadata.billing_period_id !== row.periodId ||
    invoice.collection_method !== "charge_automatically" ||
    invoice.parent
  )
    throw new InvoiceEvidenceError("Invoice binding mismatch");
}
function exactTotal(invoice: Stripe.Invoice, row: Invoice) {
  if (
    invoice.total !== row.expectedCents ||
    invoice.amount_due !== row.expectedCents ||
    invoice.starting_balance !== 0 ||
    invoice.pre_payment_credit_notes_amount !== 0 ||
    invoice.post_payment_credit_notes_amount !== 0 ||
    invoice.amount_overpaid !== 0 ||
    invoice.total_discount_amounts?.some((discount) => discount.amount !== 0) ||
    invoice.total_taxes?.some((tax) => tax.amount !== 0)
  )
    throw new InvoiceEvidenceError("Invoice requires accounting review");
}
async function invoiceLines(stripe: Stripe, id: string) {
  const page = await stripe.invoices.listLineItems(id, { limit: 100 });
  if (page.has_more)
    throw new InvoiceEvidenceError("Unexpected invoice line count");
  return page.data;
}
async function review(
  row: Invoice,
  reason: string,
  db: ReturnType<typeof database>,
  now: Date,
) {
  await db.transaction(async (tx) => {
    const account = await lockBillingAccount(
      tx,
      row.billingAccountId,
      undefined,
      false,
    );
    await tx
      .update(billingInvoices)
      .set({
        issuanceState: "unknown",
        leaseToken: null,
        leaseUntil: null,
        lastError: reason,
        updatedAt: now,
      })
      .where(eq(billingInvoices.id, row.id));
    await tx
      .update(billingAccounts)
      .set({ status: "suspended", blockReason: reason, updatedAt: now })
      .where(eq(billingAccounts.id, account.id));
    await billingAudit(
      tx,
      account,
      `invoice:${row.id}:review:${reason}`,
      "invoice_review_required",
      "system",
      "billing-drain",
      { invoiceId: row.id, reason },
    );
  });
}

/** Retry issuance operations with stable keys; Stripe owns collection and payment recovery. */
export async function issueMonthlyInvoice(
  id: string,
  stripe: Stripe = stripeClient(),
  db = database(),
  now = new Date(),
) {
  const [mapping] = await db
    .select()
    .from(billingInvoices)
    .where(eq(billingInvoices.id, id));
  if (!mapping) return;
  const lease = randomUUID(),
    started = performance.now();
  const row = await db.transaction(async (tx) => {
    const account = await lockBillingAccount(
      tx,
      mapping.billingAccountId,
      undefined,
      false,
    );
    const [current] = await tx
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.id, id))
      .for("update");
    if (
      !current ||
      ["ready", "unknown"].includes(current.issuanceState) ||
      (current.leaseUntil && current.leaseUntil > now)
    )
      return null;
    if (account.livemode !== getStripeEnv().livemode)
      throw new Error("Stripe mode mismatch");
    const [claimed] = await tx
      .update(billingInvoices)
      .set({
        issuanceState: "creating",
        leaseToken: lease,
        leaseUntil: new Date(now.getTime() + 120_000),
        createStartedAt: current.createStartedAt ?? now,
        updatedAt: now,
      })
      .where(eq(billingInvoices.id, id))
      .returning();
    return claimed!;
  });
  if (!row) return;
  const ownsLease = async () => {
    const [current] = await db
      .select()
      .from(billingInvoices)
      .where(
        and(eq(billingInvoices.id, id), eq(billingInvoices.leaseToken, lease)),
      );
    if (
      !current ||
      !current.leaseUntil ||
      current.leaseUntil.getTime() <=
        now.getTime() + performance.now() - started
    )
      throw new Error("Issuance lease expired");
    return current;
  };
  const update = async (
    values: Partial<typeof billingInvoices.$inferInsert>,
  ) => {
    const [updated] = await db
      .update(billingInvoices)
      .set({ ...values, updatedAt: now })
      .where(
        and(eq(billingInvoices.id, id), eq(billingInvoices.leaseToken, lease)),
      )
      .returning();
    if (!updated) throw new Error("Issuance lease lost");
    return updated;
  };
  try {
    let current = row,
      invoice: Stripe.Invoice;
    if (current.stripeInvoiceId)
      invoice = await stripe.invoices.retrieve(current.stripeInvoiceId);
    else {
      if (now.getTime() - row.createStartedAt!.getTime() > retention) {
        // Exhaustive customer pagination is safe after Stripe's idempotency retention.
        const found: Stripe.Invoice[] = [];
        for await (const candidate of stripe.invoices.list({
          customer: row.stripeCustomerId,
          limit: 100,
        })) {
          if (candidate.metadata?.billing_invoice_id === row.id)
            found.push(candidate);
        }
        if (found.length !== 1) {
          await review(row, "invoice_create_unknown", db, now);
          return;
        }
        invoice = found[0]!;
      } else
        invoice = await stripe.invoices.create(
          monthlyInvoiceParams({
            customerId: row.stripeCustomerId,
            paymentMethodId: row.paymentMethodId,
            accountId: row.billingAccountId,
            invoiceId: row.id,
            periodId: row.periodId,
          }),
          { idempotencyKey: `monthly:${id}:create:v1` },
        );
      current = await update({ stripeInvoiceId: invoice.id });
    }
    binding(invoice, current, getStripeEnv().livemode);
    if (invoice.status !== "draft") {
      exactTotal(invoice, current);
      await update({
        issuanceState: "ready",
        stripeStatus: invoice.status,
        leaseToken: null,
        leaseUntil: null,
      });
      await reconcileMonthlyInvoice(invoice.id, stripe, db, now);
      return;
    }
    let lines = await invoiceLines(stripe, invoice.id);
    if (!current.stripeItemId) {
      const existing = lines.filter(
        (line) => line.metadata.billing_invoice_id === id,
      );
      if (existing.length > 1 || lines.length > 1)
        throw new InvoiceEvidenceError("Unexpected invoice lines");
      let itemId = existing[0]?.parent?.invoice_item_details?.invoice_item;
      if (!itemId) {
        if (
          current.itemStartedAt &&
          now.getTime() - current.itemStartedAt.getTime() > retention
        ) {
          await review(current, "invoice_item_unknown", db, now);
          return;
        }
        await ownsLease();
        current = await update({ itemStartedAt: current.itemStartedAt ?? now });
        const item = await stripe.invoiceItems.create(
          {
            customer: current.stripeCustomerId,
            invoice: invoice.id,
            amount: current.expectedCents,
            currency: "usd",
            description: "AgentCaller connected call usage",
            metadata: {
              billing_invoice_id: id,
              billing_period_id: current.periodId,
            },
          },
          { idempotencyKey: `monthly:${id}:item:v1` },
        );
        if (
          objectId(item.invoice) !== invoice.id ||
          item.amount !== current.expectedCents ||
          objectId(item.customer) !== current.stripeCustomerId ||
          item.currency !== "usd"
        )
          throw new InvoiceEvidenceError("Invoice item binding mismatch");
        itemId = item.id;
      }
      current = await update({ stripeItemId: itemId });
    }
    lines = await invoiceLines(stripe, invoice.id);
    invoice = await stripe.invoices.retrieve(invoice.id);
    binding(invoice, current, getStripeEnv().livemode);
    exactTotal(invoice, current);
    if (
      lines.length !== 1 ||
      lines[0]!.parent?.invoice_item_details?.invoice_item !==
        current.stripeItemId ||
      lines[0]!.metadata.billing_invoice_id !== id ||
      lines[0]!.amount !== current.expectedCents
    )
      throw new InvoiceEvidenceError("Invoice line binding mismatch");
    await ownsLease();
    current = await update({
      finalizeStartedAt: current.finalizeStartedAt ?? now,
    });
    // Serialize the final collection instruction with consent withdrawal and card replacement.
    await db.transaction(async (tx) => {
      const account = await lockBillingAccount(
        tx,
        current.billingAccountId,
        undefined,
        false,
      );
      const [owned] = await tx
        .select()
        .from(billingInvoices)
        .where(
          and(
            eq(billingInvoices.id, id),
            eq(billingInvoices.leaseToken, lease),
          ),
        )
        .for("update");
      if (!owned || !owned.leaseUntil || owned.leaseUntil <= now)
        throw new Error("Issuance lease lost");
      if (
        !account.collectionConsent ||
        account.status === "revoked" ||
        account.status === "suspended"
      ) {
        await tx
          .update(billingInvoices)
          .set({ leaseToken: null, leaseUntil: null, updatedAt: now })
          .where(eq(billingInvoices.id, id));
        return;
      }
      await tx
        .update(billingInvoices)
        .set({ finalizeStartedAt: owned.finalizeStartedAt ?? now })
        .where(eq(billingInvoices.id, id));
      await stripe.invoices.update(
        invoice.id,
        {
          default_payment_method: account.paymentMethodId!,
          auto_advance: false,
        },
        { idempotencyKey: `monthly:${id}:card:${account.cardGeneration}` },
      );
      const finalized = await stripe.invoices.finalizeInvoice(
        invoice.id,
        { auto_advance: true },
        { idempotencyKey: `monthly:${id}:finalize:v1` },
      );
      binding(finalized, current, account.livemode);
      exactTotal(finalized, current);
      await tx
        .update(billingInvoices)
        .set({
          paymentMethodId: account.paymentMethodId!,
          issuanceState: "ready",
          stripeStatus: finalized.status,
          leaseToken: null,
          leaseUntil: null,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(billingInvoices.id, id));
      await billingAudit(
        tx,
        account,
        `invoice:${id}:issued`,
        "invoice_issued",
        "system",
        "billing-drain",
        {
          invoiceId: id,
          periodId: current.periodId,
          expectedCents: current.expectedCents,
        },
      );
    });
  } catch (error) {
    if (error instanceof InvoiceEvidenceError) {
      await review(row, "invoice_binding_review", db, now);
      return;
    }
    // Unknown outcomes retry the same operation. Never create a replacement or call invoices.pay.
    await db
      .update(billingInvoices)
      .set({
        leaseToken: null,
        leaseUntil: null,
        lastError: "issuance_reconciliation_required",
        updatedAt: now,
      })
      .where(
        and(eq(billingInvoices.id, id), eq(billingInvoices.leaseToken, lease)),
      );
  }
}

/** A paid status alone is insufficient: require allocated, successful card payment evidence. */
export async function reconcileMonthlyInvoice(
  stripeId: string,
  stripe: Stripe = stripeClient(),
  db = database(),
  now = new Date(),
) {
  const invoice = await stripe.invoices.retrieve(stripeId);
  const [row] = await db
    .select()
    .from(billingInvoices)
    .where(eq(billingInvoices.stripeInvoiceId, stripeId));
  if (!row || invoice.status === "draft") return;
  try {
    binding(invoice, row, getStripeEnv().livemode);
    exactTotal(invoice, row);
  } catch {
    await review(row, "invoice_adjustment_review", db, now);
    return;
  }
  let verifiedCash = 0;
  if (invoice.status === "paid") {
    const seen = new Set<string>();
    for await (const payment of stripe.invoicePayments.list({
      invoice: stripeId,
      status: "paid",
      limit: 100,
      expand: ["data.payment.payment_intent.latest_charge"],
    })) {
      const intent = payment.payment.payment_intent;
      if (seen.has(payment.id)) continue;
      seen.add(payment.id);
      if (
        objectId(payment.invoice) !== stripeId ||
        payment.livemode !== invoice.livemode ||
        payment.currency !== "usd" ||
        payment.status !== "paid" ||
        payment.payment.type !== "payment_intent" ||
        !intent ||
        typeof intent === "string" ||
        intent.status !== "succeeded" ||
        intent.livemode !== invoice.livemode ||
        intent.currency !== "usd" ||
        objectId(intent.customer) !== row.stripeCustomerId ||
        intent.amount_received < (payment.amount_paid ?? 0)
      )
        continue;
      const charge =
        typeof intent.latest_charge === "string"
          ? await stripe.charges.retrieve(intent.latest_charge)
          : intent.latest_charge;
      if (
        !charge ||
        !charge.paid ||
        charge.status !== "succeeded" ||
        charge.disputed ||
        charge.refunded ||
        charge.amount_refunded !== 0 ||
        objectId(charge.payment_intent) !== intent.id ||
        objectId(charge.customer) !== row.stripeCustomerId ||
        charge.livemode !== invoice.livemode ||
        charge.currency !== "usd" ||
        charge.payment_method_details?.type !== "card"
      )
        continue;
      verifiedCash += payment.amount_paid ?? 0;
    }
    if (
      verifiedCash !== row.expectedCents ||
      invoice.amount_paid !== row.expectedCents ||
      invoice.amount_remaining !== 0
    ) {
      await review(row, "invoice_cash_review", db, now);
      return;
    }
  }
  await db.transaction(async (tx) => {
    const account = await lockBillingAccount(
      tx,
      row.billingAccountId,
      undefined,
      false,
    );
    const [period] = await tx
      .select()
      .from(billingPeriods)
      .where(eq(billingPeriods.id, row.periodId))
      .for("update");
    const [current] = await tx
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.id, row.id))
      .for("update");
    if (!current || !period) throw new Error("Missing invoice ownership");
    if (current.stripeStatus === "paid" && invoice.status !== "paid") return;
    const lastError =
      current.issuanceState === "unknown" ? current.lastError : null;
    await tx
      .update(billingInvoices)
      .set({
        stripeStatus: invoice.status,
        amountPaid: invoice.amount_paid,
        amountRemaining: invoice.amount_remaining,
        actionRequired: invoice.status === "open" && !!invoice.attempted,
        issuanceState:
          current.issuanceState === "unknown" ? "unknown" : "ready",
        lastError,
        reconciledAt: now,
        updatedAt: now,
      })
      .where(eq(billingInvoices.id, row.id));
    if (verifiedCash) {
      await tx
        .update(billingPeriods)
        .set({ collectedCents: verifiedCash, updatedAt: now })
        .where(eq(billingPeriods.id, period.id));
      await billingAudit(
        tx,
        account,
        `invoice:${row.id}:cash-confirmed`,
        "invoice_cash_confirmed",
        "stripe",
        stripeId,
        { invoiceId: row.id, collectedCents: verifiedCash },
      );
      const outstanding = await tx
        .select({ id: billingInvoices.id })
        .from(billingInvoices)
        .where(
          and(
            eq(billingInvoices.billingAccountId, account.id),
            inArray(billingInvoices.stripeStatus, [
              "open",
              "uncollectible",
              "void",
            ]),
          ),
        );
      const grants = await tx
        .select({ id: billingAuthorizations.id })
        .from(billingAuthorizations)
        .where(
          and(
            eq(billingAuthorizations.billingAccountId, account.id),
            eq(billingAuthorizations.status, "active"),
          ),
        );
      if (
        !outstanding.length &&
        grants.length &&
        account.collectionConsent &&
        account.status === "past_due" &&
        account.blockReason === "invoice_payment_required"
      )
        await tx
          .update(billingAccounts)
          .set({ status: "active", blockReason: null, updatedAt: now })
          .where(eq(billingAccounts.id, account.id));
    } else if (["void", "uncollectible"].includes(invoice.status ?? "")) {
      await tx
        .update(billingAccounts)
        .set({
          status: "suspended",
          blockReason: "invoice_adjustment_review",
          updatedAt: now,
        })
        .where(eq(billingAccounts.id, account.id));
    } else if (
      invoice.status === "open" &&
      invoice.attempted &&
      !["suspended", "revoked"].includes(account.status)
    )
      await tx
        .update(billingAccounts)
        .set({
          status: "past_due",
          blockReason: "invoice_payment_required",
          updatedAt: now,
        })
        .where(eq(billingAccounts.id, account.id));
  });
}

/** Apply current consent and card selection to existing unpaid invoices without retrying payment. */
export async function syncInvoiceCollection(
  accountId: string,
  stripe: Stripe = stripeClient(),
  db = database(),
  now = new Date(),
) {
  await db.transaction(async (tx) => {
    const account = await lockBillingAccount(tx, accountId, undefined, false);
    if (account.livemode !== getStripeEnv().livemode)
      throw new Error("Stripe mode mismatch");
    const rows = await tx
      .select()
      .from(billingInvoices)
      .where(
        and(
          eq(billingInvoices.billingAccountId, account.id),
          inArray(billingInvoices.stripeStatus, ["draft", "open"]),
          or(
            isNull(billingInvoices.leaseUntil),
            lte(billingInvoices.leaseUntil, now),
          ),
        ),
      );
    for (const row of rows) {
      if (!row.stripeInvoiceId) continue;
      const invoice = await stripe.invoices.retrieve(row.stripeInvoiceId);
      binding(invoice, row, account.livemode);
      if (!["draft", "open"].includes(invoice.status ?? "")) continue;
      const collect =
        account.collectionConsent &&
        !["suspended", "revoked"].includes(account.status) &&
        row.issuanceState === "ready";
      if (
        invoice.auto_advance !== collect ||
        objectId(invoice.default_payment_method) !== account.paymentMethodId
      )
        await stripe.invoices.update(invoice.id, {
          auto_advance: collect,
          ...(account.paymentMethodId
            ? { default_payment_method: account.paymentMethodId }
            : {}),
        });
      await tx
        .update(billingInvoices)
        .set({
          paymentMethodId: account.paymentMethodId ?? row.paymentMethodId,
          updatedAt: now,
        })
        .where(eq(billingInvoices.id, row.id));
    }
    await tx
      .update(billingAccounts)
      .set({ updatedAt: now })
      .where(eq(billingAccounts.id, account.id));
  });
}

export async function humanInvoiceUrl(
  clientId: string,
  id: string,
  stripe: Stripe = stripeClient(),
  db = database(),
) {
  const [row] = await db
    .select()
    .from(billingInvoices)
    .where(
      and(eq(billingInvoices.id, id), eq(billingInvoices.clientId, clientId)),
    );
  if (!row?.stripeInvoiceId) throw new ApiError(404, "Invoice is unavailable");
  const invoice = await stripe.invoices.retrieve(row.stripeInvoiceId);
  binding(invoice, row, getStripeEnv().livemode);
  if (!invoice.hosted_invoice_url)
    throw new ApiError(409, "Invoice is not published yet");
  const url = new URL(invoice.hosted_invoice_url);
  if (url.protocol !== "https:" || url.hostname !== "invoice.stripe.com")
    throw new ApiError(503, "Invoice link is unavailable");
  return url.href;
}
