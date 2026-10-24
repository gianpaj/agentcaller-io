import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  drain: vi.fn(),
  env: vi.fn(),
  configured: vi.fn(),
}));
vi.mock("@/lib/billing-drain", () => ({ drainBilling: mocks.drain }));
vi.mock("@/lib/env", () => ({
  getCronEnv: mocks.env,
  isStripeConfigured: mocks.configured,
}));
import { POST } from "./route";
const secret = "offline-cron-secret-".repeat(3);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({ CRON_SECRET: secret });
  mocks.configured.mockReturnValue(true);
});
function request(token = secret) {
  return new Request("http://localhost:3000/api/internal/billing/drain", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
it("rejects unauthenticated ticks without draining", async () => {
  mocks.configured.mockReturnValue(false);
  expect((await POST(request("wrong"))).status).toBe(401);
  expect(mocks.drain).not.toHaveBeenCalled();
});
it("skips without Stripe configuration instead of failing", async () => {
  mocks.configured.mockReturnValue(false);
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ skipped: "stripe_not_configured" });
  expect(mocks.drain).not.toHaveBeenCalled();
});
it("drains when Stripe is configured", async () => {
  mocks.drain.mockResolvedValue({ deferred: 0 });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ deferred: 0 });
});
it("returns 503 when a configured drain fails", async () => {
  mocks.drain.mockRejectedValue(new Error("stripe down"));
  expect((await POST(request())).status).toBe(503);
});
