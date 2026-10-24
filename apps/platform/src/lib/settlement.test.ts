import { describe, expect, it } from "vitest";
import {
  chargeableMicros,
  connectedSeconds,
  usageFromReport,
} from "./settlement";

const rate = { connectionFeeMicros: 50_000, startedMinuteFeeMicros: 100_000 };
const call = { maxAmountMicros: 1_200_000 };
const connected = (seconds: number) => ({
  kind: "connected" as const,
  seconds,
});

describe("chargeableMicros", () => {
  it.each([
    // [connectedSeconds, expectedMicros, why]
    [0, 50_000, "an answer with no measurable time pays the connection fee"],
    [1, 150_000, "one second is one started minute"],
    [59, 150_000, "under a minute is one started minute"],
    [60, 150_000, "exactly one minute is one started minute"],
    [61, 250_000, "one second over rolls into a second started minute"],
    [120, 250_000, "two minutes is two started minutes"],
    [600, 1_050_000, "ten minutes"],
  ])("bills %s connected seconds as %i micros (%s)", (seconds, expected) => {
    expect(chargeableMicros(call, rate, connected(seconds))).toBe(expected);
  });

  it("charges only the connection fee when nobody answers", () => {
    expect(chargeableMicros(call, rate, { kind: "unanswered" })).toBe(50_000);
  });

  it("charges nothing for a call that never rang", () => {
    expect(chargeableMicros(call, rate, { kind: "not_dialed" })).toBe(0);
  });

  it("never exceeds the client's authorized ceiling", () => {
    // 30 minutes would be 3,050,000 micros against a 1,200,000 ceiling.
    expect(chargeableMicros(call, rate, connected(1800))).toBe(1_200_000);
    expect(
      chargeableMicros({ maxAmountMicros: 10_000 }, rate, {
        kind: "unanswered",
      }),
    ).toBe(10_000);
  });

  it("charges only the connection fee when the started-minute fee is zero", () => {
    expect(
      chargeableMicros(
        call,
        { connectionFeeMicros: 50_000, startedMinuteFeeMicros: 0 },
        connected(300),
      ),
    ).toBe(50_000);
  });
});

describe("usageFromReport", () => {
  it("bills an answered call by its reported connected time", () => {
    expect(
      usageFromReport({ answered: true, durationSeconds: 90, reason: "x" }),
    ).toEqual(connected(90));
    expect(usageFromReport({ answered: true })).toEqual(connected(0));
  });

  it.each(["busy", "no_answer"])("treats %s as unanswered", (reason) => {
    expect(usageFromReport({ answered: false, reason })).toEqual({
      kind: "unanswered",
    });
  });

  it.each([
    "agent_session_failed",
    "invalid_destination",
    "routing_denied",
    "dial_unknown",
    undefined,
  ])("does not bill an unanswered %s", (reason) => {
    expect(usageFromReport({ answered: false, reason })).toEqual({
      kind: "not_dialed",
    });
  });
});

describe("connectedSeconds", () => {
  it("measures whole seconds between answer and end", () => {
    expect(
      connectedSeconds(
        new Date("2026-07-10T12:00:00.000Z"),
        new Date("2026-07-10T12:01:30.000Z"),
      ),
    ).toBe(90);
  });

  it("never returns a negative duration when clocks disagree", () => {
    expect(
      connectedSeconds(
        new Date("2026-07-10T12:00:00.000Z"),
        new Date("2026-07-10T11:59:00.000Z"),
      ),
    ).toBe(0);
  });
});
