import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripeApiVersion } from "./stripe";
const state = vi.hoisted(() => ({ receive: vi.fn() }));
vi.mock("./stripe-events", async (original) => ({
  ...(await original<typeof import("./stripe-events")>()),
  receiveStripeEvent: state.receive,
}));
import { POST } from "../app/api/stripe/webhook/route";

const secret = "whsec_isolated_unit_test_only";
const event = {
  id: "evt_offline",
  type: "checkout.session.completed",
  api_version: stripeApiVersion,
  livemode: false,
  data: { object: { id: "cs_offline" } },
};
function request(
  payload = JSON.stringify(event),
  timestamp?: number,
  signatureOverride?: string,
) {
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    timestamp,
  });
  return new Request("https://agentcaller.example/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signatureOverride ?? signature },
    body: payload,
  });
}
beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_offline");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  vi.stubEnv("STRIPE_BILLING_ENABLED", "false");
  state.receive.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
describe("signed raw Stripe event delivery", () => {
  it("records verified routing even when new paid admission is disabled", async () => {
    const response = await POST(request(JSON.stringify(event, null, 2)));
    expect(response.status).toBe(200);
    expect(state.receive).toHaveBeenCalledWith(event);
  });
  it("rejects a changed raw body, missing signature or expired timestamp without persistence", async () => {
    const signed = request();
    const changed = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: JSON.stringify(event) + " ",
    });
    expect((await POST(changed)).status).toBe(400);
    expect(
      (
        await POST(
          new Request(signed.url, {
            method: "POST",
            body: JSON.stringify(event),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request(JSON.stringify(event), Math.floor(Date.now() / 1000) - 600),
        )
      ).status,
    ).toBe(400);
    expect(state.receive).not.toHaveBeenCalled();
  });
  it("rejects another signing key, environment or event version", async () => {
    expect(
      (
        await POST(
          request(
            JSON.stringify(event),
            undefined,
            Stripe.webhooks.generateTestHeaderString({
              payload: JSON.stringify(event),
              secret: "whsec_other_unit_test_only",
            }),
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(request(JSON.stringify({ ...event, livemode: true }))))
        .status,
    ).toBe(400);
    expect(
      (
        await POST(
          request(JSON.stringify({ ...event, api_version: "2020-01-01" })),
        )
      ).status,
    ).toBe(400);
    expect(state.receive).not.toHaveBeenCalled();
  });
  it("requires durable storage before acknowledgment and hides internal errors", async () => {
    state.receive.mockRejectedValue(new Error("secret-payment-payload"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-payment-payload");
  });
  it("bounds the raw body before signature processing", async () => {
    const response = await POST(
      new Request("https://agentcaller.example/api/stripe/webhook", {
        method: "POST",
        body: "x".repeat(1_048_577),
      }),
    );
    expect(response.status).toBe(413);
    expect(state.receive).not.toHaveBeenCalled();
  });
});
