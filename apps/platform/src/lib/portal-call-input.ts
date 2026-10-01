import { CALL_NOW_TTL_MS, createCallSchema } from "@agentcaller/contracts";
import { z, ZodError } from "zod";

const explicitDeadline = z.string().datetime({ offset: true });
const localDeadline = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function parseDeadline(
  value: string,
  timezone: string,
  issues: z.core.$ZodIssue[],
) {
  const fail = (message: string) => {
    issues.push({ code: "custom", path: ["task", "expiresAt"], message });
    return undefined;
  };
  let instant: number;
  if (localDeadline.test(value)) {
    // Validate the calendar before Date can normalize an impossible date.
    const calendar = explicitDeadline.safeParse(`${value}:00Z`);
    if (!calendar.success) return fail("Enter a valid deadline date and time.");
    let formatter: Intl.DateTimeFormat;
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        calendar: "iso8601",
        numberingSystem: "latn",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      // The contract reports the invalid timezone on its own field.
      return undefined;
    }
    const wallTime = Date.parse(calendar.data);
    const matches: number[] = [];
    // Modern IANA offsets use whole minutes. Check every possible offset, not
    // just the current offset, so DST gaps and repeated times cannot be guessed.
    for (let offset = -24 * 60; offset <= 24 * 60; offset++) {
      const candidate = wallTime + offset * 60_000;
      const parts = Object.fromEntries(
        formatter
          .formatToParts(candidate)
          .map(({ type, value }) => [type, value]),
      );
      const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
      if (local === value && parts.second === "00") matches.push(candidate);
    }
    if (matches.length === 0)
      return fail(
        "This local time does not exist because the clocks change. Choose another deadline.",
      );
    if (matches.length > 1)
      return fail(
        "This local time occurs twice because the clocks change. Choose an unambiguous deadline.",
      );
    instant = matches[0]!;
  } else {
    const parsed = explicitDeadline.safeParse(value);
    if (!parsed.success) return fail("Enter a valid deadline date and time.");
    instant = Date.parse(parsed.data);
    if (!Number.isFinite(instant))
      return fail("Enter a valid deadline date and time.");
  }
  const now = Date.now();
  if (instant <= now) return fail("Choose a deadline in the future.");
  if (instant > now + 7 * 86400_000)
    return fail("Choose a deadline within the next seven days.");
  return new Date(instant).toISOString();
}

export function portalCallInput(form: FormData) {
  const string = (name: string) => String(form.get(name) ?? "").trim();
  const number = (name: string) =>
    string(name) === "" ? NaN : Number(string(name));
  const issues: z.core.$ZodIssue[] = [];
  const mode = string("scheduleMode") || "scheduled";
  const callNow = mode === "now";
  if (mode !== "now" && mode !== "scheduled")
    issues.push({
      code: "custom",
      path: ["scheduleMode"],
      message: "Choose when to call.",
    });
  let expiresAt: string | undefined;
  if (callNow) {
    const deadline = explicitDeadline.safeParse(string("immediateExpiresAt"));
    const now = Date.now();
    if (
      !deadline.success ||
      Date.parse(deadline.data) <= now ||
      Date.parse(deadline.data) > now + CALL_NOW_TTL_MS
    ) {
      issues.push({
        code: "custom",
        path: ["immediateExpiresAt"],
        message: "The immediate-call deadline is invalid or expired.",
      });
    } else {
      expiresAt = new Date(deadline.data).toISOString();
    }
  } else {
    expiresAt = parseDeadline(string("expiresAt"), string("timezone"), issues);
  }
  const waitingSeconds = number("waitingSeconds"),
    handoffSeconds = number("handoffSeconds"),
    conversationSeconds = number("conversationSeconds");
  const result = createCallSchema.safeParse({
    destination: string("destination"),
    destinationCountry: string("destinationCountry"),
    language: string("language"),
    clientReference: string("clientReference") || undefined,
    maxAmountUsd: number("maxAmountUsd"),
    maxDurationSeconds: waitingSeconds + handoffSeconds + conversationSeconds,
    task: {
      type: "connect_me",
      callbackNumber: string("callbackNumber"),
      callbackLanguage: string("callbackLanguage"),
      purpose: string("purpose"),
      // A valid placeholder lets unrelated contract checks report all errors.
      // It is never returned when deadline or timezone validation fails.
      expiresAt: expiresAt ?? "2000-01-01T00:00:00.000Z",
      callingWindow: callNow
        ? "now"
        : {
            timezone: string("timezone"),
            weekdays: form.getAll("weekdays").map(Number),
            start: string("start"),
            end: string("end"),
          },
      maxAttempts: callNow ? 1 : number("maxAttempts"),
      retryDelaySeconds: callNow ? 300 : number("retryDelaySeconds"),
      ringingSeconds: number("ringingSeconds"),
      waitingSeconds,
      handoffSeconds,
      callbackRingingSeconds: number("callbackRingingSeconds"),
      acceptanceSeconds: number("acceptanceSeconds"),
      conversationSeconds,
      maxIvrDigits: number("maxIvrDigits"),
    },
  });
  if (!result.success) issues.push(...result.error.issues);
  if (issues.length) throw new ZodError(issues);
  if (!result.success) throw result.error;
  return result.data;
}
