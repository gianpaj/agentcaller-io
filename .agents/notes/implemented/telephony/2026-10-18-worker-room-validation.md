# Worker room validation

## Evidence

LiveKit RTC `Room.name` is undefined until the room connects. The dispatched
job's `room.name` is available at entry. A guard against the disconnected RTC
room rejects valid jobs before any dial intent is authorized.

## Decision

`apps/voice-agent/src/connect-livekit.ts` validates the assigned job room against
the platform's authorized business room before connecting. Setup errors log call
and attempt IDs, the failing stage, or invalid environment field names. Logs omit
environment values and raw provider errors.

Fresh manual submissions follow the
[terminal-call policy](2026-10-18-cancellation-before-dial.md).

## Verification

The worker test starts with an unnamed RTC room and assigns its name only during
connection. It covers successful handoff, mismatched job rooms, invalid settings,
and trunk validation failures before dialing.
