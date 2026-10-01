import { describe, expect, it } from "vitest";
import {
  createCallSchema,
  inCallingWindow,
  nextWindowStart,
  retryTime,
  connectMeTaskSchema,
  isBusinessDestination,
  businessDestinationError,
  businessDestinationErrors,
  type ConnectMeTask,
} from "./index";
const scheduledWindow = {
  timezone: "Europe/Madrid",
  weekdays: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "17:00",
};
const task = connectMeTaskSchema.parse({
  type: "connect_me",
  callbackNumber: "+34612345678",
  callbackLanguage: "es",
  purpose: "Speak with the post office",
  callingWindow: scheduledWindow,
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
describe("Call now", () => {
  const nowTask: ConnectMeTask = {
    ...task,
    callingWindow: "now",
    maxAttempts: 1,
  };

  it("accepts the immediate wire shape through the call schema", () => {
    expect(createCallSchema.parse({ ...input, task: nowTask }).task).toEqual(
      nowTask,
    );
  });

  it.each([undefined, 2, 6])("rejects maxAttempts=%s", (maxAttempts) => {
    const result = createCallSchema.safeParse({
      ...input,
      task: { ...nowTask, maxAttempts },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ["task", "maxAttempts"] }),
    );
  });

  it("requires an explicit expiry", () => {
    expect(
      connectMeTaskSchema.safeParse({ ...nowTask, expiresAt: undefined })
        .success,
    ).toBe(false);
  });

  it.each([
    "2026-09-18T22:00:00.000Z", // Saturday midnight in Madrid.
    "2026-09-19T22:00:00.000Z", // Sunday midnight in Madrid.
    "2026-03-29T00:59:59.999Z", // Spring DST transition.
    "2026-03-29T01:00:00.000Z",
    "2026-10-25T00:59:59.999Z", // Autumn DST transition.
    "2026-10-25T01:00:00.000Z",
  ])("is eligible without local hours at %s", (timestamp) => {
    const now = new Date(timestamp);
    const immediate = {
      ...nowTask,
      expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
    };
    expect(inCallingWindow(immediate, now)).toBe(true);
    expect(nextWindowStart(immediate, now)).toBeNull();
  });

  it.each([
    ["2026-09-19T15:59:59.999Z", true],
    ["2026-09-19T16:00:00.000Z", false],
    ["2026-09-19T16:00:00.001Z", false],
  ] as const)("enforces the exclusive expiry at %s", (timestamp, eligible) => {
    const now = new Date(timestamp);
    expect(inCallingWindow(nowTask, now)).toBe(eligible);
    expect(nextWindowStart(nowTask, now)).toBeNull();
  });

  it.each(["busy", "no_answer"])("never retries %s", (reason) => {
    const now = new Date("2026-09-18T10:00:00Z");
    expect(retryTime(nowTask, 1, reason, now)).toBeNull();
    expect(
      retryTime({ ...nowTask, maxAttempts: 6 }, 1, reason, now),
    ).toBeNull();
  });

  it("retains destination, callback and duration restrictions", () => {
    for (const overrides of [
      { destination: "+34900123456" },
      { destination: "+12025550123", destinationCountry: "US" },
      { task: { ...nowTask, callbackNumber: "+34911234567" } },
      { maxDurationSeconds: 60 },
    ]) {
      expect(
        createCallSchema.safeParse({ ...input, task: nowTask, ...overrides })
          .success,
      ).toBe(false);
    }
  });
});

describe("business destinations", () => {
  it.each([
    ["ES", "+34911234567"],
    ["ES", "+34612345678"],
    ["ES", "+34711234567"],
    ["ES", "+34741234567"],
    ["ES", "+34781234567"],
    ["IT", "+39061234567"],
    ["IT", "+393123456789"],
    ["IT", "+39333123456"],
    ["IT", "+393331234567"],
    ["IT", "+394312345678"],
  ])(
    "accepts supported %s landlines and mobiles: %s",
    (country, destination) => {
      expect(isBusinessDestination(destination, country)).toBe(true);
      expect(businessDestinationError(destination, country)).toBeNull();
      expect(
        createCallSchema.safeParse({
          ...input,
          destinationCountry: country,
          destination,
        }).success,
      ).toBe(true);
      expect(
        createCallSchema.safeParse({
          ...input,
          destinationCountry: country,
          destination,
          task: { ...task, callingWindow: "now", maxAttempts: 1 },
        }).success,
      ).toBe(true);
    },
  );

  it.each([
    ["ES", "+3461234567"],
    ["ES", "+346123456789"],
    ["ES", "+34701234567"],
    ["ES", "+34751234567"],
    ["ES", "+34791234567"],
    ["ES", "+34900123456"],
    ["ES", "+34902123456"],
    ["ES", "+34803123456"],
    ["ES", "+34112"],
    ["ES", "+393331234567"],
    ["IT", "+3933312345"],
    ["IT", "+3933312345678"],
    ["IT", "+39312345678"],
    ["IT", "+393012345678"],
    ["IT", "+39431234567"],
    ["IT", "+39899123456"],
    ["IT", "+39800123456"],
    ["IT", "+39112"],
    ["IT", "+34612345678"],
    ["US", "+12025550123"],
    ["ES", "+34 612 345 678"],
  ])(
    "rejects malformed or unsupported %s destination: %s",
    (country, destination) => {
      expect(isBusinessDestination(destination, country)).toBe(false);
      expect(businessDestinationError(destination, country)).not.toBeNull();
      expect(
        createCallSchema.safeParse({
          ...input,
          destinationCountry: country,
          destination,
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    ["ES", "+3461234567", businessDestinationErrors.spanishLength],
    ["IT", "+3933312345", businessDestinationErrors.italianMobileLength],
    ["ES", "+393331234567", businessDestinationErrors.country],
    ["IT", "+34612345678", businessDestinationErrors.country],
    ["IT", "+39899123456", businessDestinationErrors.unsupported],
    ["ES", "+34 612 345 678", businessDestinationErrors.format],
  ])(
    "explains the specific destination problem for %s %s",
    (country, destination, message) => {
      const result = createCallSchema.safeParse({
        ...input,
        destinationCountry: country,
        destination,
      });
      expect(result.error?.issues).toContainEqual(
        expect.objectContaining({ path: ["destination"], message }),
      );
    },
  );
});

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
    "+34701234567",
    "+39089123456",
    "+12025550123",
  ])("rejects unsupported Spanish destinations %s", (destination) =>
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
        callingWindow: { ...scheduledWindow, timezone: "Spain" },
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
  it.each([
    [{ timezone: "Spain" }, ["callingWindow", "timezone"]],
    [{ weekdays: [] }, ["callingWindow", "weekdays"]],
    [{ weekdays: [0] }, ["callingWindow", "weekdays", 0]],
    [{ start: "24:00" }, ["callingWindow", "start"]],
    [{ end: "25:00" }, ["callingWindow", "end"]],
    [{ end: "09:00" }, ["callingWindow"]],
    [{ start: "17:00", end: "09:00" }, ["callingWindow"]],
  ])("preserves scheduled validation paths for %j", (window, path) => {
    const result = connectMeTaskSchema.safeParse({
      ...task,
      callingWindow: { ...scheduledWindow, ...window },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(
      path,
    );
  });
  it("preserves the scheduled wire shape and defaults", () => {
    expect(task.callingWindow).toEqual(scheduledWindow);
    expect(task.retryDelaySeconds).toBe(300);
    expect(createCallSchema.parse(input).task).toEqual(task);
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
