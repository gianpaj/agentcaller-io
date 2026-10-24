# Mocked Stripe E2E testing boundaries

Date: 2026-10-24. Lifecycle: implemented. Class: testing.

## Evidence

The [runtime guide](../../../../docs/testing/stripe-e2e.md) documents the command
and fixture contract. The [phased plan](../../../../plans/2026-10-24-stripe-mocked-e2e.md)
defines ownership and acceptance. The application publishes no test endpoints.

Verification on [the tested source](https://github.com/gianpaj/agentcaller-io/commit/95f1069dc3cc51ce68b8045b0d0b163126ff6888):

- `pnpm test:stripe-e2e`: 32 browser/MCP/worker/accounting scenarios pass together.
  The sanitized JSON records the source revision, mocked scope, two calls,
  one invoice and exactly 120 cents collected.
- Workspace typecheck, lint, unit tests and build pass. Platform tests pass
  398 cases; 30 billing and 46 connect PostgreSQL cases pass separately.
  Existing voice tests pass 42 cases and contracts pass 98.
- Seven result-gate tests include a real Playwright invocation that fails when
  a scenario is skipped. Unexpected provider requests also fail the suite.
- Repository formatting reports 47 files. Forty-six are byte-identical to the
  parent branch; the changed generated lockfile retains pnpm's already-flagged
  style. Handwritten changed files pass formatting.
- The local environment uses Node 24.15.0, pnpm 10.16.1, PostgreSQL 17, Playwright
  1.64.1 and MSW 2.15.0. Stripe SDK 23.0.0 and API `2026-09-30.endive` remain pinned.

## Decisions

Run Next routes/actions, MCP, JWT/signature and ownership checks, the actual
`connectLiveKit`/`runConnectFlow`, accounting and PostgreSQL for real.
Fake only Supabase/GitHub, Stripe, LiveKit/SIP and model/audio boundaries.
Shared builders retain customer, Session, SetupIntent, card, invoice and
allocated-payment relationships. The SDK supplies the fixture API version,
checked against the application's pin. Indexed `expand[0]` queries are supported.

One launcher owns each runtime's processes, ports, container and temporary files.
Before allocating resources, it rejects Next development environment files in
`apps/platform`; Next would otherwise merge developer configuration into the
synthetic environment. Guarded children invoke the installed test CLIs with Node,
so package-manager cache state cannot trigger a download inside the HTTP guard.
Automatic per-test fixtures reset the database/providers and assert network and
unsupported-method results. Tests run serially within a worktree. Independent
worktrees provide development parallelism; tenants alone cannot isolate global
drains or suites that truncate tables.

Inherited Node preloading protects the app, driver, API client and worker
processes. Named HTTP imports use synchronized built-in exports. Exact local
app/coordinator origins use native fetch, preserving cancellation of response
streams used by worker retries. Other HTTP requests receive fake Stripe/version
responses or a recorded 599 block. Browser contexts also guard HTTP/WebSockets.
The app binds to localhost to match its callback and server-action origins.
The Node allowlist covers fetch and HTTP(S); raw sockets require separate network
isolation. Browser contexts also guard WebSockets.

Worker scenarios use short positive real-time observations. Revocation tests hold
callback provider readiness until the human revocation commits, then release the
prompt and DTMF. The flow-level acceptance bound includes readiness. This scenario
reserves a 30-second acceptance budget around the 15-second fixture hold deadline
and a 40-second handoff budget; the fake rejects an acceptance budget that cannot
outlast the hold. The quote must fit the call cap, and call bounds remain active. Hangup follows the acknowledged bridge, and moved participants retain room membership so deletion
emits both legs' end observations. The actual scheduler confirms cleanup;
no test fabricates successful call, cleanup, usage or collection fields in SQL.

Month close injects time into the billing pipeline. App, OAuth and webhook clocks
stay on wall time. Unknown cleanup retains a hold and prevents invoicing. Confirmed
cleanup finalizes usage through the actual pipeline. Busy/no-answer fees follow
the [charging decision](../billing/2026-10-24-unified-call-charging.md).

Keep one generated calling-window descriptor for MCP and OpenAPI while preserving
the runtime validator's nested field errors. Full-permission tool discovery is
tested for both supported protocol eras and all six tools.

## Rejected options and consequences

- Database/auth/application-state mocks would skip the transactions and authority
  being verified. Browser journeys create profiles and spending through real flows.
- Browser-only routing leaves Node driver/API traffic outside the guard. All Node
  child processes inherit interception; browser contexts receive their own guard.
- Module-level test hooks can be cached across imported files. Automatic fixtures
  enforce isolation for every case.
- Global month-long time jumps invalidate credentials; advancing only the worker
  violates timestamp checks. Long boundaries stay in focused injected-clock tests.
- Stateless `stripe-mock` cannot preserve collection evidence. The small stateful
  fake models only exercised methods; CLI API fixtures belong to sandbox acceptance.
- A plain runtime union loses field-level calling-window errors. The shared
  descriptor avoids duplicating handwritten wire schemas or weakening validation.

## Scope limits and next acceptance

Fake responses cannot establish deployed Supabase issuance, external host PKCE,
hosted Checkout/SCA/retries/emails, carrier duration enforcement, speech quality,
or actual Telnyx/LiveKit/model expenses. No provider accounts, real payments or
calls were used. Production feature defaults remain disabled.

Real-provider and release acceptance remains in
[release readiness](../../../../docs/release-readiness.md).
