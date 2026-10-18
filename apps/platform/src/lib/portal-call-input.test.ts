import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { portalCallInput } from "./portal-call-input";
import { portalCallError } from "./portal-call-errors";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    destination: "+34911234567",
    destinationCountry: "ES",
    language: "es",
    callbackNumber: "+34612345678",
    callbackLanguage: "en",
    purpose: "Ask about opening hours",
    expiresAt: "2026-07-02T17:00",
    timezone: "Europe/Madrid",
    start: "09:00",
    end: "17:00",
    maxAmountUsd: "5",
    maxAttempts: "1",
    retryDelaySeconds: "300",
    ringingSeconds: "40",
    waitingSeconds: "120",
    handoffSeconds: "90",
    callbackRingingSeconds: "40",
    acceptanceSeconds: "15",
    conversationSeconds: "600",
    maxIvrDigits: "0",
    ...overrides,
  }))
    data.set(key, value);
  data.append("weekdays", "1");
  data.append("weekdays", "5");
  return data;
}

function errors(data: FormData) {
  try {
    portalCallInput(data);
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
    return portalCallError(error as ZodError);
  }
  throw new Error("Expected invalid form");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("portalCallInput immediate calls", () => {
  function immediate(overrides: Record<string, string> = {}) {
    const data = form({
      scheduleMode: "now",
      immediateExpiresAt: "2026-07-01T12:30:00.000Z",
      ...overrides,
    });
    for (const name of [
      "timezone",
      "weekdays",
      "start",
      "end",
      "expiresAt",
      "maxAttempts",
      "retryDelaySeconds",
    ])
      data.delete(name);
    return data;
  }

  it("accepts Call now without any scheduling or retry fields", () => {
    expect(portalCallInput(immediate()).task).toMatchObject({
      callingWindow: "now",
      maxAttempts: 1,
      retryDelaySeconds: 300,
      expiresAt: "2026-07-01T12:30:00.000Z",
    });
  });

  it("ignores stale scheduled fields and enforces one attempt even for tampered input", () => {
    const data = form({
      scheduleMode: "now",
      immediateExpiresAt: "2026-07-01T12:30:00.000Z",
      maxAttempts: "6",
      retryDelaySeconds: "not-a-number",
      timezone: "invalid",
      start: "",
      end: "",
      expiresAt: "invalid",
    });
    expect(portalCallInput(data).task).toMatchObject({
      callingWindow: "now",
      maxAttempts: 1,
      retryDelaySeconds: 300,
    });
  });

  it.each([
    "",
    "invalid",
    "2026-07-01T12:00:00.000Z",
    "2026-07-01T12:30:00.001Z",
    "2026-07-08T12:00:00.000Z",
  ])(
    "rejects missing, expired, or excessive immediate deadline: %s",
    (immediateExpiresAt) => {
      expect(
        errors(immediate({ immediateExpiresAt })).fieldErrors.scheduleMode,
      ).toMatch(/deadline/);
    },
  );

  it("does not extend the deadline when retrying the same input", () => {
    const data = immediate();
    const first = portalCallInput(data);
    vi.setSystemTime(new Date("2026-07-01T12:05:00Z"));
    expect(portalCallInput(data)).toEqual(first);
    vi.setSystemTime(new Date("2026-07-01T12:30:00Z"));
    expect(errors(data).fieldErrors.scheduleMode).toMatch(/expired/);
  });

  it("keeps destination, callback, duration, and budget validation", () => {
    const state = errors(
      immediate({
        destination: "+34900123456",
        callbackNumber: "+393331234567",
        conversationSeconds: "1201",
        maxAmountUsd: "0",
      }),
    );
    expect(state.fieldErrors).toHaveProperty("destination");
    expect(state.fieldErrors).toHaveProperty("callbackNumber");
    expect(state.fieldErrors).toHaveProperty("conversationSeconds");
    expect(state.fieldErrors).toHaveProperty("maxAmountUsd");
  });

  it("does not silently treat unknown modes as immediate", () => {
    expect(
      errors(form({ scheduleMode: "anything" })).fieldErrors.scheduleMode,
    ).toMatch(/Choose/);
  });
});

describe("mobile business destinations", () => {
  it.each([
    ["ES", "+34612345678"],
    ["IT", "+393331234567"],
    ["IT", "+39333123456"],
  ])(
    "accepts %s mobile destinations in either scheduling mode",
    (destinationCountry, destination) => {
      expect(
        portalCallInput(form({ destinationCountry, destination })).destination,
      ).toBe(destination);
      expect(
        portalCallInput(
          form({
            destinationCountry,
            destination,
            scheduleMode: "now",
            immediateExpiresAt: "2026-07-01T12:30:00.000Z",
          }),
        ).destination,
      ).toBe(destination);
    },
  );

  it.each([
    ["ES", "+3461234567", /exactly 9 digits/],
    ["IT", "+3933312345", /9 or 10 digits/],
    ["ES", "+393331234567", /country code must match/],
    ["IT", "+39899123456", /Premium, service, and emergency/],
  ])(
    "explains invalid %s destinations without a landline-only error",
    (destinationCountry, destination, message) => {
      const state = errors(
        form({
          destinationCountry: String(destinationCountry),
          destination: String(destination),
        }),
      );
      expect(state.fieldErrors.destination).toMatch(message as RegExp);
      expect(state.fieldErrors.destination).not.toMatch(/geographic/);
    },
  );
});

describe("portalCallInput deadlines", () => {
  it.each([
    [
      "2026-07-01",
      "2026-07-02T17:00",
      "Europe/Madrid",
      "2026-07-02T15:00:00.000Z",
    ],
    [
      "2026-01-01",
      "2026-01-02T17:00",
      "Europe/Madrid",
      "2026-01-02T16:00:00.000Z",
    ],
    [
      "2026-07-01",
      "2026-07-02T17:00",
      "Europe/Rome",
      "2026-07-02T15:00:00.000Z",
    ],
    [
      "2026-01-01",
      "2026-01-02T17:00",
      "Europe/Rome",
      "2026-01-02T16:00:00.000Z",
    ],
    [
      "2026-07-01",
      "2026-07-02T17:00",
      "Atlantic/Canary",
      "2026-07-02T16:00:00.000Z",
    ],
    [
      "2026-01-01",
      "2026-01-02T17:00",
      "Atlantic/Canary",
      "2026-01-02T17:00:00.000Z",
    ],
    [
      "2026-07-01",
      "2026-07-02T00:00",
      "Europe/Madrid",
      "2026-07-01T22:00:00.000Z",
    ],
    [
      "2026-07-01",
      "2026-07-02T17:00",
      "Asia/Kathmandu",
      "2026-07-02T11:15:00.000Z",
    ],
    [
      "2026-07-01",
      "2026-07-02T17:00",
      "America/New_York",
      "2026-07-02T21:00:00.000Z",
    ],
    [
      "2028-02-28",
      "2028-02-29T17:00",
      "Europe/Madrid",
      "2028-02-29T16:00:00.000Z",
    ],
  ])("converts %s / %s in %s", (now, expiresAt, timezone, expected) => {
    vi.setSystemTime(new Date(`${now}T12:00:00Z`));
    expect(portalCallInput(form({ expiresAt, timezone })).task).toMatchObject({
      expiresAt: expected,
    });
  });

  it.each([
    ["2026-07-02T17:00:00+02:00", "2026-07-02T15:00:00.000Z"],
    ["2026-07-02T17:00:00-04:00", "2026-07-02T21:00:00.000Z"],
    ["2026-07-02T17:00:00.123Z", "2026-07-02T17:00:00.123Z"],
  ])("preserves explicit ISO offset support for %s", (expiresAt, expected) => {
    expect(portalCallInput(form({ expiresAt })).task).toMatchObject({
      expiresAt: expected,
    });
  });

  it.each([
    ["2026-03-28", "2026-03-29T02:30", "Europe/Madrid", /does not exist/],
    ["2026-03-28", "2026-03-29T02:30", "Europe/Rome", /does not exist/],
    ["2026-03-28", "2026-03-29T01:30", "Atlantic/Canary", /does not exist/],
    ["2026-10-24", "2026-10-25T02:30", "Europe/Madrid", /occurs twice/],
    ["2026-10-24", "2026-10-25T02:30", "Europe/Rome", /occurs twice/],
    ["2026-10-24", "2026-10-25T01:30", "Atlantic/Canary", /occurs twice/],
    ["2026-10-03", "2026-10-04T02:15", "Australia/Lord_Howe", /does not exist/],
    ["2026-04-04", "2026-04-05T01:45", "Australia/Lord_Howe", /occurs twice/],
  ])(
    "rejects DST gap or overlap %s / %s in %s",
    (now, expiresAt, timezone, message) => {
      vi.setSystemTime(new Date(`${now}T00:00:00Z`));
      expect(
        errors(form({ expiresAt, timezone })).fieldErrors.expiresAt,
      ).toMatch(message);
    },
  );

  it.each([
    ["2026-03-28", "2026-03-29T01:59", "2026-03-29T00:59:00.000Z"],
    ["2026-03-28", "2026-03-29T03:00", "2026-03-29T01:00:00.000Z"],
    ["2026-10-24", "2026-10-25T01:59", "2026-10-24T23:59:00.000Z"],
    ["2026-10-24", "2026-10-25T03:00", "2026-10-25T02:00:00.000Z"],
    ["2026-10-24", "2026-10-25T02:30:00+02:00", "2026-10-25T00:30:00.000Z"],
    ["2026-10-24", "2026-10-25T02:30:00+01:00", "2026-10-25T01:30:00.000Z"],
  ])(
    "accepts unambiguous times around DST %s / %s",
    (now, expiresAt, expected) => {
      vi.setSystemTime(new Date(`${now}T00:00:00Z`));
      expect(portalCallInput(form({ expiresAt })).task).toMatchObject({
        expiresAt: expected,
      });
    },
  );

  it.each([
    "",
    "not a date",
    "2026-02-29T12:00",
    "2026-04-31T12:00",
    "2026-13-01T12:00",
    "2026-07-00T12:00",
    "2026-07-02T24:00",
    "2026-07-02T12:60",
    "2026-7-2T12:00",
    "2026-07-02T12:00:00",
    "2026-02-29T12:00:00Z",
    "2026-04-31T12:00:00+02:00",
    "2026-07-02T12:00:00+99:00",
  ])("rejects invalid calendar or syntax: %s", (expiresAt) => {
    expect(errors(form({ expiresAt })).fieldErrors.expiresAt).toBe(
      "Enter a valid deadline date and time.",
    );
  });

  it.each([
    "2026-07-01T12:00:00Z",
    "2026-07-01T11:59:59Z",
    "2026-07-01T14:00",
    "0202-10-19T17:00",
    "1899-10-19T17:00",
  ])(
    "rejects elapsed deadline %s",
    (expiresAt) => {
      expect(errors(form({ expiresAt })).fieldErrors.expiresAt).toMatch(
        /future/,
      );
    },
  );
  it.each(["2026-07-08T12:00:00.001Z", "2026-07-08T14:01"])(
    "rejects deadline beyond seven days %s",
    (expiresAt) => {
      expect(errors(form({ expiresAt })).fieldErrors.expiresAt).toMatch(
        /seven days/,
      );
    },
  );
  it.each([
    "2026-07-08T12:00:00Z",
    "2026-07-08T14:00",
    "2026-07-01T12:00:00.001Z",
  ])("accepts deadline boundary %s", (expiresAt) => {
    expect(() => portalCallInput(form({ expiresAt }))).not.toThrow();
  });


  it("defers relative deadline rejection during client preflight when requested", () => {
    expect(
      portalCallInput(form({ expiresAt: "2026-07-01T13:00" }), {
        checkRelativeDeadline: false,
      }).task,
    ).toMatchObject({
      type: "connect_me",
      expiresAt: "2026-07-01T11:00:00.000Z",
    });
  });

  it.each(["2026-07-02T17:00", "2026-07-02T17:00:00Z"])(
    "reports invalid timezone for %s without throwing RangeError",
    (expiresAt) => {
      const result = errors(form({ expiresAt, timezone: "not/a-zone" }));
      expect(result.fieldErrors.timezone).toMatch(/valid timezone/);
      expect(result.fieldErrors.expiresAt).toBeUndefined();
    },
  );
});

describe("portalCallInput contract and readable errors", () => {
  it("preserves the wire shape, derives duration, and ignores funding/task overrides", () => {
    const data = form({
      clientReference: "  Post office  ",
      task: "information",
      funding: "paid",
      maxDurationSeconds: "1",
    });
    const input = portalCallInput(data);
    expect(input).toMatchObject({
      clientReference: "Post office",
      maxAmountUsd: 5,
      maxDurationSeconds: 810,
      task: {
        type: "connect_me",
        expiresAt: "2026-07-02T15:00:00.000Z",
        callingWindow: { timezone: "Europe/Madrid", weekdays: [1, 5] },
      },
    });
    expect(input).not.toHaveProperty("funding");
  });

  it("collects deadline and multiple contract errors without exposing schema paths", () => {
    const data = form({
      expiresAt: "invalid",
      destination: "123",
      callbackNumber: "123",
      purpose: "",
      start: "17:00",
      end: "09:00",
      handoffSeconds: "20",
    });
    data.delete("weekdays");
    const result = errors(data);
    expect(Object.keys(result.fieldErrors)).toEqual(
      expect.arrayContaining([
        "expiresAt",
        "destination",
        "callbackNumber",
        "purpose",
        "end",
        "handoffSeconds",
        "weekdays",
      ]),
    );
    expect(result.fieldErrors.end).toMatch(/after the start time/);
    expect(result.fieldErrors.handoffSeconds).toMatch(
      /callback ringing plus press-1 acceptance/,
    );
    expect(result.error).not.toMatch(
      /task\.|callingWindow|invalid_format|Invalid input/,
    );
    for (const message of Object.values(result.fieldErrors))
      expect(result.error).toContain(message);
  });

  it.each([
    ["destination", "+34900123456"],
    ["destinationCountry", "FR"],
    ["language", "en"],
    ["clientReference", "x".repeat(121)],
    ["maxAmountUsd", "501"],
    ["callbackNumber", "+12025550123"],
    ["callbackLanguage", "fr"],
    ["purpose", "x".repeat(301)],
    ["timezone", ""],
    ["start", "25:00"],
    ["end", "25:00"],
    ["maxAttempts", "7"],
    ["retryDelaySeconds", "299"],
    ["ringingSeconds", "9"],
    ["waitingSeconds", "301"],
    ["handoffSeconds", "121"],
    ["callbackRingingSeconds", "61"],
    ["acceptanceSeconds", "31"],
    ["conversationSeconds", "1201"],
    ["maxIvrDigits", "6"],
    ["maxIvrDigits", ""],
    ["maxAttempts", "1.5"],
    ["maxAmountUsd", "NaN"],
    ["maxAmountUsd", "Infinity"],
  ])("maps invalid %s to its form field", (field, value) => {
    expect(errors(form({ [field]: value })).fieldErrors[field]).toBeTruthy();
  });


  it("maps non-numeric weekdays and invalid timezone together to their fields", () => {
    const data = form({ timezone: "Invalid/Zone" });
    data.delete("weekdays");
    data.append("weekdays", "x");
    const result = errors(data);
    expect(result.fieldErrors.weekdays).toMatch(/permitted weekday/);
    expect(result.fieldErrors.timezone).toMatch(/valid timezone/);
    expect(result.error).not.toMatch(/Could not validate the call/);
  });

  it("maps invalid weekday array entries to the checkbox group", () => {
    const data = form();
    data.append("weekdays", "8");
    expect(errors(data).fieldErrors.weekdays).toMatch(/permitted weekday/);
  });
});
