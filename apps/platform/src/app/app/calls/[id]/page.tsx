import Link from "next/link";
import { notFound } from "next/navigation";
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
      <Link href="/app" className="phone-back">
        ← Recents
      </Link>
      <div className="phone-title">
        <div>
          <p className="phone-eyebrow">{humanize(call.state)}</p>
          <h1>{call.clientReference || call.destination}</h1>
          <p>{call.destination}</p>
        </div>
      </div>
      <LiveProgress active={!call.endedAt} />
      <section className="phone-panel">
        <h2>{reason ? humanize(reason) : "Call progress"}</h2>
        {task.purpose && <p>{task.purpose}</p>}
        <p className="phone-muted">
          Started {dateLabel(call.createdAt)} · {humanize(call.language)} ·{" "}
          {humanize(call.fundingSource)} funded
        </p>
        {!call.endedAt && job && (
          <p>
            {attempts.some((a) => !a.endedAt)
              ? "An attempt is active. See its status below."
              : `Waiting for the scheduler and your calling window. Next eligible time: ${dateLabel(job.nextAttemptAt)}.`}
          </p>
        )}
        <p>
          Spend cap: ${(call.maxAmountMicros / 1e6).toFixed(2)}
          {job
            ? ` · Reserved quote: $${(job.reservedMicros / 1e6).toFixed(2)}`
            : ""}
        </p>
        <p className="phone-muted">
          Leg costs below use observed connection times and saved rates. They
          are not a carrier invoice. Missing measurements remain unknown.
        </p>
        {!call.endedAt && task.type === "connect_me" ? (
          <CancelButton id={call.id} />
        ) : !blocked ? (
          <Link
            className="phone-primary"
            href={`/app/calls/new?redial=${call.id}`}
          >
            Review and redial
          </Link>
        ) : (
          <p className="phone-muted">{blocked}</p>
        )}
      </section>
      <section className="phone-panel">
        <h2>
          Attempts{job ? ` · ${job.attemptCount} of ${task.maxAttempts}` : ""}
        </h2>
        {!attempts.length && (
          <p className="phone-muted">No attempt has started.</p>
        )}
        <ol className="phone-attempts">
          {attempts.map((attempt) => (
            <li key={attempt.id}>
              <div className="phone-between">
                <strong>Attempt {attempt.ordinal}</strong>
                <span>{humanize(attempt.reason ?? attempt.state)}</span>
              </div>
              <p className="phone-muted">
                {dateLabel(attempt.createdAt)}
                {attempt.endedAt
                  ? ` → ${dateLabel(attempt.endedAt)}`
                  : " · active"}
              </p>
              {legs
                .filter((l) => l.attemptId === attempt.id)
                .map((leg) => (
                  <div className="phone-leg" key={leg.kind}>
                    <strong>
                      {humanize(leg.kind)} · {humanize(leg.state)}
                    </strong>
                    <p>
                      {leg.connectedAt
                        ? `Answered ${dateLabel(leg.connectedAt)}`
                        : "No confirmed connection"}
                      {leg.endedAt ? ` · Ended ${dateLabel(leg.endedAt)}` : ""}
                    </p>
                    <p>
                      Measured cost:{" "}
                      {leg.measuredMicros === null
                        ? "unknown"
                        : `$${(leg.measuredMicros / 1e6).toFixed(4)}`}
                    </p>
                  </div>
                ))}
            </li>
          ))}
        </ol>
        <p className="phone-muted">
          A phone answering does not prove a human answered. Human
          classification uses fallible detection and conversation signals.
        </p>
      </section>
      <section className="phone-panel">
        <h2>Status log</h2>
        <p className="phone-muted">
          Latest 100 events, newest first. Status metadata only; no recordings
          or transcripts.
        </p>
        <ol className="phone-events">
          {events.map((event) => {
            const data = event.payload as {
              ordinal?: number;
              leg?: string;
              reason?: string;
            };
            return (
              <li key={event.id}>
                <strong>{humanize(event.type)}</strong>
                <span>
                  {data.ordinal ? `Attempt ${data.ordinal} · ` : ""}
                  {data.leg ? `${humanize(data.leg)} · ` : ""}
                  {typeof data.reason === "string" ? humanize(data.reason) : ""}
                </span>
                <time dateTime={event.occurredAt.toISOString()}>
                  {dateLabel(event.occurredAt)}
                </time>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
