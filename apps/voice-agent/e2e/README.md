# Simulated voice worker bridge

The platform harness launches this suite through `runVoiceScenario(scenario)`.
It passes synthetic environment values and `E2E_VOICE_SCENARIO` as JSON.

- `{ proof: true }` exercises real callback authentication and rejected claims.
- `{ dispatch, outcome: "connected" }` consumes an actual scheduler dispatch,
  claims through HTTP and runs `connectLiveKit` and `runConnectFlow`.
- `outcome` also supports `busy`, `no_answer`, `voicemail`, `uncertain_answer`,
  `ivr_unresolved`, `refused`, `callback_declined`, `callback_timeout` and
  `cleanup_failure`. `callbackOutcome: "busy" | "no_answer"` fails that leg.
- `digit` overrides the callback keypress. An intruder's 1 is emitted first
  and cannot accept the call.
- `holdCallbackPrompt: true` holds provider session readiness inside the flow-level
  acceptance bound. The coordinator records `callbackPrompts[attemptId]` as `held`;
  the parent commits revocation and sends the LiveKit fixture command
  `release-callback-prompt` with that `attemptId`. The hold waits at most 15 seconds
  and rejects acceptance budgets at or below that deadline. The revocation scenario
  reserves 30 seconds for acceptance and 40 for handoff, with its quote checked
  against the call cap. Application timers and leg-duration bounds stay active.
- `hangupLeg: "callback"` ends a bridged conversation from the callback side.
- `dropResponseFor: "dial"` loses one actual committed response and verifies
  transport retry keeps the event ID and does not repeat the SIP dial.
- `expectedReason`, `finishAllowed` and `claimAllowed` describe expected application
  rejection when a parent test cancels or revokes access concurrently.

Only SDK/RTC/audio/model behavior is faked. The platform client is unmocked;
provider observations use current wall time. Room membership follows the callback
move, and room deletion emits end observations for every remaining participant.
The parent must run actual scheduler cleanup before billing finalization.

The full journey supplies the funded call through browser/MCP setup. A prewritten
call outcome, leg timestamp or collected counter cannot satisfy the bridge test.
Existing `connect-livekit.test.ts` scenarios remain the focused worker tests.
