import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  database: vi.fn(),
  dispatch: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  authenticateApiRequest: mocks.client,
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/database", () => ({ database: mocks.database }));
vi.mock("@/lib/livekit", () => ({ dispatchCall: mocks.dispatch }));
vi.mock("@/lib/payment", () => ({
  verifyPayment: mocks.verify,
  paymentRequiredResponse: vi.fn(),
  paymentRequirements: vi.fn(),
  readPaymentPayload: vi.fn(),
}));
vi.mock("@/lib/webhooks", () => ({ queueWebhook: vi.fn() }));
import { POST } from "../app/api/v1/calls/route";
const body = {
  destination: "+34911234567",
  destinationCountry: "ES",
  language: "es",
  maxDurationSeconds: 900,
  maxAmountUsd: 5,
  task: {
    type: "connect_me",
    callbackNumber: "+34612345678",
    callbackLanguage: "it",
    purpose: "Post office",
    callingWindow: {
      timezone: "Europe/Madrid",
      weekdays: [1, 2, 3, 4, 5],
      start: "09:00",
      end: "17:00",
    },
    expiresAt: "2026-09-19T10:00:00Z",
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-18T10:00:00Z"));
  mocks.client.mockResolvedValue({ id: "client", allowedVoiceIds: [] });
});
function request(data: unknown = body) {
  return new Request("https://offline.invalid/api/v1/calls", {
    method: "POST",
    headers: { "Idempotency-Key": "test" },
    body: JSON.stringify(data),
  });
}
it("fails closed before accepting payment or dialing through the unsupported scheme", async () => {
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    error: expect.stringContaining("variable capture"),
  });
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(mocks.database).not.toHaveBeenCalled();
});
it.each([
  ["ES", "+34612345678"],
  ["IT", "+393331234567"],
])(
  "accepts a %s mobile destination without bypassing funding",
  async (destinationCountry, destination) => {
    const response = await POST(
      request({ ...body, destinationCountry, destination }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("variable capture"),
    });
    expect(mocks.database).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  },
);

it("validates callback and destination on the server", async () => {
  expect(
    (
      await POST(
        request({
          ...body,
          task: { ...body.task, callbackNumber: "+393331234567" },
        }),
      )
    ).status,
  ).toBe(422);
  expect(
    (await POST(request({ ...body, destination: "+34900123456" }))).status,
  ).toBe(422);
});

it.each(["2026-09-18T10:30:00.001Z", "2026-09-19T10:00:00Z"])(
  "rejects immediate deadlines beyond 30 minutes before touching providers: %s",
  async (expiresAt) => {
    const response = await POST(
      request({
        ...body,
        task: { ...body.task, callingWindow: "now", maxAttempts: 1, expiresAt },
      }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "Call now must expire within 30 minutes",
    });
    expect(mocks.database).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  },
);

it("returns the existing call when replaying an idempotency key after expiry", async () => {
  vi.stubEnv("CONNECT_OPERATOR_CALLS_ENABLED", "true");
  mocks.client.mockResolvedValue({
    id: "client",
    enabled: true,
    isOperator: true,
    callsPerMinute: 5,
    maxConcurrentCalls: 2,
    allowedVoiceIds: [],
  });
  let callIndex = 0;
  mocks.database.mockImplementation(() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            callIndex += 1;
            return callIndex === 1 ? [{ id: "existing-call" }] : [];
          },
        }),
      }),
    }),
  }));
  const req = request({
    ...body,
    task: {
      ...body.task,
      callingWindow: "now",
      maxAttempts: 1,
      expiresAt: "2026-09-18T09:59:00.000Z",
    },
  });
  req.headers.set("x-agentcaller-funding", "operator");
  const response = await POST(req);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ data: { id: "existing-call" } });
});

it("keeps the payment blocker for an otherwise valid immediate call", async () => {
  const response = await POST(
    request({
      ...body,
      task: {
        ...body.task,
        callingWindow: "now",
        maxAttempts: 1,
        expiresAt: "2026-09-18T10:30:00.000Z",
      },
    }),
  );
  expect(response.status).toBe(503);
  expect(mocks.database).not.toHaveBeenCalled();
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it("rejects automatic retries for immediate API calls", async () => {
  const response = await POST(
    request({
      ...body,
      task: {
        ...body.task,
        callingWindow: "now",
        maxAttempts: 2,
        expiresAt: "2026-09-18T10:30:00.000Z",
      },
    }),
  );
  expect(response.status).toBe(422);
  expect(mocks.database).not.toHaveBeenCalled();
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it("does not let a funding header grant operator privileges", async () => {
  const req = request();
  req.headers.set("x-agentcaller-funding", "operator");
  expect((await POST(req)).status).toBe(403);
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.database).not.toHaveBeenCalled();
});
