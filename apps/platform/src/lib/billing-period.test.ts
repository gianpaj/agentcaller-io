import { describe, expect, it } from "vitest";
import { createStripeCallSchema } from "@agentcaller/contracts";
import {
  stripeCallSchedule,
  stripeRequestFingerprint,
  utcBillingPeriod,
} from "./billing-period";
const raw = {
  destination: "+34911234567",
  destinationCountry: "ES",
  language: "es",
  maxDurationSeconds: 900,
  maxAmountCents: 100,
  quoteVersion: "test-v1",
  scheduledFor: "2026-11-01T00:00:00Z",
  task: {
    type: "connect_me",
    callbackNumber: "+34612345678",
    callbackLanguage: "es",
    purpose: "Opening hours",
    callingWindow: {
      timezone: "UTC",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      start: "00:00",
      end: "23:59",
    },
    expiresAt: "2026-11-02T12:00:00Z",
  },
};
describe("UTC reservation periods and exact scheduling", () => {
  it("attributes a future accepted job to its first-start month", () => {
    const result = stripeCallSchedule(
      createStripeCallSchema.parse(raw),
      new Date("2026-10-31T12:00:00Z"),
    );
    expect(result.startsAt.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(result.endsAt.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(
      utcBillingPeriod(new Date("2026-10-31T23:59:59Z")).startsAt.toISOString(),
    ).toBe("2026-10-01T00:00:00.000Z");
  });
  it("rejects past starts and seven-day horizon violations", () => {
    const input = createStripeCallSchema.parse(raw);
    expect(() =>
      stripeCallSchedule(input, new Date("2026-11-01T01:00:00Z")),
    ).toThrow();
    expect(() =>
      stripeCallSchedule(input, new Date("2026-10-01T01:00:00Z")),
    ).toThrow();
  });
  it("distinguishes the two resolved instants during a DST overlap", () => {
    const now = new Date("2026-10-24T00:00:00Z");
    const task = {
      ...raw.task,
      expiresAt: "2026-10-26T00:00:00Z",
      callingWindow: { ...raw.task.callingWindow, timezone: "Europe/Madrid" },
    };
    const early = stripeCallSchedule(
      createStripeCallSchema.parse({
        ...raw,
        task,
        scheduledFor: "2026-10-25T02:30:00+02:00",
      }),
      now,
    );
    const late = stripeCallSchedule(
      createStripeCallSchema.parse({
        ...raw,
        task,
        scheduledFor: "2026-10-25T02:30:00+01:00",
      }),
      now,
    );
    expect(late.scheduledFor.getTime() - early.scheduledFor.getTime()).toBe(
      3600_000,
    );
  });
  it("preserves the immediate-only and 30-minute Call now bounds", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    const input = createStripeCallSchema.parse({
      ...raw,
      scheduledFor: undefined,
      task: {
        ...raw.task,
        maxAttempts: 1,
        callingWindow: "now",
        expiresAt: "2026-10-18T12:30:00Z",
      },
    });
    expect(stripeCallSchedule(input, now).scheduledFor).toEqual(now);
    expect(() =>
      stripeCallSchedule(
        { ...input, scheduledFor: "2026-10-18T12:10:00Z" },
        now,
      ),
    ).toThrow();
    expect(() =>
      stripeCallSchedule(
        {
          ...input,
          task: { ...input.task, expiresAt: "2026-10-18T12:31:00Z" },
        },
        now,
      ),
    ).toThrow();
  });
  it("fingerprints canonical intent independently from changing time or tariff state", () => {
    const same = Object.fromEntries(Object.entries(raw).reverse());
    expect(stripeRequestFingerprint(raw)).toBe(stripeRequestFingerprint(same));
    expect(stripeRequestFingerprint(raw)).toBe(
      stripeRequestFingerprint({
        ...raw,
        scheduledFor: "2026-11-01T01:00:00+01:00",
      }),
    );
    expect(stripeRequestFingerprint(raw)).not.toBe(
      stripeRequestFingerprint({ ...raw, quoteVersion: "test-v2" }),
    );
    expect(stripeRequestFingerprint(raw)).not.toBe(
      stripeRequestFingerprint({ ...raw, maxAmountCents: 101 }),
    );
  });
});
