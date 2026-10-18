import { randomUUID } from "node:crypto";
import Link from "next/link";
import { createCallSchema } from "@agentcaller/contracts";
import { requireClientProfile } from "@/lib/portal";
import { loadCallHistory } from "@/lib/call-history";
import { redialBlock } from "@/lib/call-display";
import { CallForm } from "./call-form";
export default async function NewCallPage({
  searchParams,
}: {
  searchParams: Promise<{ redial?: string }>;
}) {
  const profile = await requireClientProfile();
  const { redial } = await searchParams;
  let initial;
  if (redial) {
    const { call } = await loadCallHistory(profile.id, redial);
    const blocked = redialBlock(call);
    if (blocked)
      return (
        <section className="grid w-full min-w-0 gap-5 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 sm:p-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
            Redial unavailable
          </h1>
          <p className="text-base leading-7 text-[var(--muted)]">{blocked}</p>
          <Link
            className="inline-flex min-h-12 w-fit items-center rounded-md border border-[var(--muted)] px-4 py-3 text-base font-medium text-[var(--ink)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
            href={`/app/calls/${call.id}`}
          >
            View call
          </Link>
        </section>
      );
    const parsed = createCallSchema.safeParse({
      ...call,
      voiceId: call.voiceId ?? undefined,
      clientReference: call.clientReference ?? undefined,
      maxAmountUsd: call.maxAmountMicros / 1e6,
    });
    if (parsed.success) initial = parsed.data;
  }
  const idempotencyKey = randomUUID();
  return (
    <>
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium text-[var(--signal)]">Connect me</p>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] sm:text-4xl">
            {redial ? "Call again" : "New call"}
          </h1>
        </div>
        <Link
          className="inline-flex min-h-11 shrink-0 items-center px-3 py-2 text-base text-[var(--muted)] underline underline-offset-4 hover:text-[var(--ink)]"
          href="/app"
        >
          Cancel
        </Link>
      </div>
      <p className="mb-6 text-base leading-7 text-[var(--muted)] sm:mb-8">
        The assistant reaches the business, then connects you on your mobile.
      </p>
      <CallForm
        key={idempotencyKey}
        initial={initial}
        redialOf={redial}
        idempotencyKey={idempotencyKey}
        enabled={
          profile.isOperator &&
          process.env.CONNECT_OPERATOR_CALLS_ENABLED === "true"
        }
      />
    </>
  );
}
