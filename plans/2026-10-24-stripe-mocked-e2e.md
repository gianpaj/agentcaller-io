# Automated Stripe journey with mocked providers

Status: implemented for mocked application acceptance. See the
[runtime guide](../docs/testing/stripe-e2e.md) and
[verification evidence](../.agents/notes/implemented/testing/2026-10-24-stripe-mocked-e2e.md).
Hosted provider and production release acceptance remain separate.

## Outcome and scope

One command proves a fresh human and a scripted agent can discover AgentCaller,
connect through OAuth, approve billing, save a simulated card, complete a first
`connect_me` call, inspect usage and collect a simulated monthly invoice.

Run the application and PostgreSQL for real. Replace external identity, payment,
telephony and inference services at their boundaries. No provider accounts,
credentials, customer card data, model calls or PSTN calls are required at runtime.
Installing dependencies, Chromium and the PostgreSQL image remains setup work.

This suite proves application behavior under specified provider responses.
Real Supabase issuance, agent-host compatibility, hosted Checkout/SCA, carrier
bounds, speech quality and actual provider costs retain their acceptance checks in
[release readiness](../docs/release-readiness.md). x402 implementation and testnet
onboarding are outside this plan.

## Existing foundations

| Source                                                                                     | Reuse                                                                                         |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `scripts/test-billing-db.mjs`, `scripts/test-connect-db.mjs`                               | Owned PostgreSQL 17 container, random loopback port and cleanup                               |
| `apps/platform/src/lib/billing.integration.test.ts`                                        | Migration bootstrap, Supabase SQL shims, enrollment/invoice builders and accounting scenarios |
| `apps/platform/src/lib/connect-me.integration.test.ts`                                     | Durable claim/dial authorization, replay, cleanup and concurrent state transitions            |
| `apps/platform/src/lib/mcp-auth.test.ts`, `mcp-route.test.ts`                              | Test signing keys, token claims, discovery and MCP HTTP messages                              |
| `apps/platform/src/lib/oauth-actions.test.ts`, `oauth-consent-page.test.ts`                | Human consent, ownership, redirects and connection creation                                   |
| `apps/platform/src/app/billing/connect/actions.test.ts`                                    | Human spending approval and setup continuation                                                |
| `apps/platform/src/lib/stripe-webhook.test.ts`                                             | SDK-generated signatures, raw-body verification and rejected deliveries                       |
| `apps/platform/src/lib/billing-money.test.ts`, `billing-period.test.ts`                    | Independent tariff expectations and time/rounding boundaries                                  |
| `apps/platform/src/lib/billing-drain.ts`                                                   | Actual accounting pipeline with injected Stripe client, database and time                     |
| `apps/voice-agent/src/connect-livekit.test.ts`, `connect-flow.test.ts`, `platform.test.ts` | SDK/RTC/model fakes, handoff logic and callback transport retries                             |

Keep focused unit, migration-upgrade and concurrency tests. Extract reusable
builders and bootstrap code where needed; do not copy those suites into browsers.
Existing Stripe builders use fixed IDs and need scenario-scoped object identities.

Keep pnpm, Vitest, jose, Stripe, Supabase, LiveKit, Drizzle and shared contracts.
Add pinned `@playwright/test` and one Node HTTP interception dev dependency,
preferably MSW after Phase 0 verifies it. A small MCP HTTP client can reuse existing
message fixtures; no LLM or additional agent framework is required.

## Stripe guidance and mock fidelity

Use Stripe's official skills during implementation and review:

