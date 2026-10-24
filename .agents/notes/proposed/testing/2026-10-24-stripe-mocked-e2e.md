# Mocked Stripe E2E testing boundaries

Date: 2026-10-24. Lifecycle: proposed. Class: testing.

## Evidence

- Billing and connect PostgreSQL suites exercise transactions and races. The
  repository has no complete browser/MCP/worker/collection harness.
- Stripe's installed SDK uses Node HTTP; Playwright browser routes cannot intercept
  server-side requests. Checkout and invoice helpers validate Stripe HTTPS hosts.
- Supabase configuration permits a loopback issuer. Real human checks verify both
  user lookup and signed claims; delegated tokens cannot act as human sessions.
- Worker tests mock LiveKit and the platform client. Real callbacks require both
  leg end observations and scheduler cleanup before usage can finalize.
- Worker timestamps over five seconds ahead of the platform are rejected.
  Billing drain accepts injected time independently of token/webhook verification.
- Unanswered busy/no-answer legs incur connection fees under the
  [charging decision](../../implemented/billing/2026-10-24-unified-call-charging.md).

## Decisions proposed

- Keep the Next application, MCP, worker flow, PostgreSQL, consent and billing
  checks real. Fake provider responses and model/audio behavior only.
- Reuse Vitest, PostgreSQL runners, SDKs, jose and existing test object builders.
  Add Playwright and prove one test-only Node interception mechanism before
  parallel implementation depends on it.
- Own one isolated runtime per suite and run serially first. Existing database
  suites truncate tables; drains and provider state also prevent shared-runtime
  concurrency from being isolated by tenant IDs alone.
- Use a shared fixture interface, then separate identity, Stripe and voice lanes.
  One integrator owns shared dependencies, startup, coordinator protocol and CI.
- Use sub-minute observations in the complete journey and injected billing time
  for monthly close. Keep long-duration boundaries in focused clock-aware tests.
- Use official Stripe skills and version-specific references to review fixtures.
  Keep the existing SDK/API pins; CLI documentation tooling is not a CI dependency.

## Alternatives and consequences

- Mocking application auth, database or final call/payment state would skip the
  behavior being verified. Domain changes must use the actual application paths.
- A global month-long time jump invalidates identity/signatures; advancing only
  the worker violates timestamp checks. Neither is the accounting clock mechanism.
- A general provider emulator adds maintenance without proving provider fidelity.
  Implement only the provider interactions the selected scenarios require.
- Stripe's `stripe-mock` is stateless and cannot preserve the relationships our
  collection verification requires. Use existing builders for the stateful fake;
  reserve API-calling Stripe CLI fixtures for sandbox acceptance.
- Mocked acceptance cannot close hosted issuer, Stripe, carrier or actual-cost
  verification. Those remain in the release checklist.

## Implementation and open checks

The [phased plan](../../../../plans/2026-10-24-stripe-mocked-e2e.md) defines scope,
ownership and acceptance. Phase 0 must prove interception in the actual Next
process, the loopback issuer and real worker HTTP bridge. Keep this note proposed
until implementation and its boundary evidence are accepted. Track remaining
work in [release readiness](../../../../docs/release-readiness.md).
