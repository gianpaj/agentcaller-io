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
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Recents</h1>
          <p className="text-base leading-relaxed text-(--muted)">
            Your calls and their outcomes.
          </p>
        </div>
        {visible.length > 0 && (
          <Link
            href="/app/calls/new"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-(--signal) px-4 py-3 text-sm font-semibold text-(--void) hover:bg-(--ink)"
          >
            <Plus size={18} aria-hidden="true" />
            New call
          </Link>
        )}
      </header>
      <LiveProgress active={visible.some((call) => !call.endedAt)} />
      {!visible.length ? (
        <section
          className="grid justify-items-start gap-6 rounded-xl border border-(--line) bg-(--panel) p-6 sm:p-8"
          aria-labelledby="empty-title"
        >
          <Phone size={32} className="text-(--signal)" aria-hidden="true" />
          <div className="space-y-2">
            <h2
              id="empty-title"
              className="text-xl font-semibold tracking-tight"
            >
              No calls yet
            </h2>
            <p className="max-w-prose text-base leading-relaxed text-(--muted)">
              Start a call to a business. Every attempt and its outcome will
              appear here.
            </p>
          </div>
          <Link
            href="/app/calls/new"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-(--signal) px-4 py-3 text-base font-semibold text-(--void) hover:bg-(--ink) sm:w-auto"
          >
            <Plus size={18} aria-hidden="true" />
            Make your first call
          </Link>
        </section>
      ) : (
        <ul className="divide-y divide-(--line)" aria-label="Recent calls">
          {visible.map((call) => (
            <li key={call.id} className="flex items-start gap-3 py-5 sm:gap-4">
              <span
                className={`mt-1 grid size-10 shrink-0 place-items-center rounded-full bg-(--panel) ${call.state === "failed" ? "text-(--ember)" : "text-(--signal)"}`}
              >
                <PhoneOutgoing size={20} aria-hidden="true" />
              </span>
              <Link
                href={`/app/calls/${call.id}`}
                className="grid min-h-12 min-w-0 flex-1 gap-1.5 rounded-sm leading-relaxed wrap-anywhere hover:underline hover:underline-offset-4"
              >
                <strong className="text-base font-semibold">
                  {call.clientReference || call.destination}
                </strong>
                {call.clientReference && (
                  <span className="text-sm text-(--muted)">
                    {call.destination}
                  </span>
                )}
                <span
                  className={`text-sm ${call.state === "failed" ? "text-(--ember)" : "text-(--ink)"}`}
                >
                  {humanize(call.state)}
                  {outcomeReason(call.outcome)
                    ? ` · ${humanize(outcomeReason(call.outcome)!)}`
                    : ""}
                </span>
                <time
                  className="text-sm text-(--muted)"
                  dateTime={call.createdAt.toISOString()}
                >
                  {dateLabel(call.createdAt)}
                </time>
              </Link>
              {!redialBlock(call) ? (
                <Link
                  href={`/app/calls/new?redial=${call.id}`}
                  className="inline-flex size-12 shrink-0 items-center justify-center rounded-md text-(--signal) hover:bg-(--panel)"
                  aria-label={`Redial ${call.destination}`}
                  title="Review and redial"
                >
                  <Phone size={20} aria-hidden="true" />
                </Link>
              ) : (
                <Link
                  href={`/app/calls/${call.id}`}
                  className="inline-flex size-12 shrink-0 items-center justify-center rounded-md text-(--muted) hover:bg-(--panel) hover:text-(--ink)"
                  aria-label={`View ${call.destination}`}
                >
                  <ChevronRight size={20} aria-hidden="true" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 text-sm">
        {cursor.success && (
          <Link
            href="/app"
            className="inline-flex min-h-12 items-center underline underline-offset-4 hover:text-(--signal)"
          >
            Latest calls
          </Link>
        )}
        {rows.length > 30 && last && (
          <Link
            href={`/app?at=${encodeURIComponent(last.createdAt.toISOString())}&before=${last.id}`}
            className="ml-auto inline-flex min-h-12 items-center gap-2 underline underline-offset-4 hover:text-(--signal)"
          >
            Older calls
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        )}
      </div>
    </>
  );
}