| Skill/tool                                                                                            | Role in this work                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [stripe-best-practices](https://github.com/stripe/ai/blob/main/skills/stripe-best-practices/SKILL.md) | Review setup, off-session collection, webhook evidence and environment isolation; consult its payments, billing and security references |
| [stripe-docs](https://github.com/stripe/ai/blob/main/skills/stripe-docs/SKILL.md)                     | Use Stripe CLI documentation/API/event lookup to check the exact requests and object relationships our fake returns                     |
| [upgrade-stripe](https://github.com/stripe/ai/blob/main/skills/upgrade-stripe/SKILL.md)               | Use only if SDK/API/webhook versions change; synchronize fixture expectations with the selected version                                 |

The repository pins Stripe Node SDK `23.0.0` and API version
`2026-09-30.endive`. Reuse these pins and the code's `stripeApiVersion` constant.
Record documentation sources and the reviewed version alongside shared fixture
builders. Have the Stripe lane review both object shapes and lifecycle assumptions;
passing against a fake that shares our assumptions is not provider acceptance.

Make the skills and their required Stripe CLI documentation tooling available to
the implementing agent. They are development guidance, not dependencies of the
fully mocked command or CI job. Scope their advice to the existing Checkout
setup/SetupIntent and monthly Invoicing integration; subscription, metering-platform
migrations and SDK upgrades are separate work.

[stripe-mock](https://github.com/stripe/stripe-mock) is unsuitable as the journey's
main simulator: its stateless, hardcoded responses cannot preserve our customer,
saved-card, invoice and allocated-payment relationships or selected failure states.
It may support isolated request-shape checks, but is not a prerequisite here.
Reuse our builders for the small stateful fake instead.

[Stripe CLI fixtures](https://docs.stripe.com/cli/fixtures) issue related real API
requests. Keep them available for the separate sandbox acceptance suite, rather
than introducing Stripe access into the fully mocked runtime. Sandbox credentials,
hosted payment behavior and tax configuration remain provider acceptance concerns.

## Real application paths and fake boundaries

| Area                | Exercise for real                                                                             | Simulate                                                      |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Discovery and agent | Homepage/discovery routes and `/mcp` transport, authentication and tools                      | Deterministic sequence of agent tool choices                  |
| Identity            | Login/callback, SSR cookies, JWT verification, human checks, profile creation and consent     | Loopback Supabase-compatible issuer and GitHub identity       |
| Billing setup       | Setup links, continuation, browser consent, limits, SDK requests and retrieved-object checks  | Stripe HTTP responses and a minimal hosted completion page    |
| Calling             | Reservation, scheduler, `connectLiveKit`, `runConnectFlow` and authenticated worker callbacks | LiveKit dispatch/rooms/SIP/RTC, AMD and model/audio responses |
| Accounting          | Leg observations, cleanup, tariffs, usage, period close, invoice issuance and reconciliation  | Stripe invoice/payment outcomes                               |
| Persistence         | All migrations, constraints, transactions and queries                                         | Nothing; use disposable PostgreSQL                            |

No production auth bypass, public clock endpoint, replacement payment URLs or
production mock-mode switch. Keep fake code outside production imports. Browser
tests must not replace our API/server actions or pre-create successful domain state.

### Provider runtime

Use one loopback test coordinator per suite to own scenario state, dispatches,
provider objects and controlled delivery. Server interceptors, browser routes and
the simulated worker consume that state; independent in-memory copies must not
disagree about whether a Session or invoice completed.

Agree these test-only operations before parallel work: create/reset scenario,
complete/expire Checkout, deliver/replay a signed event, take an actual dispatch,
run a worker scenario, close a period and read a sanitized evidence snapshot.
Mutations affect fake provider state; application domain state changes only through
real application paths. Period close invokes the real accounting functions.

Use the Stripe SDK's existing Node HTTP transport. A test-process preload installs
Node HTTP/fetch interception before Next loads provider clients. Browser routes
alone cannot intercept server-side Stripe requests. Prove the preload reaches the
actual Next process and any process making provider requests.

Preserve `checkout.stripe.com`, `invoice.stripe.com` and billing-portal URL checks.
Playwright fulfills fake hosted pages at their expected HTTPS origins; a tiny
completion control replaces the provider UI. The route handler updates coordinator
state and follows the Session's real return URL. Do not reproduce Stripe's UI or
collect a fake card number just to test our continuation.

Only implement provider methods exercised by a scenario. Honor SDK serialization,
list envelopes/expansions, metadata, API version, ownership and stable idempotency
keys. Unsupported requests fail the test. Do not build another payment retry engine
or a general Stripe/Supabase/LiveKit emulator.

### Isolation and time

Start serially: one app, coordinator, worker bridge and database per suite. Existing
database tests truncate tables, and drains operate across accounts; tenant IDs alone
do not isolate concurrent suites. Each independent run owns its ports and resources.
Later parallel test workers need separate complete runtimes, not shared tables.

Extract the current all-migration bootstrap and auth SQL shims without weakening
the existing legacy-upgrade assertions. Seed only infrastructure such as test
tariffs. The human initially exists only in the fake issuer: no AgentCaller profile,
connection, billing account, card, usage or invoice exists for that human.

Use a fresh browser context and scenario-scoped provider IDs. Launch children with
explicit synthetic credentials and loopback database/provider configuration. Reject
live Stripe keys and non-owned databases. Block unexpected outbound requests in
server, worker and browser processes; do not rely on an invalid hostname eventually
failing. Do not reuse a developer's running server or real provider environment.

Keep OAuth and webhook signatures on wall-clock time. Use short positive,
sub-minute connected durations for the main HTTP journey. The platform rejects
worker observations more than five seconds in the future: advancing the worker's
clock alone by a minute is invalid. Keep minute-boundary and long-timeout cases in
the existing injected-clock unit/database tests.

After terminal calls and confirmed cleanup, a test-only accounting runner calls
`drainBilling(stripe, db, nextUtcMonth)` and subsequent recovery passes with explicit
time. Reuse Vitest to load the TypeScript modules and existing interception setup.
Do not rewrite period ends, usage, reservations or collected counters. This advances
accounting work, not the running app's clock. Assert historical invoice/usage views,
not that HTTP current-month status has changed. Separately test the authenticated
HTTP drain and its authorization at wall-clock time.

## Phases and acceptance

### Phase 0 — Prove the boundaries and freeze shared interfaces

Owner: foundation/integration. Finish before parallel feature work depends on it.

- Prove real Stripe SDK calls from Next are intercepted before any external request;
  unsupported outbound traffic fails. Test HTTP and fetch, not just browser traffic.
- Prove real SSR login/callback and jose verification can use a loopback issuer.
- Prove the worker bridge can invoke `connectLiveKit` with SDK fakes while leaving
  `./platform.js` unmocked and reaching the real authenticated callback route.
- Prove injected billing time closes a disposable period without changing HTTP
  token/signature time. Check the worker observation timestamp guard.
- Freeze coordinator operations, scenario IDs, ownership, environment, artifact
  schema and commands. Record any required narrow seam in the decision note.
- Review the Stripe skills and version-specific request/event references before
  freezing the fake's shared object builders and lifecycle contract.

Exit: runnable boundary checks and a shared fixture contract. MSW preloading is verified in the running Next process and inherited by the
Node test processes. If incompatible with Next, resolve one narrow
test-only loading/interception alternative before distributing dependent work;
do not silently replace the server with mocked route handlers.

### Phase 1 — Build the owned runtime

Owner: foundation/integration.

- Add Playwright config, disposable runner, migration helper, coordinator and server
  preload. Start Next and wait for readiness with bounded timeouts.
- Add explicit start/stop/reset, matching synthetic secrets, per-run identifiers,
  network guards and cleanup on failure or interruption.
- Provide the voice bridge and accounting runner launch interfaces for the lane
  owners. Keep a narrow shared fixture contract, not a new workspace service package.
- Reserve `pnpm test:stripe-e2e` for the complete journey and scoped identity,
  billing and voice commands for independent iteration. Document prerequisites.

Exit: one command starts a clean runtime, checks discovery, demonstrates rejected
external traffic and cleans up. A failed prerequisite fails rather than skipping
the suite. The implemented command and prerequisites are documented in the runtime guide.

### Phase 2 — Implement three lanes in parallel

#### Lane B: fresh identity, human consent and agent client

- Fake only the issuer endpoints the Supabase SDK uses: authorization/code exchange,
  user/JWKS, OAuth authorization details/decision and scoped recovery/revocation.
- Start from discovery and a fresh agent connection. Drive the actual GitHub login
  button, callback and human tool-consent page; retain redirect continuation.
- Issue distinct signed human and delegated-agent tokens. Human sessions have no
  `client_id`; delegated tokens include the exact MCP audience, issuer, human subject
  and OAuth client UUID. Keep application signature and claim checks enabled.
- Call actual MCP discovery, `tools/list` and tools. Consent creates exactly one
  non-operator profile/connection and grants no spending authority.
- Cover denied consent, wrong audience/owner and reconnect without duplicate records.

Exit: the new human's agent can call permitted tools, but cannot spend before setup.
An agent token cannot act as the human on portal/consent routes. Fake issuer behavior
does not establish real issuer PKCE enforcement or real host compatibility.

#### Lane C: card setup, Stripe evidence and monthly accounting

- Extract small setup/invoice builders from `billing.integration.test.ts`, preserving
  scenario-specific customer, Session, SetupIntent, card and invoice associations.
- Implement stateful customer/Session and invoice/item/line/payment handlers used by
  the real SDK. Preserve requested expansions and idempotent creation behavior.
- Drive our billing approval UI and fake hosted completion. Enrollment creates no
  payment charge. Readiness follows verified provider evidence, not the return URL.
- Deliver raw signed events through `/api/stripe/webhook`; reuse the SDK test-header
  helper and canonical event/API-version definitions.
- Exercise real period close, explicit usage item attachment, finalization and
  allocated successful card-payment evidence. A `paid` flag alone is insufficient.
- Add webhook-before/after-return, duplicate delivery and setup/card ownership cases.

Exit: browser consent and provider verification grant bounded spending. Accounting
collects exactly the expected amount once, with one invoice/item per non-waived
positive month.
Lane-level accounting tests may reuse existing usage fixtures; the composed journey
must obtain its usage from the worker path.

#### Lane D: actual worker flow with simulated telephony

- Extract SDK/RTC/model fakes from `connect-livekit.test.ts`. Keep `connectLiveKit`,
  `runConnectFlow`, shared schemas and real `connectRequest` HTTP transport.
- Consume actual scheduler dispatch metadata, then claim/dial/accept through the
  platform. Do not start from an invented successful attempt.
- Add distinct synthetic SIP IDs and real room membership/move semantics. Deletion
  emits disconnect observations for both connected legs, including the moved callback.
- Simulate human answer, callback press-1, mute-before-bridge, hangup and recording-off.
  Run authenticated scheduler cleanup before finalizing billing usage.
- Cover busy/no-answer, wrong-participant DTMF, callback refusal, cancellation and
  unknown timing/cleanup. Missing evidence must keep a hold.

Exit: both legs have actual worker-generated observations and cleanup evidence,
and the ledger finalizes without writing success/timestamps directly to PostgreSQL.

### Phase 3 — Compose the complete journey

Owner: integration, after lanes B/C/D pass independently.

1. Assert the fresh human has no application records; fetch discovery without side effects.
2. Complete browser login/tool consent and receive the delegated agent token.
3. Call `setup_billing`, follow its actual link and approve the human introduction,
   tariffs, account/integration limits and monthly collection agreement.
4. Complete simulated hosted enrollment. Poll `get_billing_status` until verified ready.
5. Call `quote_call`, then `schedule_call` for Call now with one attempt and a fresh
   quote. Use a stable idempotency key and preserve the original request for replay.
6. Run the authenticated connect drain. Consume its dispatch and complete the real
   worker flow with simulated providers; run scheduler cleanup and accounting.
7. Read `get_call_status` and `get_usage`. Assert terminal outcome, both-leg evidence,
   exact charge, zero outstanding hold and no duplicate dial on accepted replay.
8. Run one additional call under a new key to prove monthly aggregation.
9. Close the application period through the accounting runner. Simulate collection,
   deliver the signed event, reconcile and inspect the human invoice history.
10. Replay events, rerun reconciliation and verify no duplicate invoice/item/cash.

Use an independent, nonzero test tariff: each ES leg costs $0.10 to connect plus
$0.20 per started connected minute. Two positive sub-minute connected legs cost
**60 cents per call; two calls produce one 120-cent monthly invoice**. Set explicit
valid task bounds and caps that fund the full worst-case quote, not just the
expected conversation. Assert fixture totals directly rather than calculating
expected values with the production money function.

Also preserve current charging rules: an unanswered busy/no-answer leg costs its
10-cent connection fee; no dial intent with confirmed cleanup releases at zero;
unknown evidence retains a hold. A month with only 10 cents is waived, a zero month
has no invoice, and 60/120-cent fixtures exercise actual simulated collection.

Exit: the entire flow passes from empty application state through browser, MCP,
scheduler, worker HTTP, database and signed payment events with no provider access.
Include a two-human/two-agent isolation scenario; no copied API key or pre-seeded
profile/card/collected usage can satisfy the fresh-user test.

### Phase 4 — Add failure coverage and CI evidence

Distribute scenario files across lane owners; integration owns runtime and CI.

| Area                  | Required additional E2E evidence                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Identity/continuation | Wrong human opens setup, browser/agent closes and resumes, denied consent, revoked token/connection                          |
| Enrollment            | Return before webhook, webhook without return, expired setup, card replacement and foreign customer/card                     |
| Admission             | Setup-required creates no call/hold; same-key replay versus changed input; expired quote; limits block dispatch              |
| Calling               | Business busy/no-answer; callback refusal/wrong DTMF; cancellation/revocation before acceptance; cleanup failure holds usage |
| Collection            | Decline/action-required blocks new work; simulated hosted recovery; payment cannot revive revoked spending                   |
| Recovery              | Duplicate/out-of-order events; create/finalize succeeds but response is lost; rerun retrieves the same object                |
| Reconciliation        | Paid flag without allocated card cash, foreign invoice or incorrect totals requires review                                   |
| Time and amounts      | Zero/waived month and unresolved hold; keep detailed rounding, races and 23-hour recovery boundaries in focused tests        |

Keep browser journeys to cross-boundary failures. Existing unit/database tests own
the large combinatorial matrix and races; expand them when a new case belongs there.
The fake provider changes its own outcomes/events; it never flips application debt,
grants or collected state. Simulated recovery exercises our response, not Stripe's
real retry schedule, email delivery or authentication UI.

Add a dedicated mocked E2E CI workflow; no general application E2E workflow exists.
Use the pinned pnpm, a supported pinned Node version, Chromium and owned PostgreSQL.
Run the suite with no provider secrets and fail on skipped E2E tests. Preserve
existing checks and do not make provider-backed tests a prerequisite for offline CI.

Artifacts contain scenario/version, expected/observed cents, opaque object IDs,
stage outcomes and cleanup/network failures. Sanitize or disable traces/screenshots
containing auth headers, cookies or setup links; do not upload raw provider bodies,
tokens, full task text or transcripts. Report failed first attempts rather than
hiding flaky failures behind automatic retries.

Exit: clean local and CI runs, independent runtimes do not interfere, cleanup works
after failure, and a sanitized report shows every stage and accounting invariant.
Run relevant existing unit/database suites after shared-helper changes, plus scoped
typecheck/lint. Any platform/docs TSX edit requires that package's lint. Check all
changed file formatting; report unrelated repository failures separately.

## Parallel ownership and integration order

| Lane                      | Primary owned files (proposed new paths)                                                                                                                                   | Dependencies                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| A: foundation/integration | `scripts/test-stripe-e2e.mjs`, `scripts/e2e/`, `apps/platform/playwright.config.ts`, runtime/preload support, package scripts/lockfile, `.github/workflows/stripe-e2e.yml` | Phase 0, then Phase 1                        |
| B: identity/agent         | `apps/platform/e2e/identity.spec.ts`, `support/fake-supabase.*`, `support/agent-client.*`                                                                                  | A's runtime/fixture contract                 |
| C: Stripe/accounting      | `apps/platform/e2e/billing.spec.ts`, `support/fake-stripe.*`, setup/invoice builders and accounting-runner body                                                            | A; consume B's human/agent fixture interface |
| D: voice/usage            | `apps/voice-agent/e2e/`, its Vitest E2E config, extracted SDK fakes and bridge body                                                                                        | A; consume C's tariff/usage expectations     |
| A: final composition      | `apps/platform/e2e/stripe-journey.spec.ts`, execution docs and release checklist links                                                                                     | B, C and D                                   |

Merge the common foundation first. B/C/D then work concurrently against its narrow
interfaces, using existing focused fixtures for their own partial tests. Merge all
three before accepting the complete journey. Lane A alone edits shared scripts,
config/dependency files, coordinator protocol and lockfile; other lanes request
changes rather than independently revising those files.

Use separate worktrees based on the shared foundation, with branches such as
`codex/stripe-e2e-foundation`, `codex/stripe-e2e-identity`,
`codex/stripe-e2e-billing` and `codex/stripe-e2e-voice`. Commit reviewable chunks per
phase/lane. Parallel development does not require parallel test workers initially.

Record implementation decisions and seam proofs in the
[testing note](../.agents/notes/implemented/testing/2026-10-24-stripe-mocked-e2e.md).
Keep open work and evidence status in release readiness; this plan supplies the
procedure and ownership. Passing mocks closes only the corresponding application
test gaps. Hosted OAuth, Stripe, carrier and cost reconciliation checks remain open.

## Reference guidance

- [Stripe automated testing](https://docs.stripe.com/automated-testing): simulate
  provider UI outcomes for routine automation; hosted behavior has separate tests.
- [MSW Node integration](https://mswjs.io/guides/integrations/node): install
  interception before application requests and reset handlers between tests.
- [Playwright network routing](https://playwright.dev/docs/network): fulfill
  browser provider requests without changing application URL validation.
- [Playwright web server](https://playwright.dev/docs/test-webserver) and
  [parallelism](https://playwright.dev/docs/test-parallel): own app startup and
  isolate worker processes/resources.
