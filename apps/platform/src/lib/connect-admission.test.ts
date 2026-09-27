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
  maxAmountUsd: 10,
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
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-18T10:00:00Z"));
  mocks.client.mockResolvedValue({ id: "client", allowedVoiceIds: [] });
});
function request(data = body) {
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

it("does not let a funding header grant operator privileges", async () => {
  const req = request();
  req.headers.set("x-agentcaller-funding", "operator");
  expect((await POST(req)).status).toBe(403);
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.database).not.toHaveBeenCalled();
});
