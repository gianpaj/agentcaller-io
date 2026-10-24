import { z } from "zod";

export const billingContactNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[\p{L}\p{M} .'-]+$/u, "Use the name the business should hear");

// The merchant exposure cap is independent of any customer spending allowance.
export const unpaidExposureLimitCents = 1000;
export const centsSchema = z.number().int().nonnegative().max(2_147_483_647);
export const billingLimitsSchema = z
  .object({
    monthlyLimitCents: centsSchema.positive(),
    perCallLimitCents: centsSchema.positive(),
  })
  .strict()
  .refine((value) => value.perCallLimitCents <= value.monthlyLimitCents, {
    message: "Per-call limit cannot exceed the monthly limit",
    path: ["perCallLimitCents"],
  });
export const billingSetupInputSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(128),
  })
  .strict();
export const billingSetupStates = [
  "pending",
  "consented",
  "creating_checkout",
  "processing",
  "ready",
  "failed",
  "expired",
  "revoked",
] as const;
export const billingSetupResultSchema = z
  .object({
    status: z.enum(billingSetupStates),
    setupRequestId: z.uuid(),
    expiresAt: z.iso.datetime(),
    setupUrl: z.url(),
  })
  .strict();
export type BillingLimits = z.infer<typeof billingLimitsSchema>;

export const usdRateSchema = z
  .object({
    currency: z.literal("USD"),
    pricingVersion: z.string().min(1).max(120),
    connectionFeeMicros: z.number().int().nonnegative().max(2_147_483_647),
    startedMinuteFeeMicros: z.number().int().nonnegative().max(2_147_483_647),
  })
  .strict();
export type UsdRate = z.infer<typeof usdRateSchema>;
