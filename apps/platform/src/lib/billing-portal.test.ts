import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./database", () => ({ database: vi.fn() }));
vi.mock("./stripe", () => ({ stripeClient: vi.fn() }));
import {
  humanBillingPortalUrl,
  isBillingPortalConfigured,
} from "./billing-portal";

const env = {
  STRIPE_PORTAL_CONFIGURATION_ID: "bpc_test123",
  STRIPE_SECRET_KEY: "sk_test_abc",
  STRIPE_PRICING_VERSION: "v1",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};
let rows: { customerId: string | null }[];
const db = {
  select: () => ({ from: () => ({ where: async () => rows }) }),
} as never;
let configuration: Record<string, unknown>;
const create = vi.fn();
const stripe = {
  billingPortal: {
    configurations: { retrieve: async () => configuration },
    sessions: { create },
  },
} as unknown as Stripe;

beforeEach(() => {
  rows = [{ customerId: "cus_123" }];
  configuration = {
    id: "bpc_test123",
    active: true,
    livemode: false,
    features: { payment_method_update: { enabled: false } },
  };
  create.mockReset();
  create.mockResolvedValue({ url: "https://billing.stripe.com/p/session/x" });
});

describe("billing portal", () => {
  it("requires a configuration id", () => {
    expect(isBillingPortalConfigured(env)).toBe(true);
    expect(isBillingPortalConfigured({})).toBe(false);
  });
  it("opens a session for the tenant's own customer", async () => {
    await expect(humanBillingPortalUrl("c1", env, stripe, db)).resolves.toBe(
      "https://billing.stripe.com/p/session/x",
    );
    expect(create).toHaveBeenCalledWith({
      customer: "cus_123",
      configuration: "bpc_test123",
      return_url: "http://localhost:3000/app/billing",
    });
  });
  it("refuses a portal that can change the saved card", async () => {
    configuration.features = { payment_method_update: { enabled: true } };
    await expect(humanBillingPortalUrl("c1", env, stripe, db)).rejects.toThrow(
      "misconfigured",
    );
    expect(create).not.toHaveBeenCalled();
  });
  it("refuses a configuration from the other Stripe mode", async () => {
    configuration.livemode = true;
    await expect(humanBillingPortalUrl("c1", env, stripe, db)).rejects.toThrow(
      "misconfigured",
    );
  });
  it("refuses accounts without a Stripe customer", async () => {
    rows = [];
    await expect(humanBillingPortalUrl("c1", env, stripe, db)).rejects.toThrow(
      "unavailable",
    );
  });
  it("rejects unexpected portal hosts", async () => {
    create.mockResolvedValue({ url: "https://evil.example/p" });
    await expect(humanBillingPortalUrl("c1", env, stripe, db)).rejects.toThrow(
      "link is unavailable",
    );
  });
});
