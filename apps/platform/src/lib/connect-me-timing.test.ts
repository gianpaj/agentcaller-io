import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConnectEvent } from "@agentcaller/contracts";
const mocks = vi.hoisted(() => ({ lock: vi.fn(), now: 0 }));
vi.mock("./billing-store", async (original) => ({
  ...(await original<typeof import("./billing-store")>()),
  lockCallBillingAccount: mocks.lock,
}));
import { connectCommand } from "./connect-me";
const event: ConnectEvent = {
  eventId: "00000000-0000-4000-8000-000000000001",
  attemptId: "00000000-0000-4000-8000-000000000002",
  workerId: "00000000-0000-4000-8000-000000000003",
  action: "heartbeat",
};
const failure = new Error("private database detail");
let warnings: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => mocks.now);
  warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  expect(JSON.stringify(warnings.mock.calls)).not.toContain(failure.message);
  vi.restoreAllMocks();
});
it("separates transaction startup from execution and preserves database failures", async () => {
  const db = {
    transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      mocks.now += 2000;
      return operation({});
    },
  } as unknown as Parameters<typeof connectCommand>[2];
  mocks.lock.mockImplementation(async () => {
    mocks.now += 3000;
    throw failure;
  });
  await expect(connectCommand("call-id", event, db)).rejects.toBe(failure);
  expect(warnings).toHaveBeenCalledWith("Slow connect operation", {
    stage: "transaction",
    callId: "call-id",
    attemptId: event.attemptId,
    action: "heartbeat",
    totalMs: 5000,
    transactionStartMs: 2000,
    transactionMs: 3000,
  });
});
it("reports transaction startup failure without inventing execution time", async () => {
  const db = {
    transaction: async () => {
      mocks.now += 5000;
      throw failure;
    },
  } as unknown as Parameters<typeof connectCommand>[2];
  await expect(connectCommand("call-id", event, db)).rejects.toBe(failure);
  expect(mocks.lock).not.toHaveBeenCalled();
  expect(warnings.mock.calls[0][1]).toEqual({
    stage: "transaction",
    callId: "call-id",
    attemptId: event.attemptId,
    action: "heartbeat",
    totalMs: 5000,
    transactionStartMs: 5000,
  });
});
