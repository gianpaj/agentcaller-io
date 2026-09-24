import { z } from "zod";

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

export const connectMeTaskSchema = z
  .object({
    type: z.literal("connect_me"),
    callbackNumber: z
      .string()
      .regex(/^\+34(?:6\d{8}|7[1-4]\d{7})$/, "Use a Spanish mobile number"),
    callbackLanguage: z.enum(["es", "it", "en"]),
    purpose: z.string().trim().min(1).max(300),
    maxAttempts: z.number().int().min(1).max(6).default(6),
    retryDelaySeconds: z.number().int().min(300).max(86400).default(300),
    callingWindow: z
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

export function isBusinessDestination(destination: string, country: string) {
  // Narrow initial pilot: geographic landlines only, excluding premium/service prefixes.
  return country === "ES"
    ? /^\+34[89][1-8]\d{7}$/.test(destination)
    : country === "IT" && /^\+390\d{5,10}$/.test(destination);
}
export function inCallingWindow(task: ConnectMeTask, now: Date) {
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
export function retryTime(
  task: ConnectMeTask,
  attempt: number,
  reason: string,
  now: Date,
): Date | null {
  if (!["busy", "no_answer"].includes(reason) || attempt >= task.maxAttempts)
    return null;
  const next = new Date(now.getTime() + task.retryDelaySeconds * 1000);
  return next.getTime() + task.ringingSeconds * 1000 <
    Date.parse(task.expiresAt)
    ? next
    : null;
}
