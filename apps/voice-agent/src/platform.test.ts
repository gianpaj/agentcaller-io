import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConnectEvent } from "@agentcaller/contracts";

const secret = "offline-private-secret-".repeat(3);
const event: ConnectEvent = {
  eventId: randomUUID(),
  attemptId: randomUUID(),
  workerId: randomUUID(),
  action: "claim",
};
let errors: ReturnType<typeof vi.spyOn>;
let warnings: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PLATFORM_URL", "http://localhost:3000");
  vi.stubEnv("AGENT_CALLBACK_SECRET", secret);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  expect(JSON.stringify(errors.mock.calls)).not.toContain(secret);
  expect(JSON.stringify(warnings.mock.calls)).not.toContain(secret);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("logs callback status and IDs, rejects 4xx without retries or body logging", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(secret, { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  const { connectRequest } = await import("./platform.js");
  expect(await connectRequest("call-id", event)).toEqual({ allowed: false });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(errors).toHaveBeenCalledWith("Connect callback failed", {
    stage: "claim",
    callId: "call-id",
    attemptId: event.attemptId,
    requestAttempt: 1,
    status: 404,
  });
});

it("logs each 5xx retry, preserves the event ID, then accepts success", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(secret, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ allowed: true }));
  vi.stubGlobal("fetch", fetchMock);
  const { connectRequest } = await import("./platform.js");
  expect(await connectRequest("call-id", event)).toEqual({ allowed: true });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const requests = fetchMock.mock.calls.map(([, request]) =>
    JSON.parse(request.body),
  );
  expect(requests.map((request) => request.eventId)).toEqual([
    event.eventId,
    event.eventId,
  ]);
  expect(errors.mock.calls[0][1]).toMatchObject({
    status: 503,
    requestAttempt: 1,
  });
});

it.each(["TimeoutError", "TypeError"])(
  "logs %s without the error message and fails closed",
  async (name) => {
    const error = new Error(secret);
    error.name = name;
    const fetchMock = vi.fn().mockRejectedValue(error);
    vi.stubGlobal("fetch", fetchMock);
    const { connectRequest } = await import("./platform.js");
    expect(await connectRequest("call-id", event)).toEqual({ allowed: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(errors.mock.calls[2][1]).toMatchObject({
      stage: "claim",
      callId: "call-id",
      attemptId: event.attemptId,
      requestAttempt: 3,
      failure: name === "TimeoutError" ? "timeout" : "network",
    });
  },
);

it.each(["not json", JSON.stringify({ private: secret })])(
  "logs invalid success responses and fails closed",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response(body)),
    );
    const { connectRequest } = await import("./platform.js");
    expect(await connectRequest("call-id", event)).toEqual({ allowed: false });
    expect(errors.mock.calls[0][1]).toMatchObject({
      status: 200,
      failure: "invalid_response",
    });
  },
);

it("logs an explicit denial without logging the returned input", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ allowed: false, input: secret })),
  );
  const { connectRequest } = await import("./platform.js");
  await connectRequest("call-id", event);
  expect(warnings).toHaveBeenCalledWith(
    "Connect command denied",
    expect.objectContaining({
      stage: "claim",
      callId: "call-id",
      attemptId: event.attemptId,
      status: 200,
    }),
  );
});

it("logs invalid callback configuration before fetching", async () => {
  vi.stubEnv("AGENT_CALLBACK_SECRET", "");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { connectRequest } = await import("./platform.js");
  expect(await connectRequest("call-id", event)).toEqual({ allowed: false });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(errors.mock.calls[0][1]).toMatchObject({
    failure: "invalid_configuration",
    attemptId: event.attemptId,
  });
});

it("legacy lifecycle callbacks also omit raw failures and payloads", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(secret)));
  const { reportEvent } = await import("./platform.js");
  const pending = reportEvent("call-id", {
    type: "call.failed",
    outcome: { private: secret },
  });
  await vi.runAllTimersAsync();
  expect(await pending).toBe(false);
  expect(errors).toHaveBeenCalledTimes(4);
  expect(errors.mock.calls[3][1]).toMatchObject({
    stage: "call.failed",
    callId: "call-id",
    requestAttempt: 4,
    failure: "network",
  });
});
