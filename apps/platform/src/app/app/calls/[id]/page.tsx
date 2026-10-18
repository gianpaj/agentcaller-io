import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone } from "lucide-react";
import { requireClientProfile } from "@/lib/portal";
import { loadCallHistory } from "@/lib/call-history";
import {
  dateLabel,
  humanize,
  outcomeReason,
  redialBlock,
} from "@/lib/call-display";
import { ApiError } from "@/lib/auth";
import { LiveProgress } from "../../live-progress";
import { CancelButton } from "./cancel-button";

export default async function CallDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireClientProfile();
  const { id } = await params;
  const detail = await loadCallHistory(profile.id, id).catch((error) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const { call, attempts, legs, events, job } = detail;
  const blocked = redialBlock(call);
  const task = call.task as {
    type?: string;
    purpose?: string;
    maxAttempts?: number;
  };
  const reason = outcomeReason(call.outcome);
  return (
    <>
      <Link
        href="/app"
        className="mb-5 inline-flex min-h-12 items-center gap-2 rounded-sm text-sm font-medium text-(--muted) hover:text-(--ink)"
      >
        <ArrowLeft size={18} aria-hidden="true" />
        Recents
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight wrap-anywhere">
            {call.clientReference || call.destination}
          </h1>
          {call.clientReference && (
            <p className="text-base text-(--muted) tabular-nums wrap-anywhere">
              {call.destination}
            </p>
          )}
        </div>
        <span
          className={`rounded-md border border-(--line) bg-(--panel) px-3 py-1.5 text-sm font-medium capitalize ${call.state === "failed" ? "text-(--ember)" : call.state === "cancelled" ? "text-(--muted)" : "text-(--signal)"}`}
        >
          {humanize(call.state)}
        </span>
      </header>
      <LiveProgress active={!call.endedAt} />
      <div className="space-y-8">
        <section
          className="space-y-6 rounded-xl border border-(--line) bg-(--panel) p-5 sm:p-6"
          aria-labelledby="call-details-title"
        >
          <div className="space-y-3">
            <h2
              id="call-details-title"
              className="text-xl font-semibold tracking-tight"
            >
              Call details
            </h2>
            {task.purpose && (
              <p className="text-base leading-relaxed wrap-anywhere">
                {task.purpose}
              </p>
            )}
          </div>
          {!call.endedAt && job && (
            <p className="text-base leading-relaxed">
              {attempts.some((a) => !a.endedAt)
                ? "An attempt is active. See its status below."
                : `Waiting for the scheduler and your calling window. Next eligible time: ${dateLabel(job.nextAttemptAt)}.`}
            </p>
          )}
          <dl className="grid gap-x-6 gap-y-5 text-base sm:grid-cols-2">
            {reason && (
              <div className="space-y-1 sm:col-span-2">
                <dt className="text-sm text-(--muted)">Outcome</dt>
                <dd className="font-medium capitalize wrap-anywhere">
                  {humanize(reason)}
                </dd>
              </div>
            )}
            <div className="space-y-1 sm:col-span-2">
              <dt className="text-sm text-(--muted)">Started</dt>
              <dd>
                <time dateTime={call.createdAt.toISOString()}>
                  {dateLabel(call.createdAt)}
                </time>
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-(--muted)">Language</dt>
              <dd>{humanize(call.language)}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-(--muted)">Funding</dt>
              <dd>{humanize(call.fundingSource)} funded</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-(--muted)">Spend cap</dt>
              <dd className="font-medium tabular-nums">
                ${(call.maxAmountMicros / 1e6).toFixed(2)}
              </dd>
            </div>
            {job && (
              <div className="space-y-1">
                <dt className="text-sm text-(--muted)">Reserved quote</dt>
                <dd className="font-medium tabular-nums">
                  ${(job.reservedMicros / 1e6).toFixed(2)}
                </dd>
              </div>
            )}
          </dl>
          <div className="space-y-5 border-t border-(--line) pt-5">
            <p className="text-sm leading-relaxed text-(--muted)">
              Leg costs below use observed connection times and saved rates.
              They are not a carrier invoice. Missing measurements remain
              unknown.
            </p>
            {!call.endedAt && task.type === "connect_me" ? (
              <CancelButton id={call.id} />
            ) : !blocked ? (
              <Link
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-(--signal) px-4 py-3 text-base font-semibold text-(--void) hover:bg-(--ink) sm:w-auto"
                href={`/app/calls/new?redial=${call.id}`}
              >
                <Phone size={18} aria-hidden="true" />
                Review and redial
              </Link>
            ) : (
              <p className="text-sm leading-relaxed text-(--muted)">
                {blocked}
              </p>
            )}
          </div>
        </section>
        <section aria-labelledby="attempts-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-(--line) pb-4">
            <h2
              id="attempts-title"
              className="text-xl font-semibold tracking-tight"
            >
              Attempts
            </h2>
            {job && (
              <span className="text-sm text-(--muted) tabular-nums">
                {job.attemptCount} of {task.maxAttempts}
              </span>
            )}
          </div>
          {!attempts.length && (
            <p className="py-6 text-base leading-relaxed text-(--muted)">
              No attempt has started.
            </p>
          )}
          <ol className="divide-y divide-(--line)">
            {attempts.map((attempt) => (
              <li key={attempt.id} className="space-y-5 py-6">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold">
                      Attempt {attempt.ordinal}
                    </h3>
                    <span className="text-sm text-(--muted) capitalize wrap-anywhere">
                      {humanize(attempt.reason ?? attempt.state)}
                    </span>
                  </div>
                  <dl className="grid gap-x-6 gap-y-3 text-sm leading-relaxed sm:grid-cols-2">
                    <div className="space-y-1">
                      <dt className="text-(--muted)">Started</dt>
                      <dd>
                        <time dateTime={attempt.createdAt.toISOString()}>
                          {dateLabel(attempt.createdAt)}
                        </time>
                      </dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-(--muted)">Ended</dt>
                      <dd>
                        {attempt.endedAt ? (
                          <time dateTime={attempt.endedAt.toISOString()}>
                            {dateLabel(attempt.endedAt)}
                          </time>
                        ) : (
                          "Active"
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
                {legs
                  .filter((l) => l.attemptId === attempt.id)
                  .map((leg) => (
                    <div
                      className="space-y-3 border-t border-(--line) pt-4"
                      key={leg.kind}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h4 className="text-base font-medium capitalize">
                          {humanize(leg.kind)}
                        </h4>
                        <span className="text-sm text-(--muted) capitalize wrap-anywhere">
                          {humanize(leg.state)}
                        </span>
                      </div>
                      <dl className="grid gap-x-6 gap-y-3 text-sm leading-relaxed sm:grid-cols-2">
                        <div className="space-y-1">
                          <dt className="text-(--muted)">Connection</dt>
                          <dd>
                            {leg.connectedAt ? (
                              <>
                                Answered{" "}
                                <time dateTime={leg.connectedAt.toISOString()}>
                                  {dateLabel(leg.connectedAt)}
                                </time>
                              </>
                            ) : (
                              "No confirmed connection"
                            )}
                          </dd>
                        </div>
                        {leg.endedAt && (
                          <div className="space-y-1">
                            <dt className="text-(--muted)">Ended</dt>
                            <dd>
                              <time dateTime={leg.endedAt.toISOString()}>
                                {dateLabel(leg.endedAt)}
                              </time>
                            </dd>
                          </div>
                        )}
                        <div className="space-y-1">
                          <dt className="text-(--muted)">Measured cost</dt>
                          <dd className="tabular-nums">
                            {leg.measuredMicros === null
                              ? "unknown"
                              : `$${(leg.measuredMicros / 1e6).toFixed(4)}`}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ))}
              </li>
            ))}
          </ol>
          <p className="border-t border-(--line) pt-4 text-sm leading-relaxed text-(--muted)">
            A phone answering does not prove a human answered. Human
            classification uses fallible detection and conversation signals.
          </p>
        </section>
        <section aria-labelledby="status-log-title">
          <div className="space-y-2 border-b border-(--line) pb-4">
            <h2
              id="status-log-title"
              className="text-xl font-semibold tracking-tight"
            >
              Status log
            </h2>
            <p className="text-sm leading-relaxed text-(--muted)">
              Latest 100 events, newest first. Status metadata only; no
              recordings or transcripts.
            </p>
          </div>
          {!events.length && (
            <p className="py-6 text-base text-(--muted)">
              No status events yet.
            </p>
          )}
          <ol className="divide-y divide-(--line)">
            {events.map((event) => {
              const data = event.payload as {
                ordinal?: number;
                leg?: string;
                reason?: string;
              };
              const context = [
                data.ordinal ? `Attempt ${data.ordinal}` : null,
                data.leg ? humanize(data.leg) : null,
                typeof data.reason === "string" ? humanize(data.reason) : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li
                  key={event.id}
                  className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4"
                >
                  <div className="min-w-0 space-y-1">
                    <h3 className="text-base font-medium capitalize wrap-anywhere">
                      {humanize(event.type)}
                    </h3>
                    {context && (
                      <p className="text-sm leading-relaxed text-(--muted) wrap-anywhere">
                        {context}
                      </p>
                    )}
                  </div>
                  <time
                    className="text-sm leading-relaxed text-(--muted) tabular-nums"
                    dateTime={event.occurredAt.toISOString()}
                  >
                    {dateLabel(event.occurredAt)}
                  </time>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </>
  );
}
