import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  submit: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/portal", () => ({ requireClientProfile: mocks.profile }));
vi.mock("@/lib/submit-call", () => ({ submitCall: mocks.submit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({
  ApiError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { ApiError } from "@/lib/auth";
import type { CallFormState } from "@/lib/portal-call-errors";
import { getCallNowDeadline, startCall } from "./actions";

const initial: CallFormState = { error: "", fieldErrors: {} };
const idempotencyKey = "11111111-1111-4111-8111-111111111111";
const redialOf = "22222222-2222-4222-8222-222222222222";
const profile = { id: "test-client", enabled: true, isOperator: true };

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    idempotencyKey,
    redialOf: "",
    destination: "+34911234567",
    destinationCountry: "ES",
    language: "es",
    callbackNumber: "+34612345678",
    callbackLanguage: "es",
    purpose: "Ask about opening hours",
    expiresAt: "2026-07-02T17:00",
    timezone: "Europe/Madrid",
    weekdays: "1",
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
  }))
    data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
  mocks.profile.mockResolvedValue(profile);
  mocks.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});
afterEach(() => vi.useRealTimers());

it("generates the immediate deadline from server time without dispatching", async () => {
  expect(await getCallNowDeadline()).toBe("2026-07-01T12:30:00.000Z");
  expect(mocks.profile).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});

