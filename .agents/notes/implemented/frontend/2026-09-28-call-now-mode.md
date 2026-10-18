# Call now without scheduling fields

## Evidence and decision

Immediate calls should not require timezone, weekday, opening-hour, or deadline
entry. New forms default to Call now; scheduled redials retain their selected
hours. Switching modes keeps the draft but disables and hides inactive fields.

The shared contract uses `callingWindow: "now"` alongside the weekly object.
Invented all-day business hours were rejected: they misrepresent authorization
and can exclude midnight. Immediate mode requires one attempt and never defers
to another window or schedules a retry. Existing funding and destination checks
remain authoritative.

`getCallNowDeadline` provides a server-clock deadline after client validation.
The form retains it in a ref across uncertain transport retries alongside the
unchanged idempotency key, and resets it once the server returns a definitive
rejection or the user switches scheduling modes. Generating the real deadline
with browser time was rejected: a clock ahead of the server can exceed the
admission limit. The parser and API bound expiry to 30 minutes; expiry includes
queue time and active sessions. No additional database state or migration is
needed.

The [dispatch documentation](../../../../apps/docs/content/docs/dispatch.mdx#connection-timing)
defines the timing contract. Platform and worker deployments must both accept
the immediate task shape. Immediate eligibility is not a guarantee of worker
availability, and local UI tests do not establish live telephony readiness.

## Verification

- Platform: 206 tests passed; 37 disposable-database integration tests skipped
  because `CONNECT_TEST_DATABASE_URL` is unset. Seven added ledger cases cover
  immediate claiming, dial permission, no retry, and expiry.
- Contracts: 44 tests passed. Voice worker: 28 tests passed. Typechecks passed
  for all three packages; platform lint reported no warnings or errors.
- Browser checks at 390px and 1440px confirmed inactive fields are omitted,
  schedule and retry values survive switching, and layout does not overflow.
- With the browser clock one minute ahead, two blocked submissions retained the
  same server-generated expiry, idempotency key, and draft. The deadline was
  fetched once. Call submissions were blocked before reaching the backend.
- Screenshot capture timed out; visual screenshot review remains incomplete.
