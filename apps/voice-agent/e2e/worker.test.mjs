import "../../platform/e2e/support/server-preload.mjs";
import { expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  resetProviders,
  disconnectParticipant,
} from "./support/livekit-fakes.mjs";

const state = vi.hoisted(() => ({}));
vi.mock("@livekit/agents", async () =>
  (await import("./support/livekit-fakes.mjs")).agentsModule(state),
);
vi.mock("@livekit/rtc-node", async () =>
  (await import("./support/livekit-fakes.mjs")).rtcModule(state),
);
vi.mock("livekit-server-sdk", async () =>
  (await import("./support/livekit-fakes.mjs")).serverModule(state),
);

import { Room } from "@livekit/rtc-node";
import { connectLiveKit } from "../src/connect-livekit.ts";
import { connectRequest } from "../src/platform.ts";

const scenario = JSON.parse(process.env.E2E_VOICE_SCENARIO ?? '{"proof":true}');
resetProviders(state, scenario);

if (scenario.proof) {
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
    expect(state.providerObjects).toBe(0);
  });
} else {
  test("actual worker executes the dispatched scenario through real platform callbacks", async () => {
    const dispatch = scenario.dispatch;
    expect(
      dispatch?.metadata,
      "Pass a dispatch captured by the real platform scheduler",
    ).toBeTruthy();
    const metadata =
      typeof dispatch.metadata === "string"
        ? JSON.parse(dispatch.metadata)
        : dispatch.metadata;
    expect(metadata.kind).toBe("connect_me");
    state.callId = metadata.callId;
    state.attemptId = metadata.attemptId;
    const events = [];
    const originalFetch = globalThis.fetch;
    let dropped = false;
    const observe = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        const response = await originalFetch(url, init);
        if (
          String(url).endsWith(
            "/api/internal/calls/" + state.callId + "/connect",
          )
        ) {
          const event = JSON.parse(init.body);
          const result = await response.clone().json();
          events.push({
            ...event,
            status: response.status,
            allowed: result.allowed,
          });
          if (event.action === "claim" && result.allowed) state.claim = result;
          if (event.action === "bridged" && result.allowed) {
            state.timers.push(
              setTimeout(
                () =>
                  disconnectParticipant(
                    state,
                    state.claim.businessRoom,
                    (scenario.hangupLeg ?? "business") + "_" + state.attemptId,
                  ),
                30,
              ),
            );
          }
          if (!dropped && scenario.dropResponseFor === event.action) {
            dropped = true;
            await response.body?.cancel();
            throw new TypeError("Simulated lost worker response");
          }
        }
        return response;
      });
    try {
      const room = new Room();
      const ctx = {
        room,
        job: { room: { name: dispatch.room } },
        connect: async () => room.bind(dispatch.room),
        addShutdownCallback() {},
      };
      await connectLiveKit(ctx, state.callId, state.attemptId);
      const claim = events.find((event) => event.action === "claim");
      expect(claim?.allowed).toBe(true);
      expect(state.claim.businessRoom).toBe(dispatch.room);
      const expected = scenario.outcome ?? "connected";
      const finish = events.findLast((event) => event.action === "finish");
      expect(finish?.allowed).toBe(true);
      expect(finish?.reason).toBe(
        expected === "cleanup_failure"
          ? "connected"
          : scenario.callbackOutcome &&
              ["busy", "no_answer"].includes(scenario.callbackOutcome)
            ? "callback_timeout"
            : expected,
      );

      const answered = events.filter(
        (event) => event.action === "connected" && event.allowed,
      );
      const ended = events.filter(
        (event) => event.action === "ended" && event.allowed,
      );
      expect(state.deleted).toEqual(
        expect.arrayContaining([
          state.claim.businessRoom,
          state.claim.callbackRoom,
        ]),
      );
      for (const dial of state.dials) {
        const task = state.claim.input.task;
        expect(dial.trunk).toBe(process.env.LIVEKIT_SIP_TRUNK_EU);
        expect(dial.options.waitUntilAnswered).toBe(true);
        expect(dial.options.ringingTimeout).toBe(
          dial.leg === "business"
            ? task.ringingSeconds
            : task.callbackRingingSeconds,
        );
        const bound =
          dial.leg === "business"
            ? task.waitingSeconds +
              task.handoffSeconds +
              task.conversationSeconds
            : task.acceptanceSeconds + task.conversationSeconds;
        expect(dial.options.maxCallDuration).toBeGreaterThan(0);
        expect(dial.options.maxCallDuration).toBeLessThanOrEqual(bound);
        expect(dial.options.fromNumber).not.toBe(dial.destination);
        expect(dial.options.participantAttributes["agentcaller.attempt"]).toBe(
          state.attemptId,
        );
      }
      if (
        ["connected", "cleanup_failure"].includes(expected) &&
        !scenario.callbackOutcome
      ) {
        expect(state.dials.map((dial) => dial.leg)).toEqual([
          "business",
          "callback",
        ]);
        expect(state.moves).toEqual([
          {
            source: state.claim.callbackRoom,
            identity: "callback_" + state.attemptId,
            target: state.claim.businessRoom,
          },
        ]);
        expect(answered.map((event) => event.leg)).toEqual([
          "business",
          "callback",
        ]);
        expect(new Set(answered.map((event) => event.sipCallId)).size).toBe(2);
        expect(ended.map((event) => event.leg).sort()).toEqual(
          expected === "cleanup_failure"
            ? ["business"]
            : ["business", "callback"],
        );
        for (const event of ended) {
          const start = answered.find((value) => value.leg === event.leg);
          const duration = Date.parse(event.at) - Date.parse(start.at);
          expect(duration).toBeGreaterThan(0);
          expect(duration).toBeLessThan(60_000);
        }
      } else {
        expect(state.moves).toHaveLength(0);
        expect(ended.map((event) => event.leg).sort()).toEqual(
          answered.map((event) => event.leg).sort(),
        );
      }
      if (expected === "callback_declined" || expected === "callback_timeout") {
        expect(state.dtmf[0]).toEqual({
          identity: "business_intruder",
          digit: "1",
        });
        expect(events.some((event) => event.action === "accept")).toBe(false);
      }
      if (scenario.dropResponseFor) {
        expect(dropped).toBe(true);
        const retried = events.filter(
          (event) => event.action === scenario.dropResponseFor,
        );
        expect(retried).toHaveLength(2);
        expect(retried[0].eventId).toBe(retried[1].eventId);
      }
    } finally {
      observe.mockRestore();
      for (const timer of state.timers) clearTimeout(timer);
    }
  });
}
