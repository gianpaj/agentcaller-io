import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  reserve: vi.fn(),
  legacy: vi.fn(),
}));
vi.mock("./agent-auth", () => ({
  authenticateBillingPrincipal: mocks.principal,
}));
vi.mock("./billing-usage", async (original) => ({
  ...(await original<typeof import("./billing-usage")>()),
  reserveStripeCall: mocks.reserve,
}));
vi.mock("./submit-call", () => ({ submitCall: mocks.legacy }));
import { ApiError } from "./auth";
import { BillingSetupRequired } from "./billing-usage";
import { POST } from "../app/api/v1/calls/route";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.principal.mockResolvedValue({ clientId: "owner" });
});
const request = (extra: Record<string, string> = {}) =>
  new Request("https://agentcaller.example/api/v1/calls", {
    method: "POST",
    headers: {
      "x-agentcaller-funding": "stripe_postpaid",
      "idempotency-key": "stable-call",
      ...extra,
    },
    body: JSON.stringify({ maxAmountCents: 100 }),
  });
it("rejects mixed funding before admission", async () => {
  for (const header of ["payment-signature", "x-payment"]) {
    expect((await POST(request({ [header]: "synthetic" }))).status).toBe(422);
  }
  expect(mocks.reserve).not.toHaveBeenCalled();
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it("returns the human setup continuation without dispatching a legacy call", async () => {
  mocks.reserve.mockRejectedValue(
    new BillingSetupRequired({
      status: "pending",
      setupRequestId: "request",
      setupUrl: "https://agentcaller.example/billing/connect?request=synthetic",
      expiresAt: "2026-10-19T12:00:00Z",
    }),
  );
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    error: "billing_setup_required",
    setupRequestId: "request",
  });
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it("preserves disabled admission and sanitizes provider failures", async () => {
  mocks.reserve
    .mockRejectedValueOnce(new ApiError(503, "Paid calling is disabled"))
    .mockRejectedValueOnce(new Error("private-provider-payload"));
  const disabled = await POST(request());
  expect(disabled.status).toBe(503);
  expect(await disabled.json()).toEqual({ error: "Paid calling is disabled" });
  const failed = await POST(request());
  expect(await failed.text()).not.toContain("private-provider-payload");
});
