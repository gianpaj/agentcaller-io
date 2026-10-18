import { z } from "zod";
import {
  connectMeTaskSchema,
  businessDestinationError,
  legLimit,
} from "./connect-me";
export * from "./connect-me";
export * from "./agent-auth";
export * from "./billing";

export const supportedCountries = ["ES", "US", "IT"] as const;
export const languages = ["en", "es", "it"] as const;
export const taskTypes = [
  "reservation",
  "appointment",
  "availability",
  "information",
  "connect_me",
] as const;

const moneySchema = z.number().positive().max(500);
const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(32).optional(),
  email: z.email().optional(),
});
const timeWindowSchema = z
  .object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    timezone: z.string().min(1).max(64),
  })
  .refine((window) => new Date(window.endsAt) > new Date(window.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });

export const reservationTaskSchema = z.object({
  type: z.literal("reservation"),
  partySize: z.number().int().min(1).max(24),
  timeWindow: timeWindowSchema,
  contact: contactSchema,
  specialRequests: z.string().trim().max(500).optional(),
});
export const appointmentTaskSchema = z.object({
  type: z.literal("appointment"),
  service: z.string().trim().min(1).max(240),
  timeWindow: timeWindowSchema,
  contact: contactSchema,
  preferredProvider: z.string().trim().max(120).optional(),
});
export const availabilityTaskSchema = z.object({
  type: z.literal("availability"),
  subject: z.string().trim().min(1).max(240),
  timeWindow: timeWindowSchema,
});
export const informationTaskSchema = z.object({
  type: z.literal("information"),
  questions: z.array(z.string().trim().min(1).max(300)).min(1).max(5),
});
export const callTaskSchema = z.discriminatedUnion("type", [
  reservationTaskSchema,
  appointmentTaskSchema,
  availabilityTaskSchema,
  informationTaskSchema,
  connectMeTaskSchema,
]);

const callInputBase = z.object({
  destination: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, "Use an E.164 phone number"),
  destinationCountry: z.enum(supportedCountries),
  language: z.enum(languages),
  voiceId: z.string().trim().min(1).max(80).optional(),
  maxDurationSeconds: z.number().int().min(60).max(1800),
  clientReference: z.string().trim().max(120).optional(),
  task: callTaskSchema,
});

function validateCallPolicy(
  input: z.infer<typeof callInputBase>,
  ctx: z.RefinementCtx,
) {
  if (input.task.type === "connect_me") {
    const destinationError = businessDestinationError(
      input.destination,
      input.destinationCountry,
    );
    if (destinationError)
      ctx.addIssue({
        code: "custom",
        path: ["destination"],
        message: destinationError,
      });
    if (!["es", "it"].includes(input.language))
      ctx.addIssue({
        code: "custom",
        path: ["language"],
        message: "Business language must be es or it",
      });
    if (input.maxDurationSeconds < legLimit(input.task, "business"))
      ctx.addIssue({
        code: "custom",
        path: ["maxDurationSeconds"],
        message: "Duration must cover waiting, handoff and conversation",
      });
  } else if (input.destinationCountry === "IT" || input.language === "it") {
    ctx.addIssue({
      code: "custom",
      message: "Italy and Italian are restricted to connect_me",
    });
  }
}

export const createCallSchema = callInputBase
  .extend({ maxAmountUsd: moneySchema })
  .superRefine(validateCallPolicy);

// Preserve the legacy dollar request while card billing uses exact integer cents.
export const quoteStripeCallSchema = callInputBase
  .extend({
    task: connectMeTaskSchema,
    maxAmountCents: z.number().int().min(1).max(50_000),
    scheduledFor: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine(validateCallPolicy);
export const createStripeCallSchema = quoteStripeCallSchema.safeExtend({
  quoteVersion: z.string().trim().min(1).max(120),
});
export type CreateStripeCallInput = z.infer<typeof createStripeCallSchema>;

export const callStates = [
  "queued",
  "dialing",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
] as const;
export const fundingSources = ["x402", "operator", "stripe_postpaid"] as const;
export const paymentStates = [
  "not_required",
  "authorized",
  "settling",
  "settled",
  "failed",
  "accruing",
  "accrued",
] as const;
export type CreateCallInput = z.infer<typeof createCallSchema>;
export type CallTask = z.infer<typeof callTaskSchema>;
export type CallState = (typeof callStates)[number];
export type PaymentState = (typeof paymentStates)[number];
