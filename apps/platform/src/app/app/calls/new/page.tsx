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
        <section className="phone-panel">
          <h1>Redial unavailable</h1>
          <p>{blocked}</p>
          <Link href={`/app/calls/${call.id}`}>View call</Link>
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
  return (
    <>
      <div className="phone-title">
        <div>
          <p className="phone-eyebrow">Connect me</p>
          <h1>{redial ? "Call again" : "New call"}</h1>
        </div>
        <Link href="/app">Cancel</Link>
      </div>
      <p className="phone-muted">
        The assistant reaches the business, then connects you on your mobile.
      </p>
      <CallForm
        initial={initial}
        redialOf={redial}
        idempotencyKey={randomUUID()}
        enabled={
          profile.isOperator &&
          process.env.CONNECT_OPERATOR_CALLS_ENABLED === "true"
        }
      />
    </>
  );
}
