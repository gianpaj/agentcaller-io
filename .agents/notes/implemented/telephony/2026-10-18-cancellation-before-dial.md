# Manual submission before dial intent

## Evidence

The portal's destination guard checks historical call outcomes. A cancelled
attempt with no worker claim or dial leg triggers the same reconciliation block
as a cancellation during an uncertain SIP operation.

## Decision

`apps/platform/src/lib/submit-call.ts` permits a fresh manual submission after
cancellation or a configuration failure only when the original call is terminal
and none of its attempts has a `call_legs` row. All other uncertain outcomes
retain their existing block.

The platform commits a leg before granting dial permission. Cancellation makes
the call terminal under the same call-row lock used by dial authorization, so a
late worker cannot obtain permission after termination. Terminal calls and their
attempt records remain intact; no terminal state reopens.

Treating successful room deletion as proof of provider cleanup is rejected.
An in-flight SIP request can outlive room deletion. Any recorded leg therefore
preserves the reconciliation requirement regardless of `rooms_cleaned_at`.

## Verification

PostgreSQL integration coverage exercises cancellation while queued, dispatched,
and claimed, plus configuration failures and cancellation after dial intent with
and without room cleanup.
