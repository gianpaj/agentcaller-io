import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ drain: vi.fn(), env: vi.fn() }));
vi.mock("@/lib/connect-scheduler", () => ({ drainConnectJobs: mocks.drain }));
vi.mock("@/lib/env", () => ({
  getCronEnv: mocks.env,
  isStripeBillingEnabled: () => false,
}));
import { POST } from "./route";
const secret = "offline-cron-secret-".repeat(3);
let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.env.mockReturnValue({ CRON_SECRET: secret });
});
afterEach(() => vi.restoreAllMocks());
function request(token = secret) {
  return new Request("http://localhost:3000/api/internal/connect/drain", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
it("rejects unauthenticated ticks without draining", async () => {
  expect((await POST(request("wrong"))).status).toBe(401);
  expect(mocks.drain).not.toHaveBeenCalled();
});
it("returns the drain result for authenticated ticks", async () => {
  mocks.drain.mockResolvedValue({ cleanup: { attempts: 0, failedRooms: 0 } });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ cleanup: { failedRooms: 0 } });
});
it("returns a safe error and logs the failing drain stage", async () => {
  mocks.drain.mockRejectedValue(new Error(secret));
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain(secret);
  expect(errors).toHaveBeenCalledWith("Connect operation failed", {
    stage: "drain",
    failure: "request_failed",
  });
  expect(JSON.stringify(errors.mock.calls)).not.toContain(secret);
});
