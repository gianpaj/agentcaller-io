# Unified charging for regular users

## Evidence

- The x402 settlement (`apps/platform/src/lib/settlement.ts`) billed every
  terminal call at least the connection fee plus one started minute. That
  included calls that never rang.
- An x402 cancel billed wall-clock time from `createdAt`, which counted queue
  and ringing time.
- The legacy worker reported every dial failure as `agent_session_failed`, so
  the platform could not tell busy or no-answer apart from its own failures.
- Stripe postpaid billed only connected legs, so unanswered legs were free.
- No Stripe pricing version had been issued, so no customer had accepted the
  earlier Stripe terms.

## Decision

Regular users pay the same way under x402 and Stripe:

- A leg that rings and gets busy or no answer pays its connection fee. This
  applies to both the business leg and the callback leg.
- An answered leg pays the connection fee plus started minutes from the answer.
- A call that never rang costs nothing. That covers a cancel before the
  answer, routing or destination failures, and platform failures.

Operator-funded calls stay `not_required` and are never charged.

The x402 worker now reports `answered` and the SIP failure reason. The
platform falls back to `in_progress` state for workers that do not send
`answered`. An x402 cancel bills from the `call.in_progress` event time.

## Open questions

- Make a missed callback free once the requesting human's number is verified.
- The x402 answer time is the worker's observation of the LiveKit SIP answer.
  It is not a provider CDR.
- An x402 settlement of zero does not call CDP and leaves the authorization
  to lapse. Confirm this with the facilitator's batch-settlement semantics.
- A callback leg that ends as `callback_timeout` without connecting is billed
  as unanswered. That includes the rare case where the handoff bound expired
  between dial permission and the SIP dial.
