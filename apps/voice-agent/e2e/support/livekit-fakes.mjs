import { EventEmitter } from "node:events";
import assert from "node:assert/strict";

async function waitForCallbackPrompt(attemptId) {
  const headers = {
    "content-type": "application/json",
    "x-e2e-token": process.env.E2E_CONTROL_TOKEN,
  };
  const ready = await fetch(process.env.E2E_CONTROL_URL + "/control/command", {
    method: "POST",
    headers,
    body: JSON.stringify({
      target: "livekit",
      action: "callback-prompt-ready",
      attemptId,
    }),
  });
  assert.equal(ready.status, 200);
  const deadline = Date.now() + 15_000;
  while (true) {
    const response = await fetch(
      process.env.E2E_CONTROL_URL + "/control/state",
      { headers },
    );
    assert.equal(response.status, 200);
    if ((await response.json()).callbackPrompts[attemptId] === "released")
      return;
    assert.ok(Date.now() < deadline, "Callback prompt release timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export function resetProviders(state, scenario = {}) {
  Object.assign(state, {
    scenario,
    providerObjects: 0,
    rooms: new Map(),
    members: new Map(),
    sessions: [],
    dials: [],
    moves: [],
    deleted: [],
    dtmf: [],
    grants: [],
    timers: [],
    claim: null,
  });
}

export function disconnectParticipant(state, roomName, identity) {
  const members = state.members.get(roomName);
  const participant = members?.get(identity);
  if (!participant) return;
  members.delete(identity);
  state.rooms.get(roomName)?.emit("participantDisconnected", participant);
}

export function rtcModule(state) {
  class Room extends EventEmitter {
    name = undefined;
    localParticipant = { publishDtmf: async () => {} };
    constructor() {
      super();
      state.providerObjects++;
    }
    bind(name) {
      this.name = name;
      state.rooms.set(name, this);
      if (!state.members.has(name)) state.members.set(name, new Map());
    }
    async connect(_url, encodedGrant) {
      this.bind(JSON.parse(encodedGrant).room);
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
}

export function agentsModule(state) {
  class Session {
    audio = { input: true, output: true };
    input = {
      setAudioEnabled: (enabled) => {
        this.audio.input = enabled;
      },
    };
    output = {
      setAudioEnabled: (enabled) => {
        this.audio.output = enabled;
      },
    };
    interrupted = false;
    constructor(options) {
      this.options = options;
      state.providerObjects++;
      state.sessions.push(this);
    }
    async start(options) {
      assert.equal(
        options.record,
        false,
        "Every simulated voice session must keep recording off",
      );
      this.agent = options.agent;
      this.room = options.room;
      this.options.start = options;
      // Hold provider readiness before the real worker starts its acceptance timer.
      if (
        state.scenario.holdCallbackPrompt &&
        this.room.name === state.claim.callbackRoom
      )
        await waitForCallbackPrompt(state.attemptId);
    }
    async interrupt() {
      this.interrupted = true;
    }
    async close() {}
    updateOptions() {}
    generateReply() {
      const outcome = [
        "refused",
        "ivr_unresolved",
        "uncertain_answer",
      ].includes(state.scenario.outcome)
        ? state.scenario.outcome
        : "human";
      queueMicrotask(() => this.agent.tools.classify.execute({ outcome }));
    }
    say(text) {
      if (this.room.name === state.claim.callbackRoom) {
        const digit =
          state.scenario.digit ??
          (state.scenario.outcome === "callback_declined"
            ? "2"
            : state.scenario.outcome === "callback_timeout"
              ? ""
              : "1");
        const deliver = () => {
          // The wrong participant's 1 must never grant acceptance.
          state.dtmf.push({ identity: "business_intruder", digit: "1" });
          this.room.emit("dtmfReceived", 1, "1", {
            identity: "business_intruder",
          });
          if (digit) {
            const identity = "callback_" + state.attemptId;
            state.dtmf.push({ identity, digit });
            this.room.emit("dtmfReceived", Number(digit), digit, { identity });
          }
        };
        queueMicrotask(deliver);
      }
      this.lastSpeech = text;
      return { waitForPlayout: async () => {} };
    }
  }
  class InferenceBoundary {
    constructor(options) {
      this.options = options;
    }
  }
  return {
    voice: {
      AgentSession: Session,
      Agent: class {
        constructor(options) {
          Object.assign(this, options);
        }
      },
      AMD: class {
        async execute() {
          return {
            category:
              state.scenario.outcome === "voicemail" ? "machine-vm" : "human",
          };
        }
        async aclose() {}
      },
    },
    llm: { tool: (options) => options },
    inference: {
      STT: InferenceBoundary,
      LLM: InferenceBoundary,
      TTS: InferenceBoundary,
    },
  };
}

export function serverModule(state) {
  class SipError extends Error {
    constructor(sipStatusCode) {
      super("Simulated SIP outcome");
      this.sipStatusCode = sipStatusCode;
    }
  }
  return {
    AccessToken: class {
      constructor() {
        state.providerObjects++;
      }
      addGrant(grant) {
        this.grant = grant;
        state.grants.push(grant);
      }
      async toJwt() {
        return JSON.stringify(this.grant);
      }
    },
    SipCallError: SipError,
    SipClient: class {
      constructor() {
        state.providerObjects++;
      }
      async listSipOutboundTrunk() {
        return [
          {
            sipTrunkId: process.env.LIVEKIT_SIP_TRUNK_EU,
            address: "sip.telnyx.eu",
            authUsername: "e2e",
          },
        ];
      }
      async createSipParticipant(trunk, destination, room, options) {
        const leg = options.participantAttributes["agentcaller.leg"];
        const effect = { trunk, destination, room, options, leg };
        state.dials.push(effect);
        const outcome =
          leg === "business"
            ? state.scenario.outcome
            : state.scenario.callbackOutcome;
        if (
          ["busy", "no_answer", "routing_denied", "dial_unknown"].includes(
            outcome,
          )
        ) {
          state.rooms.get(room)?.emit("participantDisconnected", {
            identity: options.participantIdentity,
          });
          throw new SipError(
            {
              busy: 486,
              no_answer: 480,
              routing_denied: 403,
              dial_unknown: undefined,
            }[outcome],
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        const participant = {
          identity: options.participantIdentity,
          sipCallId: "e2e_" + leg + "_" + state.attemptId,
        };
        state.members.get(room).set(participant.identity, participant);
        effect.sipCallId = participant.sipCallId;
        return participant;
      }
    },
    RoomServiceClient: class {
      constructor() {
        state.providerObjects++;
      }
      async deleteRoom(room) {
        state.deleted.push(room);
        if (
          state.scenario.outcome === "cleanup_failure" &&
          room === state.claim.businessRoom
        )
          throw new Error("Simulated room cleanup failure");
        for (const identity of [...(state.members.get(room)?.keys() ?? [])])
          disconnectParticipant(state, room, identity);
        state.rooms.get(room)?.emit("disconnected");
      }
      async getParticipant(room, identity) {
        const participant = state.members.get(room)?.get(identity);
        assert.ok(participant, "Bridge requires an existing participant");
        return participant;
      }
      async moveParticipant(source, identity, target) {
        assert.ok(
          state.sessions.every(
            (session) =>
              !session.audio.input &&
              !session.audio.output &&
              session.interrupted,
          ),
          "Both AI sessions must be silenced before handoff",
        );
        const participant = state.members.get(source)?.get(identity);
        assert.ok(
          participant,
          "Only the existing callback participant can move",
        );
        state.members.get(source).delete(identity);
        // Leaving during a move must not be reported as the end of the callback.
        state.rooms.get(source).emit("participantDisconnected", participant);
        state.members.get(target).set(identity, participant);
        state.moves.push({ source, identity, target });
      }
    },
  };
}
