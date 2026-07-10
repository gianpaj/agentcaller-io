import { z } from "zod";

export const supportedCountries = ["ES", "US"] as const;
export const languages = ["en", "es"] as const;
export const taskTypes = ["reservation", "appointment", "availability", "information"] as const;

const moneySchema = z.number().positive().max(500);
const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(32).optional(),
  email: z.email().optional(),
});
const timeWindowSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string().min(1).max(64),
}).refine((window) => new Date(window.endsAt) > new Date(window.startsAt), {
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
]);

export const createCallSchema = z.object({
  destination: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use an E.164 phone number"),
  destinationCountry: z.enum(supportedCountries),
  language: z.enum(languages),
  voiceId: z.string().trim().min(1).max(80).optional(),
  maxDurationSeconds: z.number().int().min(60).max(1800),
  maxAmountUsd: moneySchema,
  clientReference: z.string().trim().max(120).optional(),
  task: callTaskSchema,
});

export const callStates = ["queued", "dialing", "in_progress", "completed", "failed", "cancelled"] as const;
export const paymentStates = ["authorized", "settling", "settled", "failed"] as const;
export type CreateCallInput = z.infer<typeof createCallSchema>;
export type CallTask = z.infer<typeof callTaskSchema>;
export type CallState = (typeof callStates)[number];
export type PaymentState = (typeof paymentStates)[number];
