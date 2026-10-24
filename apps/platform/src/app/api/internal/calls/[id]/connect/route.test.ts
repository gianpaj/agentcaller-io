import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  command: vi.fn(),
  now: 0,
}));
vi.mock("@/lib/billing-authority", () => ({
  authorizeConnectFunding: mocks.authorize,
}));
vi.mock("@/lib/connect-me", () => ({ connectCommand: mocks.command }));
vi.mock("@/lib/env", () => ({
  getAgentCallbackEnv: () => ({ AGENT_CALLBACK_SECRET: "offline-secret" }),
}));
import { ApiError } from "@/lib/auth";
import { POST } from "./route";
const callId = "00000000-0000-4000-8000-000000000001";
const attemptId = "00000000-0000-4000-8000-000000000002";
let warnings: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => mocks.now);
  warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.authorize.mockImplementation(async () => {
    mocks.now += 1200;
  });
  mocks.command.mockImplementation(async () => {
    mocks.now += 3800;
    return { allowed: true };
  });
});
afterEach(() => {
  expect(JSON.stringify(warnings.mock.calls)).not.toContain("offline-secret");
  vi.restoreAllMocks();
});
async function post(action = "heartbeat", token = "offline-secret") {
  return POST(
    new Request("http://localhost/api/internal/calls/" + callId + "/connect", {
      method: "POST",
      headers: {
        "x-agentcaller-agent-secret": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventId: "00000000-0000-4000-8000-000000000003",
        workerId: "00000000-0000-4000-8000-000000000004",
        attemptId,
        action,
      }),
    }),
    { params: Promise.resolve({ id: callId }) },
  );
}
it("separates slow funding authorization from command time", async () => {
  const response = await post();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ allowed: true });
  expect(warnings).toHaveBeenCalledWith("Slow connect operation", {
    stage: "callback",
    callId,
    attemptId,
    action: "heartbeat",
    totalMs: 5000,
    authorizationMs: 1200,
    commandMs: 3800,
    status: 200,
    allowed: true,
  });
});
it("records denied permissions even when HTTP status is successful", async () => {
  mocks.command.mockImplementation(async () => {
    mocks.now += 3800;
    return { allowed: false };
  });
  const response = await post();
  expect(await response.json()).toEqual({ allowed: false });
  expect(warnings.mock.calls[0][1]).toMatchObject({
    status: 200,
    allowed: false,
  });
});
it("measures failed authorization without running the command or exposing the error", async () => {
  mocks.authorize.mockImplementation(async () => {
    mocks.now += 2000;
    throw new ApiError(403, "Spending authority is unavailable");
  });
  expect((await post()).status).toBe(403);
  expect(mocks.command).not.toHaveBeenCalled();
  expect(warnings.mock.calls[0][1]).toEqual({
    stage: "callback",
    callId,
    attemptId,
    action: "heartbeat",
    totalMs: 2000,
    authorizationMs: 2000,
    status: 403,
  });
});
it("measures a failed command and keeps its permission result unknown", async () => {
  mocks.command.mockImplementation(async () => {
    mocks.now += 3800;
    throw new ApiError(409, "Attempt ended");
  });
  expect((await post()).status).toBe(409);
  expect(warnings.mock.calls[0][1]).toMatchObject({
    commandMs: 3800,
    status: 409,
  });
  expect(warnings.mock.calls[0][1]).not.toHaveProperty("allowed");
});
it("skips funding checks for terminal observations", async () => {
  expect((await post("ended")).status).toBe(200);
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect(warnings.mock.calls[0][1]).toMatchObject({
    authorizationMs: 0,
    commandMs: 3800,
  });
});
it("keeps fast callbacks quiet", async () => {
  mocks.authorize.mockResolvedValue(undefined);
  mocks.command.mockResolvedValue({ allowed: true });
  expect((await post()).status).toBe(200);
  expect(warnings).not.toHaveBeenCalled();
});
it("rejects unauthenticated callbacks before database work or timing logs", async () => {
  expect((await post("heartbeat", "wrong")).status).toBe(401);
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect(mocks.command).not.toHaveBeenCalled();
  expect(warnings).not.toHaveBeenCalled();
});
