export function humanize(value: string) {
  return value.replaceAll("_", " ").replaceAll(".", " · ");
}
export function outcomeReason(outcome: unknown): string | null {
  if (
    outcome &&
    typeof outcome === "object" &&
    "reason" in outcome &&
    typeof outcome.reason === "string"
  )
    return outcome.reason;
  return null;
}
export function redialBlock(call: {
  endedAt: unknown;
  task: unknown;
  outcome: unknown;
}) {
  if (!call.endedAt)
    return "This job is still active. Open it to monitor or cancel.";
  if (
    !call.task ||
    typeof call.task !== "object" ||
    !("type" in call.task) ||
    call.task.type !== "connect_me"
  )
    return "Website dialing supports connect-me tasks only.";
  const reason = outcomeReason(call.outcome);
  if (reason === "refused") return "The business requested that calling stop.";
  if (
    !reason ||
    ![
      "attempts_exhausted",
      "busy",
      "no_answer",
      "voicemail",
      "ivr_unresolved",
      "uncertain_answer",
      "callback_declined",
      "callback_timeout",
      "business_hangup",
      "callback_hangup",
      "connected",
      "duration_limit",
      "spend_limit",
      "expired",
    ].includes(reason)
  )
    return "Verify provider cleanup and configuration before starting another call. Quick redial is unavailable for this outcome.";
  return null;
}
export function dateLabel(date: Date) {
  return (
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date) + " UTC"
  );
}