describe("startCall", () => {
  it.each([
    { enabled: false, isOperator: true },
    { enabled: true, isOperator: false },
  ])("keeps the operator gate for %j", async (flags) => {
    mocks.profile.mockResolvedValue({ ...profile, ...flags });
    expect(await startCall(initial, form())).toEqual({
      error: "An enabled operator account is required.",
      fieldErrors: {},
    });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("returns shared field errors and never submits an invalid form", async () => {
    const data = form();
    data.set("expiresAt", "2026-07-10T17:00");
    data.set("purpose", "");
    const state = await startCall(initial, data);
    expect(state.fieldErrors.expiresAt).toMatch(/seven days/);
    expect(state.fieldErrors.purpose).toMatch(/purpose/);
    expect(state.error).not.toMatch(/task\./);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each(["idempotencyKey", "redialOf"])(
    "keeps UUID validation for %s",
    async (field) => {
      const data = form();
      data.set(field, "not-a-uuid");
      const state = await startCall(initial, data);
      expect(state.fieldErrors[field]).toBeTruthy();
      expect(state.error).not.toContain(field);
      expect(mocks.submit).not.toHaveBeenCalled();
    },
  );

  it("submits a bounded immediate call without scheduled fields", async () => {
    const data = form();
    data.set("scheduleMode", "now");
    data.set("immediateExpiresAt", "2026-07-01T12:30:00.000Z");
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
    mocks.submit.mockResolvedValue(
      Response.json({ data: { id: "immediate-call" } }, { status: 202 }),
    );
    await expect(startCall(initial, data)).rejects.toThrow("NEXT_REDIRECT");
    const [request] = mocks.submit.mock.calls[0]!;
    expect(request.headers.get("idempotency-key")).toBe(idempotencyKey);
    expect(request.headers.get("x-agentcaller-funding")).toBe("operator");
    expect(await request.json()).toMatchObject({
      task: {
        callingWindow: "now",
        maxAttempts: 1,
        expiresAt: "2026-07-01T12:30:00.000Z",
      },
    });
  });

  it("retains the immediate expiry and idempotency key across an uncertain retry", async () => {
    const data = form();
    data.set("scheduleMode", "now");
    data.set("immediateExpiresAt", "2026-07-01T12:30:00.000Z");
    mocks.submit.mockRejectedValue(new Error("Network failure"));
    const state = await startCall(initial, data);
    vi.setSystemTime(new Date("2026-07-01T12:05:00Z"));
    await startCall(state, data);
    for (const [request] of mocks.submit.mock.calls) {
      expect(request.headers.get("idempotency-key")).toBe(idempotencyKey);
      expect(await request.json()).toMatchObject({
        task: { expiresAt: "2026-07-01T12:30:00.000Z", maxAttempts: 1 },
      });
    }
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it("returns profile/API errors without field errors", async () => {
    mocks.profile.mockRejectedValue(new ApiError(403, "Account unavailable."));
    expect(await startCall(initial, form())).toEqual({
      error: "Account unavailable.",
      fieldErrors: {},
    });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each(["profile", "submit"] as const)(
    "does not attribute downstream schema failures to form fields: %s",
    async (source) => {
      mocks[source].mockRejectedValue(
        new ZodError([
          {
            code: "custom",
            path: ["task", "purpose"],
            message: "Internal service schema",
          },
        ]),
      );
      const state = await startCall(initial, form());
      expect(state.fieldErrors).toEqual({});
      expect(state.error).toMatch(/Check Recents/);
      expect(state.error).not.toContain("Internal service schema");
    },
  );

  it("returns submission API errors without field errors", async () => {
    mocks.submit.mockRejectedValue(
      new ApiError(429, "Active-call limit reached"),
    );
    expect(await startCall(initial, form())).toEqual({
      error: "Active-call limit reached",
      fieldErrors: {},
    });
  });

  it.each([
    [{ error: "Insufficient operator cap" }, "Insufficient operator cap"],
    [{}, "Call could not be accepted. Try again with the same form."],
    [
      { error: { internal: "detail" } },
      "Call could not be accepted. Try again with the same form.",
    ],
  ])("returns a structured non-OK response for %j", async (body, error) => {
    mocks.submit.mockResolvedValue(Response.json(body, { status: 422 }));
    expect(await startCall(initial, form())).toEqual({
      error,
      fieldErrors: {},
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("keeps the submitted idempotency key after an uncertain failure", async () => {
    mocks.submit.mockRejectedValue(new Error("Network failure"));
    const data = form();
    const before = Array.from(data.entries());
    const state = await startCall(initial, data);
    expect(state.fieldErrors).toEqual({});
    expect(state.error).toMatch(/Check Recents.*retry this same form/);
    expect(Array.from(data.entries())).toEqual(before);
    await startCall(state, data);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.submit.mock.calls)
      expect(request.headers.get("idempotency-key")).toBe(idempotencyKey);
  });

  it("handles unreadable submission responses without exposing details", async () => {
    mocks.submit.mockResolvedValue(new Response("not JSON", { status: 500 }));
    const state = await startCall(initial, form());
    expect(state.fieldErrors).toEqual({});
    expect(state.error).toMatch(/Could not confirm submission/);
  });

  it.each([undefined, redialOf])(
    "keeps funding, wire input, redial and redirect on success: %s",
    async (original) => {
      const data = form();
      if (original) data.set("redialOf", original);
      data.set("funding", "paid");
      mocks.submit.mockResolvedValue(
        Response.json({ data: { id: "accepted-call" } }, { status: 202 }),
      );
      await expect(startCall(initial, data)).rejects.toThrow("NEXT_REDIRECT");
      expect(mocks.submit).toHaveBeenCalledTimes(1);
      const [request, submittedProfile, options] = mocks.submit.mock.calls[0]!;
      expect(request.method).toBe("POST");
      expect(request.headers.get("idempotency-key")).toBe(idempotencyKey);
      expect(request.headers.get("x-agentcaller-funding")).toBe("operator");
      expect(submittedProfile).toBe(profile);
      expect(options).toEqual({ redialOf: original });
      expect(await request.json()).toMatchObject({
        maxDurationSeconds: 810,
        task: { type: "connect_me", expiresAt: "2026-07-02T15:00:00.000Z" },
      });
      expect(mocks.revalidate).toHaveBeenCalledWith("/app");
      expect(mocks.redirect).toHaveBeenCalledWith("/app/calls/accepted-call");
    },
  );
});
