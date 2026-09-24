import Link from "next/link";
import { Phone, PhoneOutgoing, Plus, ChevronRight } from "lucide-react";
import { requireClientProfile } from "@/lib/portal";
import { historyCursor, listCallHistory } from "@/lib/call-history";
import {
  dateLabel,
  humanize,
  outcomeReason,
  redialBlock,
} from "@/lib/call-display";
import { LiveProgress } from "./live-progress";
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ at?: string; before?: string }>;
}) {
  const profile = await requireClientProfile();
  const params = await searchParams;
  const cursor = historyCursor.safeParse({ at: params.at, id: params.before });
  const rows = await listCallHistory(
    profile.id,
    cursor.success ? cursor.data : undefined,
  );
  const visible = rows.slice(0, 30),
    last = visible.at(-1);
  return (
    <>
      <div className="phone-title">
        <div>
          <p className="phone-eyebrow">Your calling assistant</p>
          <h1>Recents</h1>
        </div>
        <Link href="/app/calls/new" className="phone-primary">
          <Plus size={20} />
          New call
        </Link>
      </div>
      <LiveProgress
        active={visible.some((call) => !call.endedAt)}
      />
      {!visible.length ? (
        <section className="phone-empty">
          <Phone size={36} />
          <h2>No calls yet</h2>
          <p>
            Start a call to a business. Every attempt and its outcome will
            appear here.
          </p>
          <Link href="/app/calls/new" className="phone-primary">
            Make your first call
          </Link>
        </section>
      ) : (
        <ul className="phone-recents">
          {visible.map((call) => (
            <li key={call.id}>
              <span
                className={`phone-avatar ${call.state === "failed" ? "phone-failed" : ""}`}
              >
                <PhoneOutgoing size={22} />
              </span>
              <Link href={`/app/calls/${call.id}`} className="phone-call-link">
                <strong>{call.clientReference || call.destination}</strong>
                {call.clientReference && <span>{call.destination}</span>}
                <span className={call.state === "failed" ? "phone-error" : ""}>
                  {humanize(call.state)}
                  {outcomeReason(call.outcome)
                    ? ` · ${humanize(outcomeReason(call.outcome)!)}`
                    : ""}
                </span>
                <time dateTime={call.createdAt.toISOString()}>
                  {dateLabel(call.createdAt)}
                </time>
              </Link>
              {!redialBlock(call) ? (
                <Link
                  href={`/app/calls/new?redial=${call.id}`}
                  className="phone-icon"
                  aria-label={`Redial ${call.destination}`}
                  title="Review and redial"
                >
                  <Phone size={22} />
                </Link>
              ) : (
                <Link
                  href={`/app/calls/${call.id}`}
                  className="phone-icon"
                  aria-label={`View ${call.destination}`}
                >
                  <ChevronRight size={22} />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="phone-pagination">
        {cursor.success && <Link href="/app">Latest calls</Link>}
        {rows.length > 30 && last && (
          <Link
            href={`/app?at=${encodeURIComponent(last.createdAt.toISOString())}&before=${last.id}`}
          >
            Older calls →
          </Link>
        )}
      </div>
    </>
  );
}
