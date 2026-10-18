import { createHash } from "node:crypto";
import {
  CALL_NOW_TTL_MS,
  createStripeCallSchema,
  nextWindowStart,
  inCallingWindow,
  type CreateStripeCallInput,
} from "@agentcaller/contracts";

export function utcBillingPeriod(at: Date) {
  if (!Number.isFinite(at.getTime()))
    throw new Error("Invalid billing instant");
  return {
    startsAt: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)),
    endsAt: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)),
  };
}

/** Call only for a new request; accepted-key replay precedes mutable time checks. */
export function stripeCallSchedule(
  input: CreateStripeCallInput,
  now = new Date(),
) {
  if (input.task.type !== "connect_me")
    throw new Error("Unsupported card-funded task");
  const start = input.scheduledFor ? new Date(input.scheduledFor) : now;
  const expiry = Date.parse(input.task.expiresAt);
  if (
    input.task.callingWindow === "now" &&
    (input.scheduledFor !== undefined ||
      expiry > now.getTime() + CALL_NOW_TTL_MS)
  )
    throw new Error(
      "Call now cannot be scheduled or extended beyond 30 minutes",
    );
  if (
    start < now ||
    start.getTime() > now.getTime() + 7 * 86400_000 ||
    !Number.isFinite(start.getTime()) ||
    expiry <= start.getTime() ||
    expiry > now.getTime() + 7 * 86400_000
  )
    throw new Error("Schedule and expiry must fit the next seven days");
  const firstStart = inCallingWindow(input.task, start)
    ? start
    : nextWindowStart(input.task, start);
  if (
    !firstStart ||
    firstStart.getTime() + input.task.ringingSeconds * 1000 >= expiry
  )
    throw new Error("No permissible start before expiry");
  return { scheduledFor: firstStart, ...utcBillingPeriod(firstStart) };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export function stripeRequestFingerprint(value: unknown) {
  const input = createStripeCallSchema.parse(value);
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          funding: "stripe_postpaid",
          ...input,
          scheduledFor: input.scheduledFor
            ? new Date(input.scheduledFor).toISOString()
            : undefined,
        }),
      ),
    )
    .digest("hex");
}
