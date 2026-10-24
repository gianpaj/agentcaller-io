import { describe, expect, it } from "vitest";
import { connectMeTaskSchema, type UsdRate } from "@agentcaller/contracts";
import {
  assessCallUsage,
  billingHeadroom,
  quoteConnectCents,
} from "./billing-money";
const rate: UsdRate = {
  currency: "USD",
  pricingVersion: "test-v1",
  connectionFeeMicros: 1000,
  startedMinuteFeeMicros: 1000,
};
const connectedAt = new Date("2026-10-18T12:00:00Z");
const connected = (ms: number, tariff = rate) => ({
  state: "connected" as const,
  connectedAt,
  endedAt: new Date(connectedAt.getTime() + ms),
  rate: tariff,
});
const unanswered = (tariff = rate) => ({
  state: "unanswered" as const,
  rate: tariff,
});

describe("confirmed connected usage", () => {
  it("charges connected business usage without requiring callback or handoff", () => {
    expect(
      assessCallUsage(
        [connected(60_000), unanswered({ ...rate, connectionFeeMicros: 0 })],
        100,
        true,
      ),
    ).toMatchObject({
      state: "finalized",
      measuredMicros: "2000",
      finalCents: 1,
    });
  });
  it("charges only the connection fee for each leg that rang unanswered", () => {
    expect(
      assessCallUsage(
        [
          unanswered({ ...rate, connectionFeeMicros: 20_000 }),
          unanswered({ ...rate, connectionFeeMicros: 20_000 }),
        ],
        100,
        true,
      ),
    ).toMatchObject({
      state: "finalized",
      measuredMicros: "40000",
      finalCents: 4,
    });
    expect(
      assessCallUsage(
        [connected(30_000), unanswered({ ...rate, connectionFeeMicros: 5000 })],
        100,
        true,
      ),
    ).toMatchObject({ measuredMicros: "7000", finalCents: 1 });
  });
  it("rounds all legs and attempts once and measures milliseconds directly", () => {
    expect(
      assessCallUsage(
        [connected(60_000), connected(60_000), connected(60_000)],
        100,
        true,
      ),
    ).toMatchObject({ measuredMicros: "6000", finalCents: 1 });
    expect(
      assessCallUsage(
        [connected(60_001, { ...rate, startedMinuteFeeMicros: 10000 })],
        100,
        true,
      ),
    ).toMatchObject({ measuredMicros: "21000", finalCents: 3 });
    expect(
      assessCallUsage(
        [connected(60_000, { ...rate, startedMinuteFeeMicros: 10000 })],
        100,
        true,
      ),
    ).toMatchObject({ measuredMicros: "11000", finalCents: 2 });
  });
  it("keeps unknown metering and pending cleanup unresolved", () => {
    expect(assessCallUsage([], 100, true)).toEqual({
      state: "metering_pending",
    });
    expect(assessCallUsage([{ state: "unknown" }], 100, true)).toEqual({
      state: "metering_pending",
    });
    expect(assessCallUsage([unanswered()], 100, false)).toEqual({
      state: "metering_pending",
    });
    expect(
      assessCallUsage([unanswered(), { state: "unknown" }], 100, true),
    ).toEqual({ state: "metering_pending" });
    expect(
      assessCallUsage(
        [unanswered({ ...rate, connectionFeeMicros: 0 })],
        100,
        true,
      ),
    ).toMatchObject({ state: "finalized", finalCents: 0 });
  });
  it("caps customer liability and exposes provider overrun separately", () => {
    expect(
      assessCallUsage(
        [connected(120_000, { ...rate, startedMinuteFeeMicros: 1_000_000 })],
        100,
        true,
      ),
    ).toMatchObject({ finalCents: 100, overrunCents: 101 });
  });
  it("rejects reversed timestamps, invalid rates and invalid money", () => {
    expect(() => assessCallUsage([connected(-1)], 100, true)).toThrow();
    expect(() =>
      assessCallUsage(
        [connected(1, { ...rate, startedMinuteFeeMicros: 0.5 })],
        100,
        true,
      ),
    ).toThrow();
    expect(() => assessCallUsage([connected(1)], 0.1, true)).toThrow();
  });
  it("reserves both legs of every permitted attempt", () => {
    const task = connectMeTaskSchema.parse({
      type: "connect_me",
      callbackNumber: "+34612345678",
      callbackLanguage: "es",
      purpose: "Opening hours",
      callingWindow: {
        timezone: "Europe/Madrid",
        weekdays: [1],
        start: "09:00",
        end: "17:00",
      },
      expiresAt: "2026-10-19T12:00:00Z",
    });
    const quote = quoteConnectCents(
      task,
      { ...rate, startedMinuteFeeMicros: 10000 },
      { ...rate, startedMinuteFeeMicros: 10000 },
    );
    const single = quoteConnectCents(
      { ...task, maxAttempts: 1 },
      { ...rate, startedMinuteFeeMicros: 10000 },
      { ...rate, startedMinuteFeeMicros: 10000 },
    );
    expect(single).toBe(26);
    expect(quote).toBe(152);
    expect(() =>
      quoteConnectCents(task, rate, { ...rate, pricingVersion: "other" }),
    ).toThrow();
  });
});
describe("shared spending headroom", () => {
  const base = {
    accountLimitCents: 1000,
    accountSpentCents: 100,
    accountReservedCents: 100,
    grantLimitCents: 1000,
    grantSpentCents: 100,
    grantReservedCents: 100,
    unpaidCents: 100,
    allReservedCents: 100,
  };
  it("applies the USD 10 exposure cap across months and integrations", () => {
    expect(
      billingHeadroom({
        ...base,
        accountSpentCents: 0,
        accountReservedCents: 0,
        grantSpentCents: 0,
        grantReservedCents: 0,
        unpaidCents: 800,
        allReservedCents: 150,
      }).availableCents,
    ).toBe(50);
  });
  it("does not restore monthly allowance after collection", () => {
    expect(billingHeadroom({ ...base, unpaidCents: 0 }).availableCents).toBe(
      800,
    );
    expect(
      billingHeadroom({ ...base, grantLimitCents: 250 }).availableCents,
    ).toBe(50);
    expect(billingHeadroom({ ...base, unpaidCents: 1000 }).availableCents).toBe(
      0,
    );
  });
});
