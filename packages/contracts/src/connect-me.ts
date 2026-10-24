import { z } from "zod";
import { billingContactNameSchema } from "./billing";

export const CALL_NOW_TTL_MS = 30 * 60_000;

const timezone = z
  .string()
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Use an IANA timezone");

const callingWindowObjectSchema = z
  .object({
    timezone,
    // Explicit local business hours, same-day windows only. No inferred schedule.
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .refine(
    (v) => v.start < v.end,
    "Window must end on the same day after its start",
  );

export const connectMeTaskSchema = z
  .object({
    type: z.literal("connect_me"),
    callbackNumber: z
      .string()
      .regex(/^\+34(?:6\d{8}|7[1-4]\d{7})$/, "Use a Spanish mobile number"),
    callbackLanguage: z.enum(["es", "it", "en"]),
    callerName: billingContactNameSchema.optional(),
    purpose: z.string().trim().min(1).max(300),
    maxAttempts: z.number().int().min(1).max(6).default(6),
    retryDelaySeconds: z.number().int().min(300).max(86400).default(300),
    callingWindow: z
      .custom<
        | {
            timezone: string;
            weekdays: number[];
            start: string;
            end: string;
          }
        | "now"
      >(() => true)
      .superRefine((value, ctx) => {
        if (value === "now") return;
        const parsed = callingWindowObjectSchema.safeParse(value);
        if (!parsed.success) {
          for (const issue of parsed.error.issues)
            ctx.addIssue({
              code: "custom",
              path: issue.path,
              message: issue.message,
              continue: true,
            });
        }
      })
      .transform((value) =>
        value === "now"
          ? ("now" as const)
          : callingWindowObjectSchema.parse(value),
      ),
    expiresAt: z.string().datetime(),
    ringingSeconds: z.number().int().min(10).max(60).default(40),
    waitingSeconds: z.number().int().min(10).max(300).default(120),
    handoffSeconds: z.number().int().min(20).max(120).default(90),
    callbackRingingSeconds: z.number().int().min(10).max(60).default(40),
    acceptanceSeconds: z.number().int().min(5).max(30).default(15),
    conversationSeconds: z.number().int().min(30).max(1200).default(600),
    maxIvrDigits: z.number().int().min(0).max(5).default(0),
  })
  .refine((v) => v.callingWindow !== "now" || v.maxAttempts === 1, {
    message: "Call now requires exactly one attempt",
    path: ["maxAttempts"],
  })
  .refine(
    (v) => v.handoffSeconds >= v.callbackRingingSeconds + v.acceptanceSeconds,
    "Handoff must cover callback ringing and acceptance",
  );
export type ConnectMeTask = z.infer<typeof connectMeTaskSchema>;

export const connectReasons = [
  "busy",
  "no_answer",
  "voicemail",
  "ivr_unresolved",
  "uncertain_answer",
  "refused",
  "routing_denied",
  "invalid_destination",
  "configuration_error",
  "dial_unknown",
  "worker_lost",
  "callback_declined",
  "callback_timeout",
  "business_hangup",
  "callback_hangup",
  "connected",
  "cancelled",
  "outside_window",
  "duration_limit",
  "spend_limit",
  "expired",
  "attempts_exhausted",
] as const;
export const connectEventSchema = z.object({
  eventId: z.string().uuid(),
  attemptId: z.string().uuid(),
  workerId: z.string().uuid(),
  action: z.enum([
    "claim",
    "heartbeat",
    "dial",
    "connected",
    "ended",
    "human",
    "accept",
    "bridged",
    "finish",
  ]),
  leg: z.enum(["business", "callback"]).optional(),
  at: z.string().datetime().optional(),
  sipCallId: z.string().min(1).max(128).optional(),
  reason: z.enum(connectReasons).optional(),
});
export type ConnectEvent = z.infer<typeof connectEventSchema>;
export const connectDispatchSchema = z.object({
  callId: z.string().uuid(),
  attemptId: z.string().uuid(),
  kind: z.literal("connect_me"),
});

export const businessDestinationErrors = {
  format: "Use international format: +34 or +39 followed by digits only.",
  country:
    "The country code must match the selected country: +34 for Spain or +39 for Italy.",
  spanishLength: "Spanish numbers need exactly 9 digits after +34.",
  italianMobileLength:
    "Italian mobile numbers need 9 or 10 digits after +39; numbers starting with 31 or 43 need 10.",
  unsupported:
    "Use a supported Spanish or Italian landline or mobile number. Premium, service, and emergency numbers are not supported.",
} as const;

export function isBusinessDestination(destination: string, country: string) {
  // Ordinary landlines and mobile ranges only; prefixes do not prove ownership.
  return country === "ES"
    ? /^\+34(?:[89][1-8]\d{7}|6\d{8}|7[1-48]\d{7})$/.test(destination)
    : country === "IT" &&
        /^\+39(?:0(?!0|878)\d{5,10}|3[2-9]\d{7,8}|(?:31|43)\d{8})$/.test(
          destination,
        );
}

export function businessDestinationError(
  destination: string,
  country: string,
): string | null {
  if (!/^\+\d+$/.test(destination)) return businessDestinationErrors.format;
  const prefix = country === "ES" ? "+34" : country === "IT" ? "+39" : null;
  if (!prefix) return businessDestinationErrors.unsupported;
  if (!destination.startsWith(prefix)) return businessDestinationErrors.country;
  const national = destination.slice(prefix.length);
  if (country === "ES" && national.length !== 9)
    return businessDestinationErrors.spanishLength;
  if (country === "IT" && /^(?:3|43)/.test(national)) {
    const validLength = /^(?:31|43)/.test(national)
      ? national.length === 10
      : national.length === 9 || national.length === 10;
    if (!validLength) return businessDestinationErrors.italianMobileLength;
  }
  return isBusinessDestination(destination, country)
    ? null
    : businessDestinationErrors.unsupported;
}
export function inCallingWindow(task: ConnectMeTask, now: Date) {
  if (task.callingWindow === "now")
    return now.getTime() < Date.parse(task.expiresAt);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: task.callingWindow.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const weekday =
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(part("weekday")) +
    1;
  const time = `${part("hour")}:${part("minute")}`;
  return (
    task.callingWindow.weekdays.includes(weekday) &&
    time >= task.callingWindow.start &&
    time < task.callingWindow.end
  );
}
export function legLimit(task: ConnectMeTask, leg: "business" | "callback") {
  return leg === "business"
    ? task.waitingSeconds + task.handoffSeconds + task.conversationSeconds
    : task.acceptanceSeconds + task.conversationSeconds;
}
/** Next open minute, or null when none remains before the ringing deadline. */
export function nextWindowStart(task: ConnectMeTask, now: Date): Date | null {
  if (task.callingWindow === "now") return null;
  const limit = Date.parse(task.expiresAt) - task.ringingSeconds * 1000;
  for (let t = now.getTime() + 60_000; t < limit; t += 60_000) {
    const at = new Date(t);
    if (inCallingWindow(task, at)) return at;
  }
  return null;
}
export function retryTime(
  task: ConnectMeTask,
  attempt: number,
  reason: string,
  now: Date,
): Date | null {
  if (
    task.callingWindow === "now" ||
    !["busy", "no_answer"].includes(reason) ||
    attempt >= task.maxAttempts
  )
    return null;
  const next = new Date(now.getTime() + task.retryDelaySeconds * 1000);
  return next.getTime() + task.ringingSeconds * 1000 <
    Date.parse(task.expiresAt)
    ? next
    : null;
}
