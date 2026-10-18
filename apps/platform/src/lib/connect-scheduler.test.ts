import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  claim: vi.fn(),
  due: vi.fn(),
  stop: vi.fn(),
  database: vi.fn(),
}));
vi.mock("./operator-funding", () => ({
  authorizeOperatorCall: mocks.authorize,
}));
vi.mock("./connect-me", () => ({
  claimConnectAttempt: mocks.claim,
  dueConnectJobs: mocks.due,
}));
vi.mock("./livekit", () => ({
  stopCall: mocks.stop,
  dispatchConnectAttempt: vi.fn(),
}));
vi.mock("./database", () => ({ database: mocks.database }));
import { cleanupConnectRooms, drainConnectJobs } from "./connect-scheduler";
import { logConnectFailure } from "./connect-log";
const secret = "private-provider-message";
const attempt = {
  id: "attempt-id",
  callId: "call-id",
  businessRoom: "business-room",
  callbackRoom: "callback-room",
};
let errors: ReturnType<typeof vi.spyOn>;
let query: any;
beforeEach(() => {
  vi.resetAllMocks();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  query = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
  mocks.database.mockReturnValue(query);
  mocks.due.mockResolvedValue([{ callId: "call-id" }]);
  mocks.claim.mockResolvedValue(attempt);
  mocks.authorize.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue(undefined);
});
afterEach(() => {
  expect(JSON.stringify(errors.mock.calls)).not.toContain(secret);
  vi.restoreAllMocks();
});

it("logs dispatch failure with IDs and status without redispatching", async () => {
  const dispatch = vi
    .fn()
    .mockRejectedValue(Object.assign(new Error(secret), { status: 503 }));
  expect(await drainConnectJobs(dispatch)).toEqual({
    cleanup: { attempts: 0, failedRooms: 0 },
  });
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(errors).toHaveBeenCalledWith("Connect operation failed", {
    stage: "dispatch",
    callId: "call-id",
    attemptId: "attempt-id",
    status: 503,
    failure: "request_failed",
  });
});

it("reports authorization denial while preserving cleanup-only claims", async () => {
  mocks.authorize.mockRejectedValue(
    Object.assign(new Error(secret), { status: 403 }),
  );
  mocks.claim.mockResolvedValue(null);
  const dispatch = vi.fn();
  await drainConnectJobs(dispatch);
  expect(mocks.claim).toHaveBeenCalledWith(
    "call-id",
    query,
    expect.any(Date),
    false,
  );
  expect(dispatch).not.toHaveBeenCalled();
  expect(errors.mock.calls[0][1]).toMatchObject({
    stage: "authorize",
    callId: "call-id",
    status: 403,
  });
});

it("reports failed claims with the call ID and propagates the drain failure", async () => {
  mocks.claim.mockRejectedValue(new Error(secret));
  await expect(drainConnectJobs(vi.fn())).rejects.toThrow(secret);
  expect(errors.mock.calls[0][1]).toMatchObject({
    stage: "claim_attempt",
    callId: "call-id",
  });
});

it("identifies the failed cleanup leg without marking rooms cleaned", async () => {
  query.limit.mockResolvedValue([attempt]);
  mocks.stop.mockRejectedValueOnce(
    Object.assign(new Error(secret), { name: "TimeoutError" }),
  );
  expect(await cleanupConnectRooms()).toEqual({ attempts: 1, failedRooms: 1 });
  expect(query.update).not.toHaveBeenCalled();
  expect(errors.mock.calls[0][1]).toEqual({
    stage: "cleanup_business",
    callId: "call-id",
    attemptId: "attempt-id",
    failure: "timeout",
  });
});

it("marks successful cleanup and keeps idle success quiet", async () => {
  query.limit.mockResolvedValue([attempt]);
  expect(await cleanupConnectRooms()).toEqual({ attempts: 1, failedRooms: 0 });
  expect(query.update).toHaveBeenCalledTimes(1);
  expect(errors).not.toHaveBeenCalled();
});

it("logs configuration failures without dumping validation values", () => {
  logConnectFailure(
    "drain",
    Object.assign(new Error(secret), {
      name: "ZodError",
      issues: [{ input: secret }],
    }),
  );
  expect(errors.mock.calls[0][1]).toEqual({
    stage: "drain",
    failure: "invalid_configuration",
  });
});
