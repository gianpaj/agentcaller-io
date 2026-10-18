import { describe, expect, it } from "vitest";
import {
  billingLimitsSchema,
  billingSetupInputSchema,
  centsSchema,
  createCallSchema,
  createStripeCallSchema,
} from "./index";

const base = {
  destination: "+34911234567",
  destinationCountry: "ES",
  language: "es",
  maxDurationSeconds: 900,
  task: {
    type: "connect_me",
    callbackNumber: "+34612345678",
    callbackLanguage: "es",
    purpose: "Opening hours",
    callingWindow: "now",
    maxAttempts: 1,
    expiresAt: "2026-10-18T12:30:00Z",
  },
};
describe("card-funded call boundary", () => {
  it("requires exact cents and an accepted pricing version while preserving legacy dollars", () => {
    expect(
      createCallSchema.safeParse({ ...base, maxAmountUsd: 1 }).success,
    ).toBe(true);
    expect(
      createStripeCallSchema.safeParse({
        ...base,
        maxAmountCents: 100,
        quoteVersion: "test-v1",
      }).success,
    ).toBe(true);
    expect(
      createStripeCallSchema.safeParse({ ...base, maxAmountCents: 100 })
        .success,
    ).toBe(false);
    expect(
      createStripeCallSchema.safeParse({
        ...base,
        maxAmountUsd: 1,
        maxAmountCents: 100,
        quoteVersion: "test-v1",
      }).success,
    ).toBe(false);
  });
  it.each([-1, 0, 0.1, NaN, Infinity, 50_001])(
    "rejects an invalid call ceiling %s",
    (amount) => {
      expect(
        createStripeCallSchema.safeParse({
          ...base,
          maxAmountCents: amount,
          quoteVersion: "test-v1",
        }).success,
      ).toBe(false);
    },
  );
  it("retains task and destination policy and rejects claimed authority", () => {
    const valid = { ...base, maxAmountCents: 100, quoteVersion: "test-v1" };
    expect(
      createStripeCallSchema.safeParse({
        ...valid,
        destination: "+19001234567",
      }).success,
    ).toBe(false);
    expect(
      createStripeCallSchema.safeParse({
        ...valid,
        task: { type: "information", questions: ["Hours?"] },
      }).success,
    ).toBe(false);
    expect(
      createStripeCallSchema.safeParse({ ...valid, clientId: "claimed-owner" })
        .success,
    ).toBe(false);
    expect(
      createStripeCallSchema.safeParse({ ...valid, language: "en" }).success,
    ).toBe(false);
  });
  it("requires an offset-resolved scheduling instant", () => {
    for (const instant of ["2026-10-18T12:00:00", "tomorrow", "2026-10-18"])
      expect(
        createStripeCallSchema.safeParse({
          ...base,
          maxAmountCents: 100,
          quoteVersion: "test-v1",
          scheduledFor: instant,
        }).success,
      ).toBe(false);
  });
});
describe("spending consent input", () => {
  it("keeps the per-call ceiling within monthly consent", () => {
    expect(
      billingLimitsSchema.safeParse({
        monthlyLimitCents: 1000,
        perCallLimitCents: 100,
      }).success,
    ).toBe(true);
    expect(
      billingLimitsSchema.safeParse({
        monthlyLimitCents: 100,
        perCallLimitCents: 1000,
      }).success,
    ).toBe(false);
    expect(
      billingLimitsSchema.safeParse({
        monthlyLimitCents: 1000,
        perCallLimitCents: 100,
        creditLimitCents: 5000,
      }).success,
    ).toBe(false);
    expect(centsSchema.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(false);
    expect(
      billingSetupInputSchema.safeParse({
        idempotencyKey: "setup-1",
        monthlyLimitCents: 100000,
      }).success,
    ).toBe(false);
  });
});
