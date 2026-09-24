import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCallSchema } from "@agentcaller/contracts";
import type { JobContext } from "@livekit/agents";
const state = vi.hoisted(() => ({
  rooms: [] as any[],
  sessions: [] as any[],
  commands: [] as any[],
  dials: [] as any[],
  moves: [] as any[],
  deleted: [] as string[],
  digit: "1",
  category: "human",
  outcome: "human",
  callId: "00000000-0000-4000-8000-000000000001",
  attemptId: "00000000-0000-4000-8000-000000000002",
  input: {} as any,
  cancel: false,
  sipCode: 0,
}));
vi.mock("@livekit/rtc-node", async () => {
  const { EventEmitter } = await import("node:events");
  class Room extends EventEmitter {
    name = "";
    localParticipant = { publishDtmf: vi.fn() };
    constructor() {
      super();
      state.rooms.push(this);
    }
    async connect() {
      this.name = "callback-test";
    }
    async disconnect() {}
  }
  return {
    Room,
    RoomEvent: {
      ParticipantDisconnected: "participantDisconnected",
      Disconnected: "disconnected",
      DtmfReceived: "dtmfReceived",
    },
  };
});
vi.mock("./platform.js", () => ({
  connectRequest: vi.fn(async (_callId, event) => {
    state.commands.push(event);
    if (event.action === "claim")
      return {
        allowed: true,
        input: state.input,
        businessRoom: "business-test",
        callbackRoom: "callback-test",
      };
    if (event.action === "accept" && state.cancel) return { allowed: false };
    return { allowed: true };
  }),
}));
vi.mock("@livekit/agents", () => {
  class Session {
    input = { setAudioEnabled: vi.fn() };
    output = { setAudioEnabled: vi.fn() };
    agent: any;
    room: any;
    constructor() {
      state.sessions.push(this);
    }
    async start(options: any) {
      this.agent = options.agent;
      this.room = options.room;
      expect(options.record).toBe(false);
    }
    async interrupt() {}
    async close() {}
    updateOptions() {}
    generateReply() {
      this.agent.tools.classify.execute({ outcome: state.outcome });
    }
    say() {
      if (this.room.name === "callback-test")
        queueMicrotask(() => {
          // A different participant cannot accept, even when it sends the right digit.
          this.room.emit("dtmfReceived", 1, "1", {
            identity: "business_intruder",
          });
          if (state.digit)
            this.room.emit("dtmfReceived", Number(state.digit), state.digit, {
              identity: `callback_${state.attemptId}`,
            });
        });
      return { waitForPlayout: async () => {} };
    }
  }
  return {
    voice: {
      AgentSession: Session,
      Agent: class {
        tools: any;
        constructor(options: any) {
          this.tools = options.tools;
        }
      },
      AMD: class {
        async execute() {
          return { category: state.category };
        }
        async aclose() {}
      },
    },
    llm: { tool: (options: any) => options },
    inference: { STT: class {}, LLM: class {}, TTS: class {} },
  };
});
vi.mock("livekit-server-sdk", () => {
  class SipError extends Error {
    constructor(public sipStatusCode: number) {
      super("Offline SIP outcome");
    }
  }
  return {
    AccessToken: class {
      addGrant() {}
      async toJwt() {
        return "mock";
      }
    },
    SipCallError: SipError,
    SipClient: class {
      async listSipOutboundTrunk() {
        return [
          {
            sipTrunkId: "test",
            address: "sip.telnyx.eu",
            authUsername: "offline",
          },
        ];
      }
      async createSipParticipant(...args: any[]) {
        state.dials.push(args);
        if (state.sipCode) {
          state.rooms
            .find((r) => r.name === "business-test")
            .emit("participantDisconnected", {
              identity: `business_${state.attemptId}`,
            });
          throw new SipError(state.sipCode);
        }
      }
    },
    RoomServiceClient: class {
      async deleteRoom(room: string) {
        state.deleted.push(room);
      }
      async getParticipant() {
        return {};
      }
      async moveParticipant(...args: any[]) {
        expect(
          state.sessions.every((s) =>
            s.output.setAudioEnabled.mock.calls.some(
              ([enabled]: boolean[]) => enabled === false,
            ),
          ),
        ).toBe(true);
        state.moves.push(args);
        setTimeout(
          () =>
            state.rooms
              .find((r) => r.name === "business-test")
              .emit("participantDisconnected", {
                identity: `business_${state.attemptId}`,
              }),
          1,
        );
      }
    },
  };
});
import { Room } from "@livekit/rtc-node";
import { connectLiveKit } from "./connect-livekit";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T10:00:00Z"));
  Object.assign(state, {
    rooms: [],
    sessions: [],
    commands: [],
    dials: [],
    moves: [],
    deleted: [],
    digit: "1",
    category: "human",
    outcome: "human",
    cancel: false,
    sipCode: 0,
  });
  for (const [key, value] of Object.entries({
    LIVEKIT_URL: "wss://offline.invalid",
    LIVEKIT_API_KEY: "test",
    LIVEKIT_API_SECRET: "test",
    LIVEKIT_SIP_TRUNK_EU: "test",
    CONNECT_CALLER_ID_ES: "+34911234560",
    CONNECT_CALLER_ID_IT: "+39061234560",
    CONNECT_CALLBACK_CALLER_ID: "+34911234561",
  }))
    vi.stubEnv(key, value);
  state.input = createCallSchema.parse({
    destination: "+34911234567",
    destinationCountry: "ES",
    language: "es",
    maxDurationSeconds: 900,
    maxAmountUsd: 10,
    task: {
      type: "connect_me",
      callbackNumber: "+34612345678",
      callbackLanguage: "it",
      purpose: "Post office",
      callingWindow: {
        timezone: "Europe/Madrid",
        weekdays: [1, 2, 3, 4, 5],
        start: "09:00",
        end: "17:00",
      },
      expiresAt: "2026-09-19T10:00:00Z",
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function run(seconds = 1) {
  const room = new Room();
  Object.assign(room, { name: "business-test" });
  const ctx = {
    room,
    connect: async () => {},
    addShutdownCallback: () => {},
  } as unknown as JobContext;
  const result = connectLiveKit(ctx, state.callId, state.attemptId);
  await vi.advanceTimersByTimeAsync(seconds * 1000);
  await result;
}
it("dials into separate rooms and joins only after callback DTMF, with all AI output disabled", async () => {
  await run();
  expect(state.dials.map((d) => d[2])).toEqual([
    "business-test",
    "callback-test",
  ]);
  expect(state.dials[0][3]).toMatchObject({
    waitUntilAnswered: true,
    ringingTimeout: 40,
    maxCallDuration: 810,
    fromNumber: "+34911234560",
  });
  expect(state.dials[1][3]).toMatchObject({
    waitUntilAnswered: true,
    maxCallDuration: 615,
    fromNumber: "+34911234561",
  });
  expect(state.moves).toEqual([
    ["callback-test", `callback_${state.attemptId}`, "business-test"],
  ]);
  expect(state.commands.find((c) => c.action === "finish").reason).toBe(
    "connected",
  );
  expect(state.deleted).toEqual(
    expect.arrayContaining(["business-test", "callback-test"]),
  );
});
it("does not accept callback voicemail or DTMF from another participant", async () => {
  state.digit = "";
  await run(16);
  expect(state.moves).toHaveLength(0);
  expect(state.commands.find((c) => c.action === "finish").reason).toBe(
    "callback_timeout",
  );
});
it("rejects callback digit 2 without joining", async () => {
  state.digit = "2";
  await run();
  expect(state.moves).toHaveLength(0);
  expect(state.commands.find((c) => c.action === "finish").reason).toBe(
    "callback_declined",
  );
});
it("cancellation wins over acceptance", async () => {
  state.cancel = true;
  await run();
  expect(state.moves).toHaveLength(0);
});
it.each(["machine-vm", "uncertain", "machine-ivr"])(
  "stops %s before calling back",
  async (category) => {
    state.category = category;
    await run();
    expect(state.dials).toHaveLength(1);
    expect(state.moves).toHaveLength(0);
  },
);
it("uses separate Italian business caller ID and Spanish callback", async () => {
  state.input = {
    ...state.input,
    language: "it",
    destinationCountry: "IT",
    destination: "+39061234567",
    task: { ...state.input.task, callbackLanguage: "es" },
  };
  await run();
  expect(state.dials[0][3].fromNumber).toBe("+39061234560");
  expect(state.dials[1][1]).toBe("+34612345678");
});

it("keeps a pre-answer disconnect from hiding the definitive busy outcome", async () => {
  state.sipCode = 486;
  await run();
  expect(state.commands.find((c) => c.action === "finish").reason).toBe("busy");
  expect(state.dials).toHaveLength(1);
});
