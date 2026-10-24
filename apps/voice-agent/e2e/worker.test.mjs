import "../../platform/e2e/support/server-preload.mjs";
import { expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
const providers = vi.hoisted(() => ({ touched: 0 }));
vi.mock("@livekit/agents", () => ({ inference: {}, llm: {}, voice: {} }));
vi.mock("@livekit/rtc-node", () => ({
  Room: class {
    constructor() {
      providers.touched++;
    }
  },
  RoomEvent: {},
}));
vi.mock("livekit-server-sdk", () => {
  class ExternalProvider {
    constructor() {
      providers.touched++;
    }
  }
  return {
    AccessToken: ExternalProvider,
    RoomServiceClient: ExternalProvider,
    SipClient: ExternalProvider,
    SipCallError: class extends Error {},
  };
});
import { connectLiveKit } from "../src/connect-livekit.ts";
import { connectRequest } from "../src/platform.ts";

test("real worker HTTP transport reaches the protected application callback", async () => {
  const callId = randomUUID();
  const event = {
    eventId: randomUUID(),
    attemptId: randomUUID(),
    workerId: randomUUID(),
    action: "claim",
  };
  const endpoint =
    process.env.PLATFORM_URL + "/api/internal/calls/" + callId + "/connect";
  expect(
    (
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      })
    ).status,
  ).toBe(401);
  const realFetch = vi.spyOn(globalThis, "fetch");
  try {
    expect(await connectRequest(callId, event)).toEqual({ allowed: false });
    expect(realFetch).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-agentcaller-agent-secret": process.env.AGENT_CALLBACK_SECRET,
        }),
      }),
    );
  } finally {
    realFetch.mockRestore();
  }
});

test("actual connectLiveKit rejects an unauthorized attempt before provider access", async () => {
  await connectLiveKit({}, randomUUID(), randomUUID());
  expect(providers.touched).toBe(0);
});
