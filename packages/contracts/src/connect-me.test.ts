import { describe, expect, it } from "vitest";
import {
  createCallSchema,
  inCallingWindow,
  nextWindowStart,
  retryTime,
  connectMeTaskSchema,
  isBusinessDestination,
} from "./index";
const task = connectMeTaskSchema.parse({
  type: "connect_me",
  callbackNumber: "+34612345678",
  callbackLanguage: "es",
  purpose: "Speak with the post office",
  callingWindow: {
    timezone: "Europe/Madrid",
    weekdays: [1, 2, 3, 4, 5],
    start: "09:00",
    end: "17:00",
  },
  expiresAt: "2026-09-19T16:00:00.000Z",
});
const input = {
  destination: "+34911234567",
  destinationCountry: "ES",
  language: "es",
  maxDurationSeconds: 900,
  maxAmountUsd: 10,
  task,
};
describe("bounded task contract", () => {
  it("has bounded defaults and independently configured languages", () => {
    expect(
      createCallSchema.parse({
        ...input,
        destination: "+39061234567",
        destinationCountry: "IT",
        language: "it",
        task: { ...task, callbackLanguage: "es" },
      }).task.type,
    ).toBe("connect_me");
    expect(task.maxAttempts).toBe(6);
    expect(task.ringingSeconds).toBe(40);
  });
  it.each([
    "+34112",
    "+34900123456",
    "+34803123456",
    "+34612345678",
    "+39089123456",
    "+12025550123",
  ])("rejects non-geographic Spanish business %s", (destination) =>
    expect(isBusinessDestination(destination, "ES")).toBe(false),
  );
  it.each(["+34911234567", "+34701234567", "+34751234567", "+393331234567"])(
    "rejects callback %s",
    (callbackNumber) =>
      expect(
        connectMeTaskSchema.safeParse({ ...task, callbackNumber }).success,
      ).toBe(false),
  );
  it("requires a real timezone, explicit hours, deadline and sufficient duration", () => {
    expect(
      createCallSchema.safeParse({ ...input, maxDurationSeconds: 60 }).success,
    ).toBe(false);
    expect(
      connectMeTaskSchema.safeParse({
        ...task,
        callingWindow: { ...task.callingWindow, timezone: "Spain" },
      }).success,
    ).toBe(false);
    expect(
      connectMeTaskSchema.safeParse({ ...task, expiresAt: undefined }).success,
    ).toBe(false);
    expect(
      connectMeTaskSchema.safeParse({ ...task, callingWindow: undefined })
        .success,
    ).toBe(false);
    expect(
      connectMeTaskSchema.safeParse({ ...task, maxAttempts: 7 }).success,
    ).toBe(false);
  });
  it("uses local hours across DST and rejects weekends", () => {
    expect(inCallingWindow(task, new Date("2026-09-18T07:00:00Z"))).toBe(true);
    expect(inCallingWindow(task, new Date("2026-09-18T15:00:00Z"))).toBe(false);
    expect(inCallingWindow(task, new Date("2026-09-19T10:00:00Z"))).toBe(false);
    expect(inCallingWindow(task, new Date("2026-12-18T07:00:00Z"))).toBe(false);
    expect(inCallingWindow(task, new Date("2026-12-18T08:00:00Z"))).toBe(true);
  });
  it("defers a closed window to the next open minute before expiry", () => {
    const closed = new Date("2026-09-18T15:00:00Z");
    expect(nextWindowStart(task, closed)).toBeNull();
    expect(
      nextWindowStart(
        { ...task, expiresAt: "2026-09-21T12:00:00.000Z" },
        closed,
      )?.toISOString(),
    ).toBe("2026-09-21T07:00:00.000Z");
  });
  it("only retries busy/no-answer before limits expire", () => {
    const now = new Date("2026-09-18T10:00:00Z");
    expect(retryTime(task, 1, "busy", now)?.getTime()).toBe(
      now.getTime() + 300000,
    );
    expect(retryTime(task, 6, "no_answer", now)).toBeNull();
    for (const reason of [
      "refused",
      "voicemail",
      "dial_unknown",
      "routing_denied",
    ])
      expect(retryTime(task, 1, reason, now)).toBeNull();
    expect(
      retryTime(task, 1, "no_answer", new Date(task.expiresAt)),
    ).toBeNull();
  });
  it("preserves legacy tasks without extending their countries or languages", () => {
    expect(
      createCallSchema.safeParse({
        ...input,
        task: { type: "information", questions: ["Opening hours?"] },
      }).success,
    ).toBe(true);
    expect(
      createCallSchema.safeParse({
        ...input,
        language: "it",
        task: { type: "information", questions: ["Opening hours?"] },
      }).success,
    ).toBe(false);
  });
});
