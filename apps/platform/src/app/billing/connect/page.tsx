import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireHumanSession } from "@/lib/portal";
import { ApiError } from "@/lib/auth";
import { getLoginUrl } from "@/lib/auth-redirect";
import {
  resolveBillingSetupToken,
  billingSetupView,
} from "@/lib/billing-setup";
import { saveBillingConsent } from "./actions";

export const dynamic = "force-dynamic";
export default async function BillingConnect({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const query = await searchParams;
  if (query.request)
    redirect(
      `/billing/connect/start?${new URLSearchParams({ request: query.request })}`,
    );
  let session;
  try {
    session = await requireHumanSession();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect(getLoginUrl("/billing/connect"));
    throw error;
  }
  const request = await resolveBillingSetupToken(
    (await cookies()).get("billing_continuation")?.value ?? "",
    session.user.id,
  );
  const { account, connection, grant, rates } = await billingSetupView(request);
  const ready = request.status === "ready";
  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-5 py-12 text-(--ink)">
      <h1 className="text-3xl font-semibold tracking-tight">
        {ready ? "Card verified" : "Authorize monthly billing"}
      </h1>
      <p>
        Integration: {connection.name}. Signed in as {session.user.email}.
      </p>
      {ready ? (
        <p>
          Your card is saved. Paid calling remains subject to account controls
          and the release gate.{" "}
          <Link href="/app/billing" className="underline">
            Manage billing
          </Link>
          .
        </p>
      ) : (
        <>
          <p>
            Calls are billed in USD at the end of each UTC calendar month. We
            charge when the business answers, even if the task is unsuccessful.
            Both connected phone legs and each started minute count. We round
            the combined call total up to a cent once.
          </p>
          <p>
            There is no subscription or upfront charge. Unpaid usage and
            reservations share a $10 ceiling across all integrations and months.
            Calls reserve their full worst-case cost; unused reservations are
            released after confirmed cleanup and usage measurement.
          </p>
          <p>
            You can stop future spending and withdraw automatic collection in
            billing settings. Charges already incurred remain due. Stripe
            handles payment reminders and card authentication.
          </p>
          <ul className="grid gap-2">
            {rates.map((rate) => (
              <li key={rate.id}>
                {rate.country}: ${(rate.connectionFeeMicros / 1e6).toFixed(4)}{" "}
                per connected leg + $
                {(rate.startedMinuteFeeMicros / 1e6).toFixed(4)} per started
                minute.
              </li>
            ))}
          </ul>
          <p>
            Pricing version: {request.pricingVersion}. Agreement:{" "}
            {request.agreementVersion}.
          </p>
          {!rates.length ? (
            <p>Approved pricing is unavailable. Card setup cannot continue.</p>
          ) : (
            <form
              action={saveBillingConsent}
              className="grid gap-5 rounded-xl border border-(--line) bg-(--panel) p-6"
            >
              <input
                type="hidden"
                name="agreementVersion"
                value={request.agreementVersion ?? ""}
              />
              <input
                type="hidden"
                name="pricingVersion"
                value={request.pricingVersion ?? ""}
              />
              <label className="grid gap-2">
                Monthly integration limit (USD cents)
                <input
                  className="rounded-md border border-(--line) bg-(--void) p-3"
                  name="monthlyLimitCents"
                  type="number"
                  min="1"
                  max={
                    account.consentVersion ? account.monthlyLimitCents : 100000
                  }
                  defaultValue={
                    request.monthlyLimitCents ||
                    grant?.monthlyLimitCents ||
                    Math.min(account.monthlyLimitCents || 1000, 1000)
                  }
                  required
                />
              </label>
              <label className="grid gap-2">
                Per-call limit (USD cents)
                <input
                  className="rounded-md border border-(--line) bg-(--void) p-3"
                  name="perCallLimitCents"
                  type="number"
                  min="1"
                  max={
                    account.consentVersion ? account.perCallLimitCents : 100000
                  }
                  defaultValue={
                    request.perCallLimitCents ||
                    grant?.perCallLimitCents ||
                    Math.min(account.perCallLimitCents || 100, 100)
                  }
                  required
                />
              </label>
              <label className="flex gap-3 leading-relaxed">
                <input type="checkbox" name="consent" value="yes" required />I
                authorize this integration to reserve and incur usage within
                these limits, and authorize AgentCaller to collect monthly usage
                from my saved card, including off-session payments. Unpaid
                invoices remain due if I revoke access.
              </label>
              <button className="min-h-12 rounded-md bg-(--signal) px-5 py-3 font-semibold text-(--void)">
                Agree and save a card with Stripe
              </button>
            </form>
          )}
        </>
      )}
    </main>
  );
}
