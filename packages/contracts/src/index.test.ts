import { describe, expect, it } from "vitest";
import { createCallSchema } from "./index";

const reservation = {
  destination: "+34915200000",
  destinationCountry: "ES",
  language: "es",
  maxDurationSeconds: 600,
  maxAmountUsd: 1.25,
  task: {
    type: "reservation",
    partySize: 2,
    timeWindow: {
      startsAt: "2026-07-14T19:00:00.000Z",
      endsAt: "2026-07-14T21:00:00.000Z",
      timezone: "Europe/Madrid",
    },
    contact: { name: "Marta Ruiz" },
  },
};

describe("createCallSchema", () => {
  it("accepts a bounded reservation dispatch", () => {
    expect(createCallSchema.parse(reservation).task.type).toBe("reservation");
  });

  it("rejects calls longer than 30 minutes", () => {
    expect(() => createCallSchema.parse({ ...reservation, maxDurationSeconds: 1801 })).toThrow();
  });

  it("rejects a reversed time window", () => {
    expect(() => createCallSchema.parse({ ...reservation, task: { ...reservation.task, timeWindow: { ...reservation.task.timeWindow, startsAt: "2026-07-14T22:00:00.000Z" } } })).toThrow();
  });
});
