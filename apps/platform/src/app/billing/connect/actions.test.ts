import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  human: vi.fn(),
  resolve: vi.fn(),
  approve: vi.fn(),
  checkout: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "synthetic-continuation" }) }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/portal", () => ({ requireHumanSession: mocks.human }));
vi.mock("@/lib/billing-setup", () => ({
  resolveBillingSetupToken: mocks.resolve,
  approveBillingSetup: mocks.approve,
  beginBillingCheckout: mocks.checkout,
}));
import { saveBillingConsent } from "./actions";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.human.mockResolvedValue({
    user: {
      id: "owner",
      email: "offline@example.test",
      email_confirmed_at: "2026-10-18Z",
    },
  });
  mocks.resolve.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
  });
  mocks.checkout.mockResolvedValue("https://checkout.stripe.com/offline");
});
function form(consent = true) {
  const data = new FormData();
  data.set("setupRequestId", "11111111-1111-4111-8111-111111111111");
  if (consent) data.set("consent", "yes");
  data.set("monthlyLimitCents", "1000");
  data.set("perCallLimitCents", "100");
  data.set("agreementVersion", "monthly-usage-v1");
  data.set("pricingVersion", "offline-v1");
  data.set("contactName", "Offline caller");
  data.set("email", "attacker@example.test");
  return data;
}
it("requires explicit human consent before any billing change", async () => {
  await expect(saveBillingConsent(form(false))).rejects.toThrow("Confirm");
  expect(mocks.approve).not.toHaveBeenCalled();
  expect(mocks.checkout).not.toHaveBeenCalled();
});
it("checks the continuation against the verified owner", async () => {
  mocks.resolve.mockRejectedValue(new Error("Wrong owner"));
  await expect(saveBillingConsent(form())).rejects.toThrow("Wrong owner");
  expect(mocks.resolve).toHaveBeenCalledWith("synthetic-continuation", "owner");
  expect(mocks.approve).not.toHaveBeenCalled();
});
it("uses the verified email and approved caps instead of submitted identity", async () => {
  await saveBillingConsent(form());
  expect(mocks.approve).toHaveBeenCalledWith(
    "11111111-1111-4111-8111-111111111111",
    "owner",
    "offline@example.test",
    { monthlyLimitCents: 1000, perCallLimitCents: 100 },
    {
      contactName: "Offline caller",
      agreementVersion: "monthly-usage-v1",
      pricingVersion: "offline-v1",
    },
  );
  expect(mocks.redirect).toHaveBeenCalledWith(
    "https://checkout.stripe.com/offline",
  );
});
it("rejects delegated sessions before consent or Checkout", async () => {
  mocks.human.mockRejectedValue(new Error("A human sign-in is required"));
  await expect(saveBillingConsent(form())).rejects.toThrow("human sign-in");
  expect(mocks.approve).not.toHaveBeenCalled();
});

it("binds consent to the integration displayed in the submitting tab", async () => {
  mocks.resolve.mockResolvedValue({
    id: "22222222-2222-4222-8222-222222222222",
  });
  await expect(saveBillingConsent(form())).rejects.toThrow("out of date");
  expect(mocks.approve).not.toHaveBeenCalled();
  expect(mocks.checkout).not.toHaveBeenCalled();
});
