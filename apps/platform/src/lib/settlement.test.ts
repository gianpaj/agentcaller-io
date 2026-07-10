import { describe, expect, it } from "vitest";
import { chargeableMicros, elapsedSeconds } from "./settlement";

const rate = { connectionFeeMicros: 50_000, startedMinuteFeeMicros: 100_000 };
const call = { maxAmountMicros: 1_200_000 };

describe("chargeableMicros", () => {
  it.each([
    // [durationSeconds, expectedMicros, why]
    [undefined, 150_000, "a call with no reported duration still bills one started minute"],
    [0, 150_000, "a connected-then-failed call bills the minimum"],
    [1, 150_000, "one second is one started minute"],
    [59, 150_000, "under a minute is one started minute"],
    [60, 150_000, "exactly one minute is one started minute"],
    [61, 250_000, "one second over rolls into a second started minute"],
    [120, 250_000, "two minutes is two started minutes"],
    [600, 1_050_000, "ten minutes"],
  ])("bills %s seconds as %i micros (%s)", (durationSeconds, expected, _why) => {
    expect(chargeableMicros(call, rate, durationSeconds)).toBe(expected);
  });

  it("never exceeds the client's authorized ceiling", () => {
    // 30 minutes would be 3,050,000 micros against a 1,200,000 ceiling.
    expect(chargeableMicros(call, rate, 1800)).toBe(1_200_000);
  });

  it("charges only the connection fee when the started-minute fee is zero", () => {
    expect(chargeableMicros(call, { connectionFeeMicros: 50_000, startedMinuteFeeMicros: 0 }, 300)).toBe(50_000);
  });
});

describe("elapsedSeconds", () => {
  it("measures whole seconds between creation and end", () => {
    const createdAt = new Date("2026-07-10T12:00:00.000Z");
    expect(elapsedSeconds({ createdAt }, new Date("2026-07-10T12:01:30.000Z"))).toBe(90);
  });

  it("never returns a negative duration when clocks disagree", () => {
    const createdAt = new Date("2026-07-10T12:00:00.000Z");
    expect(elapsedSeconds({ createdAt }, new Date("2026-07-10T11:59:00.000Z"))).toBe(0);
  });
});
