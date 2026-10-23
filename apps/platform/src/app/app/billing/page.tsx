import Link from "next/link";
import {
  agentConnections,
  apiKeys,
  billingAccounts,
  billingAuthorizations,
  billingInvoices,
  billingPeriods,
} from "@agentcaller/database";
import { and, desc, eq, isNull } from "drizzle-orm";
import { database } from "@/lib/database";
import { requireHumanSession, findClientProfileForUser } from "@/lib/portal";
import { isStripeBillingEnabled } from "@/lib/env";
import {
  changeBillingLimits,
  linkApiKey,
  openInvoice,
  replaceCard,
  stopCollection,
  stopIntegrationSpending,
} from "./actions";
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const field =
  "min-h-12 rounded-md border border-(--line) bg-(--void) px-3 py-2";
const button =
  "min-h-12 rounded-md border border-(--line) px-4 py-3 font-medium hover:bg-(--panel)";
function Limits({
  monthly,
  perCall,
  authorizationId = "",
}: {
  monthly: number;
  perCall: number;
  authorizationId?: string;
}) {
  return (
    <form action={changeBillingLimits} className="grid gap-3">
      <input type="hidden" name="authorizationId" value={authorizationId} />
      <label className="grid gap-2">
        Monthly limit (USD cents)
        <input
          className={field}
          type="number"
          min="1"
          name="monthlyLimitCents"
          defaultValue={monthly}
          required
        />
      </label>
      <label className="grid gap-2">
        Per-call limit (USD cents)
        <input
          className={field}
          type="number"
          min="1"
          name="perCallLimitCents"
          defaultValue={perCall}
          required
        />
      </label>
      <button className={button}>Save limits</button>
    </form>
  );
}
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string }>;
}) {
  const { user } = await requireHumanSession(),
    profile = await findClientProfileForUser(user.id),
    db = database();
  // Viewing billing must never provision a profile.
  const [account] = profile
    ? await db
        .select()
        .from(billingAccounts)
        .where(eq(billingAccounts.clientId, profile.id))
    : [];
  const query = await searchParams;
  if (!profile || !account)
    return (
      <section className="grid gap-5">
        <h1 className="text-3xl font-semibold">Billing</h1>
        <p>
          Ask your connected agent to run setup_billing, then open its approval
          link.
        </p>
        <Link href="/app/connections" className="underline">
          Connected integrations
        </Link>
      </section>
    );
  const [periods, grants, integrations, invoices, keys] = await Promise.all([
    db
      .select()
      .from(billingPeriods)
      .where(eq(billingPeriods.billingAccountId, account.id))
      .orderBy(desc(billingPeriods.startsAt))
      .limit(24),
    db
      .select()
      .from(billingAuthorizations)
      .where(eq(billingAuthorizations.billingAccountId, account.id)),
    db
      .select()
      .from(agentConnections)
      .where(eq(agentConnections.clientId, profile.id)),
    db
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.billingAccountId, account.id))
      .orderBy(desc(billingInvoices.createdAt))
      .limit(24),
    db
      .select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.clientId, profile.id),
          isNull(apiKeys.revokedAt),
          isNull(apiKeys.connectionId),
        ),
      ),
  ]);
  const activeConnections = integrations.filter(
    (row) => row.status === "active",
  );
  return (
    <section className="grid gap-7">
      <h1 className="text-3xl font-semibold tracking-tight">Billing</h1>
      {!isStripeBillingEnabled() && (
        <p className="rounded-lg border border-(--line) p-4">
          Paid calling is disabled. Billing setup does not enable live calls.
        </p>
      )}
      <p>
        Status: {account.status.replaceAll("_", " ")}
        {account.blockReason
          ? ` (${account.blockReason.replaceAll("_", " ")})`
          : ""}
        .
      </p>
      <p>
        {account.cardLast4
          ? `${account.cardBrand} ending ${account.cardLast4}, expires ${account.cardExpiryMonth}/${account.cardExpiryYear}.`
          : "No verified card."}{" "}
        Automatic collection:{" "}
        {account.collectionConsent ? "authorized" : "withdrawn"}.
      </p>
      <p>
        Shared exposure:{" "}
        {usd(
          periods.reduce(
            (sum, period) =>
              sum +
              period.spentCents -
              period.collectedCents -
              period.waivedCents +
              period.reservedCents,
            0,
          ),
        )}{" "}
        of {usd(account.creditLimitCents)}. This includes unpaid usage and
        reservations across integrations and months.
      </p>
      <h2 className="text-xl font-semibold">Account limits</h2>
      <Limits
        monthly={account.monthlyLimitCents}
        perCall={account.perCallLimitCents}
      />
      <h2 className="text-xl font-semibold">Integration spending</h2>
      {grants.map((grant) => (
        <article
          key={grant.id}
          className="grid gap-4 rounded-xl border border-(--line) p-5"
        >
          <h3 className="font-semibold">
            {integrations.find((row) => row.id === grant.connectionId)?.name ??
              "Integration"}
            : {grant.status}
          </h3>
          {grant.status === "active" && (
            <>
              <Limits
                monthly={grant.monthlyLimitCents}
                perCall={grant.perCallLimitCents}
                authorizationId={grant.id}
              />
              <form action={stopIntegrationSpending}>
                <input
                  type="hidden"
                  name="connectionId"
                  value={grant.connectionId}
                />
                <button className={button}>
                  Revoke spending and cancel outstanding calls
                </button>
              </form>
            </>
          )}
        </article>
      ))}
      {!!activeConnections.length && (
        <form action={replaceCard} className="grid gap-3">
          <label className="grid gap-2">
            Integration for card setup
            <select className={field} name="connectionId">
              {activeConnections.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <button className={button}>
            Replace saved card or renew collection consent
          </button>
        </form>
      )}
      <form action={stopCollection} className="grid gap-3">
        <p>
          Withdrawing collection consent blocks new paid calls and asks Stripe
          to stop automatic invoice collection. An in-flight payment can still
          complete. Existing usage remains due.
        </p>
        <button className={button}>
          Withdraw automatic collection consent
        </button>
      </form>
      {query.collection && (
        <p role="status">
          {query.collection === "pending"
            ? "New spending is blocked. Stripe collection updates are pending reconciliation; an in-flight payment may still complete."
            : "Collection consent is withdrawn. Stripe automation is paused for unpaid invoices; an in-flight payment may still complete."}
        </p>
      )}
      <h2 className="text-xl font-semibold">Monthly usage and invoices</h2>
      {periods.map((period) => (
        <p key={period.id}>
          {period.startsAt.toISOString().slice(0, 7)} UTC:{" "}
          {usd(period.spentCents)} used, {usd(period.reservedCents)} reserved,{" "}
          {usd(period.collectedCents)} collected, {usd(period.waivedCents)}{" "}
          waived. {period.status}.
        </p>
      ))}
      {invoices.map((invoice) => (
        <form
          action={openInvoice}
          key={invoice.id}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p>
            {usd(invoice.expectedCents)} ·{" "}
            {invoice.stripeStatus ?? invoice.issuanceState}
            {invoice.actionRequired ? " · Payment requires attention" : ""}
          </p>
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <button
            className={button}
            disabled={
              !invoice.stripeInvoiceId || invoice.stripeStatus === "draft"
            }
          >
            Open private Stripe invoice
          </button>
        </form>
      ))}
      {!!keys.length && !!activeConnections.length && (
        <form action={linkApiKey} className="grid gap-3">
          <h2 className="text-xl font-semibold">Link an API key</h2>
          <p>
            Linking gives this key access to the selected integration's spending
            allowance. It does not create extra headroom.
          </p>
          <label className="grid gap-2">
            API key
            <select className={field} name="keyId">
              {keys.map((key) => (
                <option key={key.id} value={key.id}>
                  {key.name} ({key.prefix})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2">
            Integration
            <select className={field} name="connectionId">
              {activeConnections.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <button className={button}>Link key to integration</button>
        </form>
      )}
      <Link href="/app/connections" className="underline">
        Manage tool access
      </Link>
    </section>
  );
}
