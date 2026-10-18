# Agent-authorized, pay-as-you-go Stripe billing

Date: 2026-10-18. Status: approved for incremental implementation on
`codex/stripe-agent-billing`, based on `feat/landing-page-refresh`.
Progress and verification are tracked in the
[implementation note](../.agents/notes/proposed/billing/2026-10-18-stripe-implementation.md).
Architecture evidence is pinned to reviewed commit
`5fae14602b407ce9325bb5688d28697d1cb234a5`. Recheck integration points against
the implementation branch before changing code.

## 1. Recommendation and scope

Add saved-card postpaid billing to the existing platform. Use Stripe Checkout
in setup mode, an AgentCaller spending authorization, PostgreSQL reservations
and usage records, and one Stripe invoice for each nonzero, collectible monthly
total. Stripe Invoicing owns automatic saved-card collection, configured retries,
failed-payment emails and hosted payment/authentication recovery. Keep x402 and
operator funding as explicit, independent modes.
The spending ceiling never represents deposited money.

The MVP includes remote MCP onboarding with OAuth and the complete human billing
setup flow. A person connects an agent, authenticates, approves tool access,
approves an AgentCaller spending allowance, saves a card without payment, and
resumes the original call request. Manual API-key copying or operator account
linking cannot be required for this customer path. Existing API-key integrations
remain supported alongside MCP.

The proposed first calling scope is `connect_me`: reach a business and connect
the human after private callback acceptance. It needs exact scheduling, reliable
usage finalization and explicit funding checks throughout execution. Support for
autonomous reservation/appointment tasks remains a separate scope decision.
Saved-card monthly Invoicing is the MVP collection mechanism; accepting Link Agent
Wallet is a future option with compatibility gates in section 17. No AgentCaller
wallet, subscription, meter service, queue service or carrier migration is needed.

### Confirmed review decisions

| Decision                    | Required behavior                                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP and OAuth at launch     | Remote MCP authentication, human account onboarding and agent-to-billing setup are MVP release requirements. An API-only release does not satisfy this plan.                                                                                         |
| Business answer is billable | Charge confirmed connected business-leg usage even if classification, callback or handoff fails. Human conversation or successful bridging is not a prerequisite. No answer means no connected usage; unknown answer/timing requires reconciliation. |
| Unpaid-exposure cap         | USD 10 (1,000 cents) per account, including unpaid consumed usage and active reservations across billing months. The user's monthly allowance is separate; its suggested $10 default is not a second credit facility.                                |
| Cancellation and revocation | Cancel pending jobs, stop active calls and retain charges for consumed usage. Reject an immediate limit decrease below consumed plus reserved usage; offer explicit cancellation or a later effective change.                                        |

Worst-case reservation size, retry defaults and the `connect_me`-only first
calling scope remain proposals. Missing answers to those review items do not
approve them. Implement supporting layers with paid admission disabled until
the remaining commercial and provider gates pass.

Success means one verified human connects an integration, approves a recurring
allowance and future variable charges, saves a card without paying, requests
several calls, sees correct usage, and pays one aggregate amount. Paid access
must remain disabled until collection, failure recovery, and provider limits
work. Saving a card alone does not make calling safe to enable.

This document defines the implementation scope. Findings below describe the
reviewed source and local package metadata; they do not establish deployed
configuration or live provider behavior. Use the implementation note for current
test results and remaining release checks.

## 2. Existing architecture: confirmed evidence

All local links identify inspected files. Proposed files are named separately
in section 12.

### Runtime and deployment

| Area          | Confirmed state and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace     | pnpm 10.16.1 and Turbo 2.10.4; root scripts run workspace build, typecheck, test, and formatting. [Root package](/home/gianpaj/github/gianpaj/agentcaller-io/package.json), [workspace configuration](/home/gianpaj/github/gianpaj/agentcaller-io/pnpm-workspace.yaml), [Turbo tasks](/home/gianpaj/github/gianpaj/agentcaller-io/turbo.json).                                                                                                                           |
| Node          | README requires Node 22+; worker Docker uses Node 22; `.tool-versions` selects 24.9.0; this session runs 24.15.0. These are distinct constraints, not one deployed version. [Version selection](/home/gianpaj/github/gianpaj/agentcaller-io/.tool-versions), [worker Dockerfile at reviewed commit](https://github.com/gianpaj/agentcaller-io/blob/5fae14602b407ce9325bb5688d28697d1cb234a5/apps/voice-agent/Dockerfile).                                                |
| Platform      | Next.js App Router 16.3.3, React 19.3.0, TypeScript 6.0.3, Zod 4.4.3, Drizzle 0.45.2, postgres.js 3.4.9. Installed Supabase JS is 2.110.1, SSR 0.12.0. [Platform package](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/package.json), [lockfile](/home/gianpaj/github/gianpaj/agentcaller-io/pnpm-lock.yaml).                                                                                                                                               |
| Voice worker  | LiveKit Agents 1.9.0, RTC Node 1.1.0, LiveKit server SDK 2.19.1. Worker build bundles workspace TypeScript into `dist/main.js`. [Worker package](/home/gianpaj/github/gianpaj/agentcaller-io/apps/voice-agent/package.json), [build script](/home/gianpaj/github/gianpaj/agentcaller-io/apps/voice-agent/build.mjs). The August note's missing-output finding is historical; the bundler exists in this checkout.                                                        |
| Database      | Active Drizzle schema and six append-only Supabase migrations. postgres.js uses one connection per process instance, no prepared statements. [Schema](/home/gianpaj/github/gianpaj/agentcaller-io/packages/database/src/schema.ts), [database factory](/home/gianpaj/github/gianpaj/agentcaller-io/packages/database/src/index.ts), [migration loader in DB tests](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/connect-me.integration.test.ts:82). |
| Deployment    | Platform targets Vercel; worker has a container build and LiveKit agent dispatch. No checked-in CI pipeline was found. Vercel config schedules only the outbound-webhook drain. [Vercel config](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/vercel.json), [LiveKit dispatch](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/livekit.ts).                                                                                                |
| Documentation | Fumadocs is a separate Next.js workspace. Root Vite app, root API/OpenAPI/client generation and root Drizzle configuration are legacy. [README](/home/gianpaj/github/gianpaj/agentcaller-io/README.md), [original design](/home/gianpaj/github/gianpaj/agentcaller-io/docs/specs/2026-07-10-agentcaller-mvp-design.md).                                                                                                                                                  |

### Identity, calls, and payment

| Surface              | Confirmed behavior and supporting code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API authentication   | `authenticateApiRequest()` validates `ac_` bearer keys against peppered SHA-256 hashes, key revocation and enabled profiles. It returns the profile but discards key identity. Keys have names, not scopes or billing grants. [auth.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/auth.ts:33), [apiKeys](/home/gianpaj/github/gianpaj/agentcaller-io/packages/database/src/schema.ts:60).                                                                                                                                                                                                                                                                       |
| Human identity       | Email/password and GitHub sign-in use Supabase. `loadClientProfile()` calls `auth.getUser()` and maps the verified UID to `client_profiles.supabase_user_id`. Profiles are manually linked; no complete signup/provisioning path exists. [Login actions](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/login/actions.ts), [portal identity](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/portal.ts:14).                                                                                                                                                                                                                                        |
| Login return         | Password login redirects to `/app`; auth callback allows only `/app` and `/reset-password`. Billing resume needs an explicit, constrained continuation. [auth-redirect.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/auth-redirect.ts), [callback](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/auth/callback/route.ts).                                                                                                                                                                                                                                                                                                                   |
| Public API           | `POST/GET /api/v1/calls`, detail/delete, cancel, transcript and recording routes. All client call lookups use tenant identity. No quote, billing, MCP or OAuth-resource-server endpoint exists. [Call routes](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/v1/calls/route.ts), [detail/delete](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/v1/calls/[id]/route.ts).                                                                                                                                                                                                                                                                  |
| Admission            | `submitCall()` validates task/destination/voice, key, throttles and rate card, then writes the call and funding evidence before dispatch. Unique `(client_id,idempotency_key)` handles duplicate creation. Only connect admission rechecks throttle/concurrency under a client row lock. Reusing a key with a changed body is not fingerprint-checked. [submitCall](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/submit-call.ts:47).                                                                                                                                                                                                                               |
| Tasks                | Shared Zod contracts cover reservation, appointment, availability, information and `connect_me`. Generic calls allow ES/US and en/es; connect adds Italian business calls, Spanish mobile callback, es/it business language and en/es/it callback language. `maxAmountUsd` is a JavaScript number; duration is 60–1,800 seconds. [Contracts](/home/gianpaj/github/gianpaj/agentcaller-io/packages/contracts/src/index.ts:67), [connect task](/home/gianpaj/github/gianpaj/agentcaller-io/packages/contracts/src/connect-me.ts:15).                                                                                                                                                      |
| Scheduling           | `connect_jobs.next_attempt_at`, calling windows, seven-day expiry and up to six attempts exist. There is no exact requested call-start field or general `schedule_call` API. Appointment task time windows describe the appointment, not the dial time. [claimConnectAttempt](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/connect-me.ts:327), [connect scheduling functions](/home/gianpaj/github/gianpaj/agentcaller-io/packages/contracts/src/connect-me.ts:109).                                                                                                                                                                                               |
| x402                 | A hand-written CDP HTTP adapter builds x402 v2 `batch-settlement` requirements on Base mainnet with USDC identifiers, verifies a header payload and settles a changed amount. No x402 SDK dependency exists. This mismatch is a documented release blocker, not confirmed working variable capture. [payment.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/payment.ts), [architecture review](/home/gianpaj/github/gianpaj/agentcaller-io/.agents/notes/2026-08-18-architecture-review.md).                                                                                                                                                                     |
| Paid connect         | `connectPaymentBlocker()` rejects paid connect admission. Scheduler, dispatch and worker lifecycle permission routes each independently require operator authorization. Allowing Stripe in admission alone would leave dispatch blocked. [connect-policy.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/connect-policy.ts:23), [scheduler](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/connect-scheduler.ts:57), [dispatch](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/livekit.ts), [connect callback](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/internal/calls/[id]/connect/route.ts). |
| Operator funding     | Enabled server-managed operator role, deployment flag, connect-only scope and per-job cap; `fundingSource=operator`, `paymentState=not_required`. No customer settlement row. [operator-funding.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/operator-funding.ts), [operator funding migration](/home/gianpaj/github/gianpaj/agentcaller-io/supabase/migrations/20260918200100_operator_funding.sql).                                                                                                                                                                                                                                                          |
| Prices               | Country rate cards contain connection and started-minute fees in micros, plus a version. Generic settlement charges connection plus at least one started minute, capped by `maxAmountMicros`. No seeded commercial price, tax policy or explicit currency column was found. Dollar naming and x402 USDC exist; they do not prove a deployed USD card tariff. [rateCards](/home/gianpaj/github/gianpaj/agentcaller-io/packages/database/src/schema.ts:72), [chargeableMicros](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/settlement.ts:11).                                                                                                                       |
| Generic settlement   | Conditional `authorized→settling` ownership and unique per-call settlement constrain duplicates. A crash after claiming, or after carrier settlement before DB update, lacks durable reconciliation. Missing duration bills a minimum; cancel uses time since creation. [settlement.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/settlement.ts:33), [cancel route](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/v1/calls/[id]/cancel/route.ts).                                                                                                                                                                                       |
| Connect cost records | Job snapshots both rates; each attempt consumes a cumulative worst-case reserve. Legs record observed connected/end times, SIP ID and nullable `measuredMicros`. Job reserves are deliberately not refunded between attempts. They are per-job safety accounting, not monthly usage or collected payment. [connectCommand](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/connect-me.ts:62), [connect ledger schema](/home/gianpaj/github/gianpaj/agentcaller-io/packages/database/src/schema.ts:224).                                                                                                                                                               |
| Connect lifecycle    | Call row locks serialize scheduler, worker, cancellation; worker claim/event receipts prevent replay; unknown dial outcomes never permit automatic redial. Only confirmed pre-answer busy/no-answer can retry. [connect-me.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/connect-me.ts), [DB concurrency tests](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/connect-me.integration.test.ts).                                                                                                                                                                                                                                              |
| Telephony            | Voice worker originates LiveKit SIP legs through provisioned Telnyx trunks. Both worker paths wait for answer; connect uses separate rooms, AMD/conversation classification, private callback DTMF and participant movement. No direct Telnyx SDK integration exists. [main.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/voice-agent/src/main.ts), [connect-livekit.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/voice-agent/src/connect-livekit.ts), [runConnectFlow](/home/gianpaj/github/gianpaj/agentcaller-io/apps/voice-agent/src/connect-flow.ts).                                                                                                               |
| Timing limits        | Worker passes `ringingTimeout` and `maxCallDuration` to LiveKit SIP and performs room cleanup. Country-level quotes, observed local timestamps and those SDK options do not prove a Telnyx invoice ceiling. [Dispatch guide](/home/gianpaj/github/gianpaj/agentcaller-io/apps/docs/content/docs/dispatch.mdx).                                                                                                                                                                                                                                                                                                                                                                          |
| Call results         | Generic worker reports `{reason: call_ended}` and a transcript, not a validated task result. Connect results distinguish reasons and operator/unsettled cost status. Generic task completion is a separate launch dependency if enabled. [main.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/voice-agent/src/main.ts), [terminal](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/connect-me.ts:27).                                                                                                                                                                                                                                                           |
| Background work      | PostgreSQL polling, leases, row locks and `SKIP LOCKED`; no external queue. Connect drain requires externally scheduled POST, documented every 30 seconds. Outbound webhook delivery has bounded exponential retries and signed raw payloads. [connect drain](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/internal/connect/drain/route.ts), [webhooks.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/webhooks.ts).                                                                                                                                                                                                                     |
| Cron mismatch        | Checked-in Vercel cron targets a handler exporting only POST. Vercel invokes cron paths using GET. This must be corrected when deploying billing drains; adding another POST-only Vercel target will not work. [Current handler](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/internal/webhooks/drain/route.ts), [Vercel cron contract](https://vercel.com/docs/cron-jobs).                                                                                                                                                                                                                                                                                    |
| UI                   | Mobile call history, connect submission, detail/cancel and settings exist. Submission is operator-only. Settings edit webhook/throttle; no billing or card management. [App layout](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/app/layout.tsx), [startCall](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/app/calls/new/actions.ts), [settings](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/app/settings/page.tsx).                                                                                                                                                                                                    |
| Privacy              | R2 retrieval/delete paths exist; recording creation, deterministic retention and cross-provider deletion remain incomplete. Generic delete physically removes calls and detaches x402 receipts; connect delete is blocked. Stripe financial records need independent retention. [Delete route](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/v1/calls/[id]/route.ts), [retention docs](/home/gianpaj/github/gianpaj/agentcaller-io/apps/docs/content/docs/retention.mdx).                                                                                                                                                                                       |
| Stripe/MCP           | No installed Stripe or MCP SDK, routes, schemas, authorization server integration or saved-card resources. Checked workspace packages, lockfile and application source. Supabase GitHub login is OAuth sign-in to AgentCaller, not delegation of AgentCaller tools to external agents.                                                                                                                                                                                                                                                                                                                                                                                                  |

Relevant tests already present:

- [settlement.test.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/settlement.test.ts)
  fixes the current generic minimum-charge and elapsed-time behavior in tests.
- [connect-admission.test.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/connect-admission.test.ts)
  checks paid-connect rejection and operator privilege boundaries.
- [operator-funding.test.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/operator-funding.test.ts)
  checks default-off funding and prevents accidental operator settlement.
- [connect-me.integration.test.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/connect-me.integration.test.ts)
  tests real PostgreSQL locks, concurrent ticks/submissions, duplicate workers,
  tenant isolation, cancellation races, unknown usage and lost dispatch.
- [connect-flow.test.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/voice-agent/src/connect-flow.test.ts)
  and [connect-livekit.test.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/voice-agent/src/connect-livekit.test.ts)
  mock providers, timers, DTMF, movement, cancellation and refusal.
- [test-connect-db.mjs](/home/gianpaj/github/gianpaj/agentcaller-io/scripts/test-connect-db.mjs)
  starts disposable local PostgreSQL 17. Ordinary Vitest runs skip that suite
  without `CONNECT_TEST_DATABASE_URL`.
- [auth-redirect.test.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/auth-redirect.test.ts),
  [env.test.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/env.test.ts)
  and [webhook-url.test.ts](/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/webhook-url.test.ts)
  supply patterns for redirect, lazy configuration and SSRF checks.

The [August review](/home/gianpaj/github/gianpaj/agentcaller-io/.agents/notes/2026-08-18-architecture-review.md)
and [connect decision record](/home/gianpaj/github/gianpaj/agentcaller-io/.agents/notes/implemented/telephony/2026-09-18-bounded-connect-me.md)
were read alongside current code. Their historical test counts and deployment
claims are not verification results for this investigation.

## 3. Decisions and tradeoffs

| Choice                          | Recommendation                                                                        | Reason and alternative                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout setup vs Elements      | Hosted Checkout setup for enrollment and card replacement                             | Stripe hosts enrollment and any setup SCA. Hosted invoice pages handle collection-time payment and SCA recovery. No custom Elements/Stripe.js payment form is needed for this MVP.                                                                                                                                                                                                                          |
| Payments vs Billing             | AgentCaller usage and allowance records plus Stripe Invoicing                         | One-off invoices can collect monthly usage without a subscription. Stripe owns invoice/payment lifecycle, configured retries, customer payment emails and hosted recovery. AgentCaller owns pre-dial authorization, period close, idempotent invoice issuance and reconciliation. Raw PaymentIntents would require extra collection machinery; metered subscriptions add no needed capability for this MVP. |
| Monthly vs per-call collection  | Monthly, with low credit exposure                                                     | Avoid repeated fixed transaction costs for small calls. Postpaid creates merchant credit risk. Optional threshold collection is a later explicitly consented policy, not a top-up.                                                                                                                                                                                                                          |
| Account vs agent budget         | One account ceiling shared by all integrations, plus per-integration grants           | Several agents must not each acquire a separate copy of the human's allowance. Per-agent monthly/per-call sublimits can only narrow the account cap.                                                                                                                                                                                                                                                        |
| MCP vs ordinary integration     | OAuth-authenticated remote MCP and full billing onboarding in the MVP                 | Implement in the existing platform and share billing/call functions with REST. The customer connects through OAuth without copying API keys. OAuth identity, billing consent and resumed-call acceptance must pass one complete launch test; API compatibility is preserved.                                                                                                                                |
| URL elicitation vs returned URL | Return a setup URL everywhere; add negotiated native elicitation                      | Durable setup/status makes manual retry work when a host cannot pause/resume. Never interpret client acceptance as successful payment setup.                                                                                                                                                                                                                                                                |
| Future scheduling               | Reserve the planned first-start month's budget at acceptance                          | Gives a meaningful acceptance guarantee. Recheck authorization before dialing. Do not accept an unreserved task and hope budget exists later. Restrict automatic retries to that month in the MVP.                                                                                                                                                                                                          |
| Monetary precision              | Keep pinned rates in integer USD micros; finalize one logical call into integer cents | Reuse existing rates without float calculations. Round the sum of all billable legs/attempts once, upward to a cent, with this tariff rule disclosed. Quote uses the same rounding. A published cents-only tariff is a simpler future option.                                                                                                                                                               |
| Funding integration             | Explicit switch over `x402`, `stripe_postpaid`, `operator`                            | Reuse execution, not payment semantics. Do not create fabricated x402 receipts or make operator permissions stand in for customer consent.                                                                                                                                                                                                                                                                  |

Stripe Invoicing supports one-off invoices with automatic saved-card collection;
creating one each month does not require a Stripe subscription. AgentCaller
calculates the month's usage, creates its invoice, and lets Stripe collect it.
The additional fee buys less payment code and a hosted invoice/recovery flow.
[Invoicing integration](https://docs.stripe.com/invoicing/integration).

Stripe lists Invoicing Starter at 0.4% per paid invoice and Plus at 0.5%, before
payment processing and other applicable fees. That is $0.04 or $0.05 on a $10
invoice. Confirm the merchant's pricing and the tier that includes the chosen
retry/recovery features; do not assume Starter includes every Plus feature.
[Invoicing pricing](https://support.stripe.com/questions/stripe-invoicing-pricing).

A metered Billing subscription could automate recurring usage billing, but adds
subscription/meter mapping without replacing the synchronous allowance check.
For this MVP, keep the local usage totals and use one-off Invoicing; no Stripe
subscription, meter feed or custom payment-retry engine is needed.
[Stripe usage-based billing](https://docs.stripe.com/billing/subscriptions/usage-based).

## 4. Proposed account and integration authority

Use `client_profiles.id` as the paying account boundary. Its linked Supabase UID
is the human owner for this MVP; do not add organization membership or joint
accounts. The first OAuth consent must support a verified human with no existing
AgentCaller profile. Create/reuse a profile using only the verified Supabase UID
under the existing unique constraint. Never claim an existing API-only x402
account by email, GitHub name, a URL or client-submitted account ID. Linking such
an existing account still requires independent ownership verification.

Use existing Supabase human authentication, including a first-time sign-in path
through an enabled provider, and a constrained continuation to OAuth consent.
A verified first-time session can create its own profile with server-controlled
defaults, `is_operator=false` and no spending grant. Do not recreate or enable a
suspended profile during onboarding. A pilot allowlist can restrict eligible
users/hosts, but an eligible new user must complete OAuth and billing without
manual profile/key provisioning. General organization/admin onboarding is out
of scope.

Introduce an authenticated principal containing `clientId`, `connectionId`,
credential kind and allowed operations. Keep `authenticateApiRequest()` as a
compatibility wrapper for untouched REST routes; add `authenticateApiPrincipal()`
for API-key clients and resolve the same principal shape from verified OAuth
credentials in MCP. Spending authority is never inferred from a login, OAuth
token or old unscoped API key.

During OAuth consent, resolve the authorization request through the issuer's
supported API, show the verified integration identity and requested tool access,
and persist the human's approval bound to the issuer/subject/client tuple.
After token validation, resolve that approved connection; never let a model's
claimed agent/user ID create or select it. Existing API keys retain their mode
and can gain Stripe access only through explicit human linking/consent. They
are a compatibility path, not the required MCP onboarding mechanism.

For the MVP remote MCP service, use OAuth authorization code with PKCE and
Supabase Auth's OAuth server if the project supports the required resource/audience
binding. Its access tokens must resolve both the verified human subject and
OAuth client identity. Store permissions and connection revocation in
AgentCaller; OAuth tool access alone cannot authorize expenditure.
Supabase documents an OAuth 2.1 server and MCP integration, but neither is wired
into this repository or confirmed enabled in the project.
[Supabase OAuth server](https://supabase.com/docs/guides/auth/oauth-server),
[Supabase MCP integration](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication).

Require issuer, signature, expiry, MCP resource audience and connection checks.
Publish protected-resource metadata and appropriate `WWW-Authenticate`
discovery. Use exact registered redirect URIs, state, PKCE, refresh-token
rotation/revocation and a human connection-consent screen. Do not accept a
generic Supabase browser JWT or a third-party host token as an MCP token merely
because its signature is valid. If Supabase cannot issue the correct audience,
the MVP remains unreleased until a conforming issuer configuration is proven.
Do not weaken validation or substitute an API-only launch. Prefer a supported
existing issuer/configuration over building a new authorization server.
[MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

Use application permissions `calls:read`, `calls:create`, `billing:setup`,
`billing:read`; limit/card/grant changes require the human session. These are
AgentCaller permissions; do not assume Supabase supports arbitrary OAuth
scopes. Bind `(issuer, subject, oauth_client_id)` to a connection. Several
agents behind one OAuth client are one integration unless the issuer supplies
another trustworthy identity. Agent names supplied by a model are display data.

## 5. End-to-end setup and Stripe API details

### Verified API baseline

There is no installed Stripe version to preserve. As checked on 2026-10-18,
Stripe Node's stable release is 23.0.0, using API `2026-09-30.endive`.
Use that exact stable pair as the implementation baseline, recheck before
installing, and pin request and webhook versions together. Avoid preview APIs.
[Stripe Node release](https://github.com/stripe/stripe-node/releases/tag/v23.0.0),
[API version source](https://github.com/stripe/stripe-node/blob/v23.0.0/src/apiVersion.ts).

Checkout accepts `mode: setup`, an existing Customer, currency, metadata and
success/cancel URLs. It creates a SetupIntent and can attach the saved method
to that Customer. SetupIntent usage defaults to `off_session`.
[Hosted setup guide](https://docs.stripe.com/payments/checkout/save-and-reuse?payment-ui=stripe-hosted),
[SetupIntent API](https://docs.stripe.com/api/setup_intents/create).

Do not pass `setup_intent_data.usage`: the checked 23.0.0 type exposes only
description, metadata and on-behalf-of there. Do not use
`payment_intent_data.setup_future_usage` in setup mode. Rely on the documented
SetupIntent default and verify the resulting intent's usage during activation.
[Checkout SDK parameter definitions](https://github.com/stripe/stripe-node/blob/v23.0.0/src/resources/Checkout/Sessions.ts),
[Checkout create API](https://docs.stripe.com/api/checkout/sessions/create).

### OAuth entry and billing sequence

```mermaid
sequenceDiagram
    participant A as Agent / MCP host
    participant P as AgentCaller platform
    participant O as OAuth issuer
    participant D as PostgreSQL
    participant H as Human browser
    participant S as Stripe
    A->>P: Connect to remote MCP
    P-->>A: 401 + protected-resource discovery
    A->>O: Start authorization code flow with PKCE
    O-->>H: AgentCaller sign-in and OAuth consent
    H->>P: Authenticate; approve this integration's tool access
    P->>D: Create/reuse own profile; persist connection consent
    P->>O: Approve validated issuer authorization request
    O-->>A: Authorization code through registered redirect
    A->>O: Exchange code using PKCE and resource binding
    O-->>A: Scoped access token
    A->>P: schedule_call with stable idempotency key
    P->>D: Verify principal, connection and billing authorization
    P-->>A: billing_setup_required + AgentCaller URL
    Note over A,H: Native URL elicitation when supported; ordinary URL fallback otherwise
    H->>P: Open setup; verify same human and connection
    H->>P: Approve limits and future-charge agreement
    P->>D: Persist billing consent and setup operation
    P->>S: Reuse/create Customer; create setup Checkout
    P-->>H: Redirect to hosted card setup
    H->>S: Save card; complete any setup SCA
    S->>P: Signed setup webhook
    P->>D: Persist verified event
    P->>S: Retrieve Session, SetupIntent and PaymentMethod
    P->>D: Verify ownership; activate matching spending grant
    A->>P: get_billing_status
    P-->>A: ready + allowance and usage
    A->>P: Retry unchanged schedule_call with original key
    P->>D: Commit call, budget reservation and scheduled job
    P-->>A: Accepted call ID
```

The host retains the original call intent and idempotency key across OAuth and
billing setup. An unauthenticated request receives an OAuth challenge, not a
billing setup link. OAuth access consent and billing/spending consent are
separate records even if their browser steps reuse the same signed-in session.
An OAuth denial, abandoned setup or card failure must never schedule a paid call.

Preserve only allowlisted OAuth/billing continuation destinations and opaque
server-validated request references through login. Validate issuer authorization
details and exact registered client redirect before approval. Do not route OAuth
access authorization through MCP URL elicitation; elicitation is for the billing
step after the MCP principal is authenticated.

A user can close the host/browser and resume using token refresh or a new OAuth
session, durable setup status and the original key. Expired tokens trigger OAuth
reauthorization, not a new spending grant. A changed/revoked connection cannot
reuse another connection's setup even when the human account is the same.

1. Authenticate the agent before creating any setup request. A request for a
   Stripe-funded call with no grant returns HTTP 409 and a structured
   `billing_setup_required` body. It creates no call or budget reservation.
   x402 requests keep their existing 402 challenge. Authentication failures
   return 401, not a billing link.
2. Create/reuse a pending request bound to account, verified human UID,
   connection and requested agreement version. Derive a 32-byte opaque token
   with HMAC-SHA256 under a dedicated setup-token secret, binding request UUID,
   generation and expiry; store only its digest. This makes the same pending
   link reproducible after a lost API response without storing its plaintext.
   Rate-limit creation. A link locates a request and has no authentication
   authority. Default enrollment link lifetime: 24 hours. Key rotation can
   invalidate pending links; issue a fresh generation after reauthentication.
3. The URL is `https://agentcaller.io/billing/connect?request=<opaque-token>`.
   On entry use `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, no
   analytics or third-party assets, and strip the token from the address after
   exchanging it for a restricted HttpOnly/Secure/SameSite continuation cookie.
   The cookie can resume this setup only. Redact query tokens from access logs.
4. Require a verified Supabase session and exact owner match before displaying
   account/integration detail or creating Checkout. Wrong user: deny with no
   enrollment side effects. Ask them to sign in to the correct account. A GET,
   email scanner, or stolen link cannot approve limits, switch owner or add a
   method. The setup request cannot rebind its account.
5. Show account identity, connection name/verified publisher where available,
   tariffs, taxes/rounding, recurring monthly ceiling, optional narrower
   per-call ceiling, billing calendar, no upfront collection, revocation rules,
   and treatment of consumed usage. Record an unchecked explicit consent action
   with human UID, time, exact agreement/pricing version and approved limits.
6. Under a short database transaction, mark the consented request as creating
   Checkout and persist its operation ID. Create the Customer outside the
   transaction with a stable idempotency key based on billing account ID.
   Persist the mapping with unique constraints. Retry/reconcile interrupted
   Customer creation rather than creating a different customer each time.
7. Create Checkout server-side with `mode: "setup"`, `customer`,
   `currency: "usd"`, card-only methods, `client_reference_id` pointing to the
   setup request and internal IDs in both Session and SetupIntent metadata.
   Use the pinned SDK's supported card restriction parameter. The checked API
   supports `payment_method_types: ["card"]`; do not allow delayed bank debit
   methods in this MVP. Use a fixed success URL under `/billing/connect/return`
   and cancel URL under `/billing/connect`. No line items or charge amount.
   The returned Stripe URL goes only to the authenticated browser.
8. Use a 30-minute Checkout lifetime, within Stripe's supported Session
   expiration range. A request can get a fresh Checkout generation while valid;
   a superseded Session cannot activate billing. Persist Session ID and
   generation before redirecting. Webhook handling must tolerate the webhook
   arriving before that local write by reconciling the persisted operation and
   server-written metadata.
9. Receive `checkout.session.completed`; also process setup failure/cancellation
   and expiry events for status. Verify the raw request body with
   `stripe.webhooks.constructEvent`, signature header and endpoint secret.
   Durably insert a minimal event receipt before returning 2xx; return 5xx if
   the insert fails. Reject invalid signatures with 400. Queue work in the
   database; processing retries independently of HTTP delivery.
10. Retrieve the authoritative Session, expanded SetupIntent and PaymentMethod
    using server credentials. Require stored Session/generation, mode/setup
    completion, succeeded SetupIntent, off-session usage, exact Customer,
    attached card ownership, expected livemode/environment, account/connection
    binding, and valid consent. Store only IDs, brand/last4/expiry for the human
    UI. `payment_method.attached` alone is insufficient.
11. Lock account, connection and grant. Compare account card-generation and
    grant-generation so concurrent setup by two integrations cannot let an
    older webhook overwrite a later card choice. Activate only if still pending and not
    revoked/expired/superseded; increment the authorization version atomically.
    A late successful setup never clears an account's unpaid/dispute block.
    Replacement keeps the existing method usable until the new one is verified;
    changing a card never silently grants spending to another connection.
    Invoice creation must explicitly select this verified saved card through
    `default_payment_method`; Checkout attachment alone does not select an
    invoice default. The application need not maintain a separate Customer-default
    synchronization workflow. On card replacement, update existing unpaid invoice
    method overrides and verify the change, without initiating payment in app code.
    Stripe's configured recovery flow owns subsequent collection.
    The browser return displays pending/ready based on server state; it cannot
    activate a grant. A missing webhook is recovered through verified event
    reconciliation, never a browser assertion.
12. Agent polls setup/status and retries the original operation using its same
    idempotency key and unchanged parameters. Success does not depend on keeping
    an MCP request, browser tab, SSE stream or Vercel process alive.

Stripe requires consent for the intended future use, including timing and how
variable amounts are determined, and retention of the agreement. Setup may
authenticate a card but cannot guarantee that every later charge succeeds.
[Stripe saved-payment compliance guidance](https://docs.stripe.com/payments/save-and-reuse?payment-ui=elements).

Stripe webhook delivery can duplicate and reorder events. Deduplicate event
IDs, retrieve current objects when needed, and apply guarded transitions.
Keep signature verification's timestamp tolerance; do not disable it to replay
an old signed body. [Stripe webhooks](https://docs.stripe.com/webhooks).

## 6. API and MCP contracts

Add shared schemas before producers/consumers. Use camelCase for AgentCaller
JSON, consistent with existing calls; Stripe API fields remain snake_case.

| Endpoint                          | Authentication and behavior                                                                                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/billing/setup`      | Agent principal, `billing:setup`, idempotency key. Create/reuse own pending request; proposed limits are suggestions only. Return status, setup request ID, expiry and AgentCaller URL.                                                       |
| `GET /api/v1/billing/setup/{id}`  | Same tenant/connection. Return pending, consented, processing, ready, expired, revoked or failed, with safe reason codes. Never return tokens/card details.                                                                                   |
| `GET /api/v1/billing/status`      | `billing:read`. Own grant plus account/current-period usage and account block reason. Optional explicit future period for a quote.                                                                                                            |
| `GET /api/v1/billing/usage`       | `billing:read`. Cursor/period-scoped call summaries; no other integration's detailed task or destination data by default. Human portal can view account-wide usage.                                                                           |
| `POST /api/v1/calls/quote`        | `calls:create`; validate task/destination/schedule, return tariff version, computed maximum cents, proposed billing period and quote expiry. This does not reserve or dial.                                                                   |
| `POST /api/v1/calls`              | Existing endpoint. Extend funding header to explicit `stripe_postpaid`; use `maxAmountCents` for this mode and add optional `scheduledFor` for connect. Existing omitted header/x402 and explicit operator behavior remain.                   |
| Existing detail/cancel            | Same tenant plus connection permissions; tenant-wide existing API keys retain their historical scope. Return funding and usage status separately from collection status. Cancellation never implies a refund.                                 |
| `POST /api/stripe/webhook`        | Stripe signature, Node runtime, raw body. No cookie/API-key/cron authentication and no public Stripe IDs in response.                                                                                                                         |
| `GET /api/internal/billing/drain` | Cron bearer secret; bounded, leased batches for event processing, finalization, closing, invoice issuance and reconciliation. Stripe schedules payment retries. Optional authenticated POST delegates to the same function for operator runs. |

The funding mode is included in the idempotency fingerprint. Reject simultaneous
`PAYMENT-SIGNATURE` and `stripe_postpaid` selection rather than guessing.
No automatic fallback between billing methods. The fingerprint includes canonical
validated task, destination, limits, schedule and tariff acceptance. A reused key
with changed inputs returns 409 for new Stripe calls. Preserve legacy responses
for existing x402 calls during compatibility rollout.

Example readiness response, with all monetary values in integer cents:

```json
{
  "data": {
    "status": "ready",
    "currency": "USD",
    "periodStartsAt": "2026-10-01T00:00:00Z",
    "periodEndsAt": "2026-11-01T00:00:00Z",
    "monthlyLimitCents": 1000,
    "spentCents": 120,
    "reservedCents": 200,
    "availableCents": 680,
    "perCallLimitCents": 100,
    "unpaidCents": 120,
    "collectedCents": 0
  }
}
```

`unpaidCents` can include an open period and is not automatically delinquent.
Also return separate overdue/failed amounts and server exposure headroom.
Effective available allowance is the minimum of account month, integration
month and merchant credit headroom. Expose each limiting reason; do not label
it a balance. Grant revocation, invoice payment/action required, budget exhaustion
and disabled calling are distinct statuses. Agents receive an AgentCaller billing
page URL; only the authenticated human sees private hosted invoice/PDF links.

MCP tools: `setup_billing`, `get_billing_status`, `quote_call`, `schedule_call`,
`get_call_status`, `get_usage`. `schedule_call` maps to the existing calls
application function with `scheduledFor`; it does not invent another job ledger.
It initially accepts `connect_me` only. Immediate generic task execution stays
behind its own validated-product gate.

### Current MCP compatibility

The official latest specification resolves to **2026-07-28** as of this review.
It uses per-request capabilities and `InputRequiredResult` multi-round-trip
elicitation. For URL mode, request an AgentCaller URL; on retry, recheck durable
billing state. A client's `action: accept` is permission to follow the URL, not
evidence of completed setup. [Current specification](https://modelcontextprotocol.io/specification/latest),
[2026 elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation).

For **2025-11-25** clients, inspect initialized `elicitation.url`, then use
`elicitation/create` with `mode: url`, `message`, `url`, `elicitationId`.
`-32042` URL-elicitation-required and optional completion notifications are
2025 mechanisms. Completion goes only to the initiating client. Do not send
these wire shapes to a 2026 client. An empty elicitation capability means
form-only, not URL support. [2025 elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation).

The TypeScript SDK's checked stable releases include 2.3.1 with separate
server/core and legacy-server packages; v1.32.1 is also published. Prefer the
v2 server with its documented compatibility adapter after a target-host probe;
do not copy a v1 `@modelcontextprotocol/sdk` example into v2. Pin the actual
server/transport package pair after checking exports and Next.js compatibility.
[SDK releases](https://github.com/modelcontextprotocol/typescript-sdk/releases),
[SDK elicitation examples](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/examples/elicitation/README.md).

Use a stateless HTTP route and durable database state. No cross-instance session
map. Native completion notification is optional; polling/manual retry is required.
Without URL elicitation, return the structured setup-required tool result and
ordinary link. Decline/cancel creates no paid call. Model/tool annotations never
grant spending authority. No assumption is made about ChatGPT Dot, Muse, Grok
Bot or another host supporting either protocol or autonomous actions.

## 7. Proposed data model and migrations

Use nine focused tables. Combining reservation and finalized call usage in one
row avoids a separate reservations table; the account stores its one active card
reference, avoiding a payment-method catalog. Existing attempts/legs remain the
telephony measurement ledger. Existing x402 settlements remain x402 settlements.

All tables get RLS with server-only access through the platform, timestamps,
tenant-scoped queries and explicit checked states. Use UUID internal IDs,
`timestamptz` instants, `date`/UTC month keys, integer cents, and bigint micros
for new rate calculations. Serialize bigint as decimal strings if exposed;
never convert unchecked bigint to Number. Limit API integers to safe bounds.
Positive/nonnegative checks belong in SQL as well as Zod.

### New tables

| Table                    | Fields and relationships                                                                                                                                                                                                                                                                                                                             | Constraints, indexes and state                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billing_accounts`       | `id`, unique `client_id→client_profiles`, `stripe_customer_id`, `livemode`, `currency='USD'`, `timezone='UTC'`, monthly/per-call limit cents, server-managed `credit_limit_cents`, active PaymentMethod/SetupIntent IDs, brand/last4/expiry, billing email, owner consent version/time, status/block reason, revoked time, collection-consent status | Unique Customer ID within environment; unique `(id,client_id)` for composite ownership FKs. States `pending_setup/active/past_due/suspended/revoked`. Partial index on accounts requiring recovery. Lock this row first for any budget/collection mutation. Card replacement increments a generation; it does not erase debt.                                                                                                             |
| `agent_connections`      | `id`, `client_id`, display name, credential kind, verified issuer/subject/OAuth client ID, allowed operations, OAuth consent version/time/approving Supabase UID and revoked time                                                                                                                                                                    | Unique verified OAuth tuple per tenant; unique `(id,client_id)`. States `pending/active/revoked`; require owner consent before active OAuth access. Account+status index. Token refresh resolves the existing connection and cannot reactivate it. API keys can reference this connection for explicitly linked legacy access.                                                                                                            |
| `billing_authorizations` | `id`, `billing_account_id`, `client_id`, `connection_id`, approved monthly/per-call cents, agreement/pricing versions, consenting Supabase UID/time, version, effective time, expiry/revocation times                                                                                                                                                | Unique account+connection; composite FKs enforce same tenant; states `pending/active/revoked/expired`. Nonnegative limits; account+status index. Audit immutable consent/version snapshots before updating limits. Restoring access requires human action, not a successful old webhook.                                                                                                                                                  |
| `billing_setup_requests` | `id`, account/client/connection/grant IDs, expected human UID, token digest, expiry, consent snapshot, generation, Stripe create-operation key, Session/SetupIntent IDs, completion/revocation times                                                                                                                                                 | Unique token digest and nullable Session ID; one nonterminal setup generation per connection/purpose; account+created and pending+expiry indexes. States `pending/consented/creating_checkout/processing/ready/failed/expired/revoked`. Persist operation before Stripe calls. Only matching current generation can activate. Support purpose `enroll/replace_card`.                                                                      |
| `billing_periods`        | `id`, account/client IDs, UTC `[starts_at,ends_at)`, approved account-cap snapshot, exact gross usage/reserved counters cents, close/collection times and final total                                                                                                                                                                                | Unique account+start; end/start checks; close-state+end index. States `open/closing/closed`. Future rows can reserve budget before the month begins. Counters reconcile to call rows; do not reset rows on payment. Stripe invoices own collection status; the local invoice row mirrors it.                                                                                                                                              |
| `billing_call_usage`     | `id`, account/client/grant/connection/period IDs, nullable call FK, immutable internal call reference, credential and grant versions, request fingerprint, pinned pricing/currency, reserve cents, final cents, usage evidence summary, state, terminal/cleanup/finalized times, reconciliation lease                                                | Unique immutable call reference and unique nonnull call ID; composite ownership FKs; indexes period+state, grant+period, reconciliation-due. States `reserved/metering_pending/finalized/released`. SQL enforces nonnegative final amount no greater than reservation. Zero verified usage is an explicit finalized row, not missing evidence. Keep financial row if call content is deleted.                                             |
| `billing_invoices`       | `id`, account/client/period IDs, immutable expected amount/currency, Stripe Invoice ID and aggregate InvoiceItem ID, issuance operation keys, issuance lease/error, mirrored invoice status, total/amount paid/amount remaining, credit-note/refund/dispute references and last reconciliation time                                                  | Unique period, unique Stripe Invoice ID and issuance keys; index issuance state/lease and invoice status/reconciled time. Local issuance states `pending/creating/ready/unknown` cover only creating/finalizing the invoice. Mirror Stripe `draft/open/paid/uncollectible/void` and a safe action-required flag; no local payment-attempt or dunning schedule. One account/month maps to one invoice, whose payment attempts Stripe owns. |
| `stripe_events`          | Environment+Stripe event ID, type, object ID, API version, received/processed time, processing status, retry time/lease, bounded safe error code                                                                                                                                                                                                     | Primary/unique environment+event ID; pending+retry index. Store the verified routing fields, not raw payment payloads. States `pending/processing/processed/failed`. Object retrieval plus guarded writes deduplicate distinct events about the same state.                                                                                                                                                                               |
| `billing_audit_events`   | UUID, account/client IDs, optional connection/grant/usage/invoice IDs, actor type/ID, operation kind, unique operation key, bounded version/limit/amount delta metadata and Stripe CreditNote/Refund/Dispute IDs                                                                                                                                     | Immutable facts and unique provider monetary-effect keys. Account+time and invoice+time indexes. Record separate OAuth access and billing consent, limit changes, revocation, invoice issuance, approved credits and Stripe financial outcomes. No payment-attempt queue, transcripts, destinations, PAN or client secrets.                                                                                                               |

`billing_invoices` does not replace the unique per-call x402 settlement.
For Stripe, each call has one finalized usage assessment; multiple such calls
belong to one monthly invoice. The local invoice row maps and reconciles the
Stripe object; it does not implement its payment state machine. No call belongs to two funding sources.
No nullable FK alone protects historical identity: keep an immutable financial
call reference even after content deletion.

Use text for Stripe IDs, digests, versions and checked-state values; UUID for
internal references; integer for cents, generations, expiry month/year and retry
counters; boolean for livemode; JSONB only for bounded snapshots/permissions.
Customer/card IDs remain nullable until setup succeeds. Include an integer
`card_generation` on the account and its snapshot on setup requests. All referenced
tenant-owned targets need unique `(id,client_id)` keys for their composite FKs,
including existing calls. Same-account relationships must be enforced as well as
same-tenant relationships. Finalized usage amounts and consent facts are immutable;
financial corrections append separate records rather than rewriting their source.
For refunds/disputes, distinguish lifecycle observation facts from financial
effects: observations use distinct event/phase keys; each provider adjustment
can produce a given monetary effect only once. A pending-refund event must not
consume the unique key intended for its later successful financial effect.

### Existing models to change

- `api_keys`: nullable `connection_id`, composite FK `(connection_id,client_id)`;
  index on connection for revocation. Existing rows remain null/unscoped and
  cannot incur Stripe charges until explicitly linked.
- `calls`: add `stripe_billing_account_id`, `billing_authorization_id`,
  nullable request fingerprint, optional `scheduled_for`; funding constraint
  permits `stripe_postpaid` with same-tenant account/grant and nonnull references.
  x402 branch requires Stripe references null; operator branch keeps its exact
  current role/task/payment invariants. Index account+created where Stripe.
- `payment_state`: add `accruing`, `accrued`. Stripe starts `accruing` and becomes
  `accrued` when final usage is known, including zero. Collection is exposed from
  its monthly invoice, not by relabeling every call after a charge. Existing
  enum values and x402/operator semantics stay intact.
- `rate_cards`: explicit `currency`/pricing interpretation, with checked USD
  snapshots for Stripe. Preserve existing version uniqueness and active-country
  rules. Existing x402 micros remain unchanged. Add a separately reviewed Stripe
  price/rounding version; do not assume all current USDC rates are an approved
  fiat retail price. Immutable rate snapshots on usage rows protect finalization
  from edits to an active rate card.
- `connect_jobs`: initialize `next_attempt_at` from validated `scheduledFor` or
  the next permissible window. Existing `reserved_micros` remains the cumulative
  per-job attempt guard. It is never summed as actual monthly spending.
- `call_legs`/`connect_receipts`: allow idempotent cost observations after the
  operational call becomes terminal, without granting dial/accept/bridge
  permissions or reopening state. Do not delete evidence with call content
  until finalized financial summaries exist. Add a measurement reconciliation
  marker/source only if current timestamps cannot express verified correction.

Use one explicit lock order everywhere: account, connection/grant, periods
in chronological order, usage/call, attempts/legs, invoice mapping. Adapt connect
transactions touching Stripe to this order; do not call a helper that obtains an
account lock after holding a call lock. Operator/x402-only transactions can keep
their existing call locks. Add deadlock/retry tests for this integration.

### Migration and backfill sequence

1. Add enum values in their own committed migration; later migrations consume
   them. Follow the repository's operator-payment migration precedent.
2. Add new tables, RLS, fields, composite keys/FKs, state/money checks and indexes
   in a new timestamped migration; keep all old data valid. Validate existing
   ownership before adding composite FKs.
3. Deploy code understanding all modes with Stripe admission off. Create billing
   accounts/connections lazily for verified humans. Do not enroll, migrate debt,
   reinterpret USDC amounts or attach cards automatically.
4. Update schema and SQL together. Run fresh bootstrap and upgrade tests through
   every existing migration plus additions. Verify historical x402/operator
   fixtures still satisfy funding constraints.
5. Backfill rate currency only after an operator confirms its interpretation;
   deny Stripe quoting on unreviewed tariffs. Allow explicit switch to card
   billing only for new calls. Historical and in-flight x402 calls finish on
   x402; the same idempotency key cannot move a call to a different method.
6. Rollback means disable new Stripe admission and continue finishing usage,
   collecting liabilities and accepting webhooks. Do not drop financial tables
   or detach cards needed for consented outstanding charges during rollback.

Proposed SQL files, to be created only during implementation:
`/home/gianpaj/github/gianpaj/agentcaller-io/supabase/migrations/20261018120000_stripe_payment_states.sql`
and
`/home/gianpaj/github/gianpaj/agentcaller-io/supabase/migrations/20261018120100_stripe_postpaid_billing.sql`.
Use newer timestamps if implementation starts after other migrations land.

## 8. Budget enforcement, scheduling and usage

### Money and caps

All new limits, reserves, finalized call charges and Stripe totals are integer
cents. Tariff calculation uses checked integer micros/BigInt:

```text
connected leg micros = connection fee + ceil(connected seconds / 60) × minute fee
logical call cents = ceil(sum(all known billable leg micros) / 10_000)
maximum cents = ceil(sum(worst permitted usage for all attempts/legs) / 10_000)
available month = approved cap - gross consumed cents - active reserved cents
uncollected exposure = consumed but uncollected cents + active reserved cents
```

The confirmed charging trigger is business answer, measured by a trusted SIP
connection signal. Connected business time is billable while waiting, navigating
an IVR or reaching voicemail; human detection and successful handoff are separate
outcomes. Count callback usage only when that leg also connects. Confirmed
unanswered legs cost zero; missing evidence does not prove either answer or no
answer. Service-fault credit policy, exact rates and rounding still need approval.

Round elapsed milliseconds upward into started minutes directly with integer
arithmetic; do not round duration to whole seconds first. A leg requires
confirmed connection before any minimum fee. A leg known never to have
connected costs zero. Unknown connection/end information remains unknown.

For Stripe requests use `maxAmountCents`; never multiply the old binary floating
`maxAmountUsd` value into a card authorization. Preserve that field for legacy
funding modes. Database `max_amount_micros` can store exact cents × 10,000 for
Stripe within the existing range. Reject ambiguous/mixed money fields.

Reserve the computed worst-case quote, which must fit the client's requested
ceiling, human per-call ceiling and integration ceiling. Quote all allowed
attempts and both legs, including waiting, callback, handoff, inference and any
customer-tax component. The actual tariff must be commercially approved;
provider cost and customer price need separate labels. A $1 cap might not cover
the default six attempts. Return a specific quote-too-large result and suggest
fewer attempts/shorter durations rather than silently weakening the job.

Enforce the confirmed server-managed USD 10 (1,000 cents) total uncollected-
exposure cap per account. The $10 monthly allowance and $1 per-call default are
separate suggested customer limits, not approved tariffs or additional credit.
A user raising their allowance cannot raise the merchant credit cap. Future
reservations count toward that same exposure cap. Paying an intermediate bill
reduces exposure, but never restores the month's consumed allowance. Refunds
do not automatically restore gross spend or enable another call.

### Atomic admission

1. Authenticate, parse the request and generate a canonical fingerprint. For a
   known Stripe idempotency key, verify the original fingerprint and return the
   existing call before checking mutable grant status, tariff or schedule expiry.
   Returning an accepted resource cannot authorize another dial. For a new key,
   validate deterministic task/destination policy, exact schedule, tariff and
   requested funding. Include an explicit accepted `quoteVersion` when using a
   previously returned quote; do not fingerprint a newly looked-up mutable rate.
2. Begin transaction; lock billing account, connection/grant and the target month.
   Recheck enabled/revoked/expiry/card/collection status and credential identity
   using current rows. Check idempotency again inside the lock.
3. Compare against both account-month and grant-month consumption/reservations.
   The grant-month total is an indexed sum of its usage rows under the account
   lock; a separate per-agent period table is unnecessary. Check total exposure
   across all open/uncollected periods, not just this month.
4. Require requested ceiling, per-call caps, month allowance and credit headroom
   all to cover the quote. Reject with a typed limit reason on any failure.
5. Insert the call, its full-job usage reservation, connect job, queued event
   and outbound call webhook in the same transaction. Update period counters.
   Recheck existing throttle/concurrency under the lock. Commit before dispatch.
6. Scheduler polls committed connect rows. No external queue enqueue is needed.
   Rollback leaves neither a call nor a hold. Crash after commit leaves a durable
   job to pick up; crash/timeout after dispatch does not cause a second dial.

Keep network calls outside transactions. The quote response is advisory until
admission pins a tariff; expire it if the tariff changed and require the client
to accept the new quote. A changed quote cannot increase an approved ceiling.

### Scheduling and billing periods

Use UTC calendar months, no prorating and no unused allowance carryover. Display
these rules explicitly even when business calling windows use Europe/Madrid or
another IANA timezone. Store a requested local time as an unambiguous UTC instant
plus its display timezone; reject nonexistent or ambiguous DST times unless the
request supplies a resolved instant. Add `scheduledFor`, not an appointment-time
interpretation. The existing seven-day horizon remains.

Attribute the job to its planned first permissible start month. Reserve that
month immediately, including future-month rows. Once its first attempt begins,
the job's month is immutable. All permitted attempt starts must be in that
month; at a boundary expire remaining retries and release unused reservation
after reconciling any live leg. A running leg may finish in the next month and
is billed to its start month. Do not split a started-minute tariff at midnight.
Do not automatically move a job to a new budget month or silently reschedule it.

Future period rows snapshot the recurring approved cap. Changing a cap locks
the account and applies to all unclosed future periods. Reject an immediate
decrease below consumed plus reserved usage; offer an explicit cancel-pending-
calls action or a next-period change. A next-period decrease must still account
for reservations already in that future period. Raising a limit requires human
consent, not a tool parameter. No increase of merchant credit headroom follows.
Apply the same consumed-plus-reserved checks to an integration's narrower
monthly grant before lowering it.

### Dispatch, revocation and metering

Funding authorization must be checked at scheduler selection, dispatch and each
worker permission transition. For Stripe, check active grant/account/connection,
reservation, pinned ceiling, target period and supported task. Preserve operator
checks and the x402 paid-connect blocker. Make these checks transactionally
consistent with revocation in `connectCommand()`; a check outside the call
transaction alone leaves a revoke/dial race.

The accepted dial intent is the race's linearization point. If intent commits
first, revocation immediately requests teardown; the provider might connect
before hangup. Preserve its reservation and account for any confirmed usage.
If revocation commits first, deny intent. Never promise zero cost for an
already-issued dial request.

Revoking a connection or spending grant cancels queued jobs and triggers cleanup
of active jobs; the worker fails closed on its next heartbeat at the latest.
Mark the grant revoked synchronously before batched cancellations, so a slow
cancel pass cannot permit another dispatch. Revocation stops future service;
already-consumed charges remain payable under the agreement. A separate request
to withdraw automatic collection permission blocks new invoice collection and
queues verified `auto_advance=false` updates for outstanding Stripe invoices.
Confirm the Stripe updates and escalate any already-processing payment; a local
flag cannot stop Stripe's scheduled retries. Keep service blocked while the
external change is pending. Existing debt still needs an agreed manual payment
path. Do not detach the method before deciding treatment of outstanding service.

Retain current conservative per-attempt `connect_jobs.reserved_micros` behavior.
Reserve the full customer job once at account admission; do not reserve it again
for each attempt. After terminal cleanup and all leg measurements, atomically
replace the account's reserved cents with actual cents and release the unused
part. If billing exceeds the pinned maximum because of provider overruns,
charge no more than the agreed ceiling, record the overrun as merchant loss,
and suspend the affected tariff/path pending investigation.

Operational terminal state and accounting completion are separate. The current
`connectCommand()` rejects all events after `call.endedAt`; cancellation can
therefore discard later end observations. Add a narrow, idempotent observation
path that accepts ended/provider evidence after terminal without authorizing
any new action. Validate SIP/attempt/leg ownership, timestamp ordering and bounds.
Finalization must wait for this path and cleanup; never infer usage from the
call's terminal reason alone.

Missing evidence keeps the reservation in `metering_pending`. Reconcile provider
records by SIP IDs; ambiguous provider outcomes never become zero automatically.
Within 48 hours of month end, either obtain evidence or have an operator confirm
cleanup and explicitly waive unsupported charges, recording merchant loss. If
cleanup/exposure cannot be established, suspend further usage and escalate;
period close must not guess a fee or silently release a live-leg hold.

The generic terminal-event path has an update-before-settlement crash gap and
no durable replay of finalization. Do not reuse it for the Stripe pilot. Before
enabling Stripe for generic tasks, add connected/disconnected evidence and a
durable finalization marker in the same terminal transaction, plus a collector
that can retry it after a crash. Generic result validation is a separate task
completion dependency.

## 9. Monthly invoicing, Stripe collection and financial operations

```mermaid
sequenceDiagram
    participant W as Voice worker
    participant P as Platform / billing drain
    participant D as PostgreSQL
    participant S as Stripe Invoicing
    participant H as Human
    W->>P: Idempotent connected/end observations
    P->>D: Finalize usage and release unused hold
    P->>D: Close resolved month; persist unique invoice operation
    P->>S: Create draft invoice and attach monthly usage item
    P->>S: Verify total; finalize with automatic collection enabled
    S->>S: Charge saved card; manage configured retries
    S->>P: Signed invoice payment/status events
    P->>D: Reconcile invoice and gate further service
    alt Payment or authentication action required
        S-->>H: Configured email with hosted invoice page
        H->>S: Complete payment / 3DS on hosted page
        S->>P: Signed invoice payment/status event
        P->>D: Reconcile debt; restore service only if authorized
    end
```

### Ownership

AgentCaller owns period attribution, approved prices, usage, allowances,
reservation release, invoice creation/finalization idempotency and account
access. Stripe owns the invoice/payment lifecycle, automatic card collection,
configured retry policy, payment emails, hosted payment/SCA recovery, invoice
PDFs and payment receipts. AgentCaller mirrors those outcomes and reconciles
missing events. There is no application card-decline classifier, confirmation
retry scheduler, PaymentIntent creation/replacement worker, client-secret API,
custom 3DS page or transactional dunning-email service in this project.

One-off invoices support these recovery features when configured, including
Smart Retries for eligible card invoices with `auto_advance=true`. Enable and
test the merchant account's chosen retry policy and failed-payment emails,
including links to Stripe's hosted page. Feature availability and exact timing
must be confirmed for the selected Invoicing tier before paid launch.
[Stripe automatic collection](https://docs.stripe.com/invoicing/automatic-collection).

### Close, create and finalize one monthly invoice

At UTC month end, stop new attempt starts against that month. Cancel/expire
unstarted jobs for that month, finish/reconcile live legs, finalize usage and
reconcile counters. Once reserved cents are zero, freeze the period's usage
and approved adjustments. Several integrations share one account/month invoice.

1. Under the account lock, insert/reuse the unique `billing_invoices` row with
   expected amount/currency, Customer and period. Persist stable issuance keys
   before any Stripe request; lease this invoice-creation work in bounded batches.
2. Create a draft using `stripe.invoices.create` with the verified `customer`,
   `currency: "usd"`, `collection_method: "charge_automatically"`,
   `auto_advance: false`, `pending_invoice_items_behavior: "exclude"`, the
   authorized `default_payment_method`, card-only payment settings and internal
   account/period metadata. Do not include a subscription. Persist its Invoice ID.
3. Attach one aggregate monthly usage item with `stripe.invoiceItems.create`,
   specifying this Invoice ID, its Customer, integer amount/currency, a safe
   usage-period description and period reference. Explicit invoice association
   prevents a pending item being swept into another invoice. Use one stable key
   for the item; if transport fails, retrieve/reconcile before adding it again.
   Keep per-call itemization in AgentCaller rather than risking Stripe's line
   count limit on a busy account.
4. Retrieve the draft and validate Customer, livemode, currency, item association
   and expected tax-inclusive total. Refuse finalization if discounts, taxes,
   credit balances, extra items or configuration change the authorized amount.
   Persist an actionable discrepancy; never correct it by charging separately.
5. Finalize that invoice with `stripe.invoices.finalizeInvoice` and
   `auto_advance: true` only while collection consent is active. Persist/reconcile
   the returned invoice. Stripe owns automatic collection and subsequent retries;
   the application never separately creates/confirms/pays its PaymentIntent or
   schedules `invoices.pay` calls. Finalization is not proof of payment. Stripe's
   collection delay is acceptable; there is no exact month-end payment promise.
6. Record finalization and collection outcomes from verified invoice events and
   periodic retrieval. A stalled draft/finalization error needs operator action
   or retry of the same issuance operation, not a second invoice.

The draft hold keeps incomplete invoices from collecting. Creation, item
attachment and finalization each have an independent stable idempotency key
under `billing-period:<local invoice UUID>:<step>:v1`.
[Invoice creation API](https://docs.stripe.com/api/invoices/create),
[InvoiceItem API](https://docs.stripe.com/api/invoiceitems/create),
[Invoice finalization API](https://docs.stripe.com/api/invoices/finalize).

Zero usage: close a $0 AgentCaller statement without a Stripe invoice. For a
positive total below the applicable card minimum, waive it before invoice
issuance and record the merchant subsidy. Never increase the amount or allow
Stripe's small-invoice balance carry-forward to create an implicit customer
credit/debt balance. Account for tax-document requirements for waived usage
before launch. [Stripe currency/minimum rules](https://docs.stripe.com/currencies).

Stripe's v1 idempotency keys can be pruned after at least 24 hours. Permanent
uniqueness comes from the local account/month mapping, persisted Invoice/Item
IDs and reconciled Stripe objects. If creation or item attachment returns an
unknown result, reuse its key promptly and reconcile events and the Customer's
invoices/items. After the retention window, do not blindly repeat the create;
leave issuance blocked for reconciliation/operator resolution. Never use a
missed HTTP response or an empty immediate search result as proof of absence.
[Stripe idempotency](https://docs.stripe.com/api/idempotent_requests).

### Invoice outcomes and service access

| Stripe outcome                             | AgentCaller response                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoice finalized/open, collection pending | Mirror the invoice and keep usage unpaid. Ordinary bounded processing time is allowed within existing credit exposure; finalization does not mean collected. Escalate overdue collection using invoice evidence.                                                                                                                                          |
| Invoice payment failed                     | Suspend new reservations/dispatch across periods. Mirror the invoice and safe failure reason. Let Stripe's configured recovery policy retry it; never create a replacement invoice or a parallel application payment.                                                                                                                                     |
| Invoice payment action required            | Keep service blocked. Billing settings show a human-only link to the invoice's `hosted_invoice_url`; configured Stripe emails provide the same recovery flow. The agent receives only the AgentCaller billing-page URL/status.                                                                                                                            |
| Customer completes hosted payment/3DS      | Reconcile the same invoice from signed events/current retrieval. Restore service only after debt is resolved and account, connection and spending grant are still valid. A successful payment cannot revive revoked authorization.                                                                                                                        |
| Invoice paid                               | Verify account/Customer/currency, original expected amount, amount paid/remaining and any approved credit notes. Count cash collection once. `invoice.paid` can also reflect an out-of-band mark, so require payment evidence or an explicitly audited non-card settlement; do not equate every paid event with card cash.                                |
| Card replaced                              | Verified Checkout setup selects the attached card locally; new invoices specify it explicitly and unpaid invoice method overrides are updated as appropriate. Stripe owns subsequent collection. Paying an invoice with a different card alone does not prove consent to save/select it for future use; retain the explicit setup/default-selection flow. |
| Invoice uncollectible or void              | Keep the account blocked until an operator resolves/writes off the liability under policy. Neither state means money was collected; retain financial history and distinguish waived/credited usage. No automatic new invoice for the same period.                                                                                                         |
| Partial payment or mismatch                | Keep received and remaining amounts distinct; block while a receivable remains. Do not enable partial payments, split tender or automatic short-payment forgiveness in the MVP. Use Stripe's invoice/credit-note workflow for exceptional manual resolution; no separate remainder-charge engine.                                                         |
| Dispute                                    | Preserve the payment/invoice evidence, record the dispute and suspend service. Handle evidence and deadlines through Stripe's tools. Do not recharge disputed service or automatically issue an overlapping refund.                                                                                                                                       |

Stripe's hosted invoice page provides payment, 3DS, invoice and receipt downloads.
Read the current URL only for an authenticated owner, keep it out of general
logs/agent output, and retrieve again when expired. No custom payment form or
publishable-key frontend dependency is needed.
[Hosted Invoice Page](https://docs.stripe.com/invoicing/hosted-invoice-page).

For webhooks, use current retrieved invoice state rather than arrival order.
`invoice.payment_failed` must not overwrite a later resolved payment. A valid
`invoice.paid` event must still reconcile payment versus approved credits or
out-of-band settlement. [Stripe invoice events](https://docs.stripe.com/api/events/types).

### Corrections, refunds, invoices and tax

Approve a correction with an immutable local audit record; retain gross usage
for allowance enforcement. Before finalization, adjust the held draft and
validate the approved total again. After finalization, use Stripe credit notes
for amount corrections. For a paid invoice, issue/associate the appropriate
refund through Stripe's invoice/credit-note/Dashboard workflow and reconcile
CreditNote/Refund events. Use an explicit refund rather than a future customer
credit balance for the MVP. No application refund-attempt queue or allocation
engine is required; an operator can perform the bounded action through Stripe
and record which usage/period was corrected.
[Invoice corrections](https://docs.stripe.com/invoicing/integration/workflow-transitions).

Keep credit-note, refund pending/succeeded/failed and dispute facts distinct.
An unsuccessful refund must not be shown as paid back. Apply each provider
adjustment once, and never rewrite measured usage to disguise it. A completed
refund does not automatically restore the month's spending allowance.
[Stripe refunds](https://docs.stripe.com/refunds).

Use Stripe invoices, PDFs and receipts as the billing documents; AgentCaller
shows its detailed call usage and links to the corresponding invoice. There is
no separate custom tax-invoice/receipt generation system. Configure the verified
billing email, business details and Stripe customer communications and confirm
which emails automatic-charge invoices actually send in this account.
[Stripe receipts](https://docs.stripe.com/receipts).

Before paid launch, identify merchant legal entity, supported customer countries,
tax-inclusive/exclusive tariffs, customer location evidence, invoice numbering,
credit-note and financial-retention obligations. Prefer approved tax-inclusive
pilot tariffs so the human's cap includes the full charge. Collect required
billing address/tax fields through Stripe where possible. Stripe Invoicing
supplies documents and collection, not an automatic resolution of every tax
registration or legal duty. Do not enable tax/discount behavior that can exceed
a reserved allowance.

### Credit risk and operations

Saving/authenticating a card is not a funds guarantee. The merchant pays Telnyx,
LiveKit and inference before collection and can lose the complete allowed
exposure plus provider overruns and dispute costs. Start with an explicit pilot
eligibility allowlist, a global exposure ceiling, per-account credit caps and no
self-approved merchant credit increases. A due failed/action-required invoice
blocks paid service even while Stripe is retrying. Cross-month reservations and
unpaid old usage remain in exposure; a calendar reset cannot create another
$10 debt. Disable new admission independently from necessary usage finalization
and consented invoice processing.

Optional later threshold collection charges only already-consumed usage under
explicit consent and requires invoice-to-usage allocation changes. It is outside
this monthly-only design. No deposits, top-ups, customer credit balances or
prepaid funds are introduced.

Monitor setup/event age, metering holds, stale job leases, room cleanup failures,
period close, unknown draft/item creation results, unfinalized invoices,
`invoice.finalization_failed`, failed/action-required/uncollectible invoices,
amount discrepancies, debt/exposure and daily ledger-to-invoice reconciliation.
Stripe sends configured payment recovery communications; AgentCaller supplies
status, access gating and operator alerts. Do not build a dunning email sender,
retry calendar or duplicate hosted payment recovery in the platform.

## 10. Explicit edge-case behavior

| Scenario                                 | Proposed behavior                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. $10/month and several future calls    | Reserve every full job in its planned start month; apply account/grant caps plus total exposure across months. Return accepted only after commit. Show scheduled reservations separately from consumed usage. Seven-day horizon remains.                                                           |
| 2. Two requests want remaining allowance | Account row lock serializes both. Exactly one fits; the other gets a budget error. Duplicate keys return the same call and never reserve twice. Test with independent PostgreSQL connections.                                                                                                      |
| 3. Start in one month, finish in another | Whole logical job stays in its reserved first-start month; charge all its measured legs there. Delay closing for bounded completion. No new retry starts in the next month without a fresh request/reservation.                                                                                    |
| 4. Never answered                        | Confirmed pre-answer busy/no-answer has zero usage. Retry only within connect policy and reserved job ceiling. On final terminal/cleanup release unused hold. Unknown dial outcomes retain a reconciliation hold.                                                                                  |
| 5. Answered, user never connected        | Business answer is the confirmed charging trigger. Bill measured connected business time, including IVR/voicemail/waiting, even if the callback or handoff fails. Bill callback usage only if that leg connects. Rates/rounding and discretionary service-fault credits remain separate decisions. |
| 6. Approaches maximum cost               | Quote covers hard per-leg duration and all attempts before acceptance. Refuse a duration/attempt set that cannot fit. Worker timers, server permission checks and LiveKit SIP maximums stop each leg. Merchant absorbs any unapproved overrun; alert and disable the affected route.               |
| 7. Revocation with scheduled calls       | Revoke synchronously, deny new intent, cancel queued jobs, tear down active ones and retain metering holds until evidence/cleanup. Accrued debt remains; late setup/webhooks cannot reactivate.                                                                                                    |
| 8. Lower limit below reservations        | Reject an immediate lower cap with consumed/reserved totals and options to cancel pending jobs or choose a later effective month. Never invalidate a committed reservation silently.                                                                                                               |
| 9. First charge needs 3DS                | Pause paid usage; show an AgentCaller billing-page link to the agent. The authenticated human follows the private Stripe hosted invoice page and completes 3DS there. Stripe sends configured recovery emails; readiness follows verified payment reconciliation.                                  |
| 10. Monthly collection fails             | Keep debt and monthly spent intact, block new paid jobs across periods and let Stripe manage configured retries/emails for the same invoice. No custom retry worker or automatic switch to x402/new funding.                                                                                       |
| 11. Duplicate/late Stripe event          | Unique event ID plus authoritative invoice/setup reconciliation. Late setup cannot revive a revoked grant; an old payment failure cannot downgrade a paid invoice. Credits/out-of-band marks do not count as card collection without evidence.                                                     |
| 12. Agent disconnects, account stays     | Revoke its credentials/connection/grant and cancel its scheduled jobs. Keep account, card, statements, other agents and consumed debts. Distinguish tool disconnection from withdrawal of collection consent.                                                                                      |
| 13. Several agents                       | Separate credentials/grants and optional narrower sublimits, one shared account cap and one monthly payment. Untrusted display names do not create new identities or allowances.                                                                                                                   |
| 14. x402 customer switches               | Verify/link human ownership and explicitly approve a new Stripe grant. Future calls choose Stripe; in-flight/historical x402 calls and receipts remain x402. Reject funding change under an existing idempotency key.                                                                              |
| 15. Zero usage                           | Close a zero AgentCaller statement with no Stripe invoice or charge. Waive positive below-minimum totals before invoice issuance; do not create customer balance carry-forward.                                                                                                                    |
| 16. Payment succeeds, client times out   | Retrieve/reconcile the existing invoice and its payment evidence; apply collection once. Retain uncertain issuance state when an Invoice/Item creation response is lost. Never create another invoice or directly charge a PaymentIntent because HTTP timed out.                                   |

## 11. Threat model and reliability boundaries

Assets: human identity and consent, payment identifiers/credentials, authorized
allowances, call intent, telephony usage evidence, receivables, settlement
uniqueness and private call data. Trust boundaries: agent/host → platform,
human browser → platform, platform → database, worker → platform, platform ↔
Stripe, and worker ↔ LiveKit/Telnyx. The model and task text are untrusted.

| Threat or failure                             | Control and verification                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unauthorized paid tool                        | Verify credential and tenant, then separate current spending grant; restrict operations by connection. No paid authority from request IDs, client labels, task instructions or possession of a URL. Test cross-tenant and revoked keys.                                                                                                                                               |
| Prompt injection changes limits/card/customer | Limits and Stripe identifiers come only from verified database rows and human actions. Model can request a quote/setup link, never modify consent. Validate tasks/destinations independently. Test malicious purpose/information fields.                                                                                                                                              |
| Concurrent overspend                          | Account-first locks, transactionally inserted full-job holds, DB uniqueness, nonnegative counters, immutable ceiling and reconciliation. Test parallel clients, cancellations, limit changes and close.                                                                                                                                                                               |
| Leaked/wrong-person setup URL                 | Random hashed token, expiry, verified UID match, fixed account/connection, no authority from token. No identifying details before ownership check. Test wrong signed-in user, modified ID/token and replay.                                                                                                                                                                           |
| CSRF/session fixation                         | Consent and changes through authenticated POST/server actions with Origin/CSRF protection; secure cookies, rotate/verify login session, short restricted continuation, no GET mutations and no arbitrary return URLs. Test consent POST from another origin and forced-account login.                                                                                                 |
| Attacker swaps Checkout/customer/method       | Server creates mappings; verify Session, SetupIntent, PaymentMethod customer and current generation plus environment. Metadata supplements, never replaces, stored ownership. Test valid Stripe objects for another account.                                                                                                                                                          |
| Webhook spoof/replay                          | Raw bytes + Stripe signature/timestamp, event-ID uniqueness, durable processing and object validation. No disable-signature test switch in deployable code. Test modified raw body, bad/stale signature and parallel duplicate events.                                                                                                                                                |
| Out-of-order events                           | Guarded current-state transitions and authoritative retrieval; terminal/revoked states stay final. Process setup and payment histories independently. Test success-before-failure and revoke-before-setup-success.                                                                                                                                                                    |
| Double charge after crash                     | Persist invoice/item issuance operations before network, stable keys, unique account/month invoice mapping, leases and retrieval. Stripe alone owns payment attempts. Test crashes at create, attach, finalize and payment-success/webhook boundaries; no parallel application debit.                                                                                                 |
| Revocation races                              | Same transaction/lock order as admission and dial permission; synchronous revoked flag before background cancellation. Keep already-issued leg bounded and metered. Test cancel/revoke/dial/bridge races.                                                                                                                                                                             |
| Lost dispatch or worker                       | Durable queued job/attempt/intent, bounded heartbeat lease, no repeat dial after uncertainty, provider duration limit and repeated teardown. Test crash after commit, delayed dispatch and worker loss.                                                                                                                                                                               |
| Terminal row loses end evidence               | Separate immutable operational state from late accounting observations; idempotent leg evidence accepted after cancel. Keep unknown cost held and surfaced. Test shutdown after terminal, late disconnect and duplicate measurement.                                                                                                                                                  |
| Card fails after consumption                  | Low merchant credit cap and account gate on failed/action-required invoices. Stripe handles configured retries and hosted recovery; unresolved debt stays visible. Test failure, SCA, card replacement and disabling Stripe automation after collection-consent withdrawal.                                                                                                           |
| Money/unit errors                             | Integer cents and micros, bounded BigInt arithmetic, explicit currency/pricing version, same quote/finalization rounding. Test sub-cent rates, max duration, multiple legs and overflow.                                                                                                                                                                                              |
| Data exposure/GDPR                            | Server-only billing RLS; minimum identifiers/card display metadata; redact tokens, secrets, tasks, payloads and receipt URLs from logs. Keep setup tokens short-lived; financial data has a separately approved legal retention schedule. Delete call content independently; retain pseudonymized financial evidence only as required. Test deletion while unpaid and across tenants. |
| Account takeover/billing abuse                | Recent human authentication for limit increases, grant/card/collection-consent changes; rate-limit setup/recovery. Preserve audit and operator disable controls. Avoid storing unnecessary IP/device data as a substitute for consent.                                                                                                                                                |
| Secret compromise                             | Stripe secrets only in platform server environment; separate test/live resources/signing secrets and rotation. Worker/MCP never receives card or client secrets; hosted recovery avoids passing client secrets through AgentCaller. Lazy config keeps disabled Stripe optional.                                                                                                       |
| Unsafe outbound callbacks                     | Preserve existing per-client HMAC raw-body signatures, timestamps/event IDs, HTTPS-only URLs, private-address denial and redirect blocking. Billing additions cannot weaken existing webhook delivery.                                                                                                                                                                                |

Card collection through hosted Checkout reduces card-data handling; it does not
eliminate merchant consent, privacy, PCI validation or calling-law obligations.
Launch review must address the actual merchant/customer jurisdictions and the
bounded telephone use case. Veterinary contact/regulated-service scope in the
example needs a product-policy decision; do not silently broaden current rules.

## 12. Concrete file-by-file implementation plan

Paths below are absolute under the active workspace. New files do not exist yet.
Each group has a dependency and validation target; avoid moving unrelated files.

### Contracts and persistence

| File                                                                                                               | Work and ownership                                                                                                                                                                                               | Tests/dependencies                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `/home/gianpaj/github/gianpaj/agentcaller-io/packages/contracts/src/billing.ts` (new)                              | Zod schemas/types for funding selection, integer cents, setup/status, limits, quote and usage/collection states. No Stripe SDK types cross the wire.                                                             | New `billing.test.ts`: money bounds, currency, mixed funding, machine-readable statuses. First dependency for every phase.  |
| `/home/gianpaj/github/gianpaj/agentcaller-io/packages/contracts/src/index.ts`                                      | Export billing contracts; add Stripe-specific call input branch and funding/payment states while retaining legacy validation.                                                                                    | Update `index.test.ts` with old requests plus new cents requests and missing grant-independent validation.                  |
| `/home/gianpaj/github/gianpaj/agentcaller-io/packages/contracts/src/connect-me.ts`                                 | Optional `scheduledFor` validation in the containing call request; share deterministic schedule/period and typed connect outcome rules where they cross processes. Do not treat appointment times as dial times. | `connect-me.test.ts`: exact future schedule, seven-day horizon, IANA/DST-resolved instants and month-boundary retry policy. |
| `/home/gianpaj/github/gianpaj/agentcaller-io/packages/database/src/schema.ts`                                      | Nine billing tables and existing model changes from section 7; checked states, RLS declarations, ownership FKs and indexes.                                                                                      | Fresh/upgrade DB tests and SQL/schema parity.                                                                               |
| `/home/gianpaj/github/gianpaj/agentcaller-io/supabase/migrations/20261018120000_stripe_payment_states.sql` (new)   | Enum expansion alone.                                                                                                                                                                                            | Apply/commit before consuming enum.                                                                                         |
| `/home/gianpaj/github/gianpaj/agentcaller-io/supabase/migrations/20261018120100_stripe_postpaid_billing.sql` (new) | Additive schema, constraints, RLS and indexes; no historical payment rewrite.                                                                                                                                    | Bootstrap and legacy fixture constraints; account ownership and duplicate collection violations.                            |

### Identity and setup

| File                                                                                                                                                                                                                                                                   | Work and ownership                                                                                                                                                                                                                                                                   | Tests/dependencies                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/auth.ts`                                                                                                                                                                                            | Add `authenticateApiPrincipal()` retaining key/connection identity; keep legacy wrapper.                                                                                                                                                                                             | New `auth.test.ts`: actual hashed key, disabled/revoked/mismatched connection and profile cases.                                                             |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/agent-connections.ts` (new)                                                                                                                                                                         | Persist/resolve human-approved OAuth connections, tool permissions, consent facts and revocation; support explicitly linked legacy API keys. Issuer-validated tokens resolve existing consent; model/user IDs and token refresh never grant spending or revive a revoked connection. | Unit and DB tests for new OAuth consent, client/subject/tenant binding, denied or interrupted consent, refresh/revoke races and explicit legacy-key linking. |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/stripe.ts` (new)                                                                                                                                                                                    | Lazy Node Stripe client, pinned API version and bounded SDK retries. Provider calls only, no tenant or model input authority.                                                                                                                                                        | Mock SDK contract tests; missing config leaves other modes usable.                                                                                           |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/billing-setup.ts` (new)                                                                                                                                                                             | `createBillingSetup`, `approveBillingSetup`, Customer/Session operation reconciliation, owner/generation checks and activation reducer.                                                                                                                                              | `billing-setup.test.ts`: consent, wrong owner, duplicate setup, Session association, replacement and late events. Stripe test-mode acceptance.               |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/stripe-events.ts` (new)                                                                                                                                                                             | Signature-verified event inbox processing, leases and guarded setup/invoice/credit-note/refund/dispute reconciliation. Retrieve authoritative invoices; Stripe owns payment attempts.                                                                                                | `stripe-events.test.ts`: signatures, duplicates, stale failure after paid, credit/out-of-band distinctions, storage failure and resume.                      |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/stripe/webhook/route.ts` (new)                                                                                                                                                                  | Node runtime; read body once, verify, insert minimal receipt, return promptly.                                                                                                                                                                                                       | Route tests for unchanged raw bytes, invalid signature, DB failure and duplicate delivery.                                                                   |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/v1/billing/setup/route.ts` (new)                                                                                                                                                                | Agent-authenticated enrollment-link creation.                                                                                                                                                                                                                                        | Route identity/idempotency/error tests.                                                                                                                      |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/v1/billing/setup/[id]/route.ts` (new)                                                                                                                                                           | Tenant/connection-scoped pending status.                                                                                                                                                                                                                                             | Cross-tenant, expired and revoked tests.                                                                                                                     |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/billing/connect/page.tsx` and `actions.ts` (new)                                                                                                                                                    | Secure token exchange, sign-in continuation, owner-bound account/integration/terms screen and consent POST.                                                                                                                                                                          | Browser tests for wrong user, CSRF, no auto-consent and refresh/back behavior.                                                                               |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/billing/connect/return/page.tsx` (new)                                                                                                                                                              | Display server-confirmed pending/ready; no activation on redirect.                                                                                                                                                                                                                   | Browser return before webhook, closed tab and altered Session ID.                                                                                            |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/auth-redirect.ts`, `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/login/actions.ts`, `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/auth/callback/route.ts` | Support fixed `/oauth/consent` and `/billing/connect` continuations through enabled human sign-in methods. Preserve only issuer-validated authorization references/restricted setup cookies; reject arbitrary next URLs.                                                             | Extend auth-redirect/login tests for first-time sign-in, interrupted OAuth, swapped authorization requests, billing resume and open-redirect attempts.       |

### Usage and call integration

| File                                                                                                                                                                                                                                                      | Work and ownership                                                                                                                                                                                                                                                          | Tests/dependencies                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/billing-pricing.ts` (new)                                                                                                                                                              | Integer quote/finalization arithmetic, versioned cents rounding, UTC period attribution. Reuse connect quote shape without float money.                                                                                                                                     | `billing-pricing.test.ts`: no answer vs unknown, two legs, boundary milliseconds, tax-inclusive caps, rounding and overflow.     |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/billing-usage.ts` (new)                                                                                                                                                                | `reserveCallBudget(tx)`, `finalizeCallUsage(tx)`, `releaseUnstartedReservation(tx)`, status totals and exposure. Caller supplies transaction; lock order is explicit.                                                                                                       | `billing-usage.integration.test.ts` on real PostgreSQL: concurrent admission/limit/revoke/cancel/finalize and crash recovery.    |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/call-funding.ts` (new)                                                                                                                                                                 | Small explicit `authorizeCallFunding`/`authorizeExecution` switch; delegates existing x402/operator and new Stripe checks. No plugin registry.                                                                                                                              | `call-funding.test.ts`: no mode crossover, mixed signatures, missing/expired grants, operator regression.                        |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/submit-call.ts`                                                                                                                                                                        | Accept verified principal for Stripe; reserve atomically with call/job/events, fingerprint retries, pin price and exact schedule; default existing x402 behavior remains.                                                                                                   | Extend admission and PostgreSQL submission tests; same-key same/different mode and rollback paths.                               |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/v1/calls/route.ts`                                                                                                                                                                 | Resolve principal and funding contract; return narrow call representation for new Stripe responses.                                                                                                                                                                         | API regression for x402 402, malformed payments, operator and Stripe setup-required/202.                                         |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/v1/calls/quote/route.ts` (new)                                                                                                                                                     | Call shared validation/quote service without reserving budget.                                                                                                                                                                                                              | Quote/admission agreement and stale-tariff tests.                                                                                |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/connect-policy.ts`                                                                                                                                                                     | Scope current paid blocker to x402; preserve attemptReserve. Stripe allowed only when full billing/execution gate is on.                                                                                                                                                    | Update `connect-admission.test.ts`; paid x402 stays blocked.                                                                     |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/connect-me.ts`                                                                                                                                                                         | Account-first locking for Stripe; reservation/month-aware attempts; separate terminal accounting marker; accept late metering without new permissions.                                                                                                                      | Extend `connect-me.integration.test.ts`: cancellation/end race, month cutoff, revoked grants and no double reserve/finalization. |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/connect-scheduler.ts`                                                                                                                                                                  | Authorize by funding mode; finish stale-worker reconciliation regardless of new-admission switch; finalize held usage after cleanup.                                                                                                                                        | Scheduler tests for Stripe/operator/x402 isolation, ambiguous dispatch and stale worker.                                         |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/livekit.ts`                                                                                                                                                                            | Replace operator-only connect dispatch check with explicit execution authority. Keep worker SIP ownership and no duplicate dispatch retry.                                                                                                                                  | Mock dispatch tests per funding mode.                                                                                            |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/internal/calls/[id]/connect/route.ts`                                                                                                                                              | Use execution checks inside transition transaction; permit authenticated late observations while denying new actions.                                                                                                                                                       | Route tests for revoked grant, replayed dial permission and late ended evidence.                                                 |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/v1/calls/[id]/cancel/route.ts` and `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/v1/calls/[id]/route.ts`                                                  | Expose usage/period collection separately; cancel/release only after safe cleanup; retain non-content financial references on deletion.                                                                                                                                     | Cancel/refund distinction, unpaid deletion, cross-tenant financial lookup tests.                                                 |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/settlement.ts`                                                                                                                                                                         | Explicit Stripe guard prevents generic x402 settlement. Existing x402 implementation remains otherwise unchanged.                                                                                                                                                           | Extend `settlement.test.ts` with Stripe guard and unchanged x402 arithmetic.                                                     |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/voice-agent/src/platform.ts`, `/home/gianpaj/github/gianpaj/agentcaller-io/apps/voice-agent/src/connect-livekit.ts`, `/home/gianpaj/github/gianpaj/agentcaller-io/apps/voice-agent/src/connect-flow.ts` | Preserve event IDs across retries; report cleanup/end evidence even after operational terminal. Remove hardcoded Gianfranco identity before multi-customer connect pilot; supply a validated human display name through contracts. Keep billing decisions off worker/model. | Existing provider-mock tests plus lost end, cleanup failure, approved name, no recording and customer revocation tests.          |

`main.ts` and generic `/api/internal/calls/[id]/event/route.ts` need changes only
if extending Stripe beyond connect: typed results, connected/disconnected
evidence, durable finalization and permission claims before dial. That extension
is explicitly outside the first customer-billing pilot.

### Collection, UI, configuration and docs

| File                                                                                                                                                                                                                                                                                                                                        | Work and ownership                                                                                                                                                                                                                                                                               | Tests/dependencies                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/billing-invoicing.ts` (new)                                                                                                                                                                                                                                              | Close eligible periods and idempotently create, attach usage to, finalize and reconcile one Stripe invoice. Mirror invoice outcomes and gate service; no PaymentIntent management, decline classification, retry scheduler, custom SCA or refund engine.                                         | `billing-invoicing.test.ts` plus DB issuance races/fault injection; Stripe test invoices and hosted recovery acceptance.          |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/billing-drain.ts` (new)                                                                                                                                                                                                                                                  | Bounded leased work over existing DB tables; no process-local timers for durable work.                                                                                                                                                                                                           | Overlapping ticks, expired leases, dead letters and fairness under backlog.                                                       |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/internal/billing/drain/route.ts` (new)                                                                                                                                                                                                                               | GET for Vercel cron, optional POST for manual runs, shared secret validation.                                                                                                                                                                                                                    | Wrong secret/method and duplicate tick tests.                                                                                     |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/internal/webhooks/drain/route.ts`                                                                                                                                                                                                                                    | Expose authenticated GET via existing drain function so its configured cron works.                                                                                                                                                                                                               | Preserve POST behavior/signatures and verify GET authorization. No webhook subsystem rewrite.                                     |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/v1/billing/status/route.ts` and `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/api/v1/billing/usage/route.ts` (new)                                                                                                                              | Read scoped grants, period totals and paginated usage. No card or provider secrets to agents.                                                                                                                                                                                                    | Tenant/connection visibility and counter consistency.                                                                             |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/app/billing/page.tsx`, `actions.ts`, `billing-controls.tsx` (new)                                                                                                                                                                                                        | Human billing section: OAuth-connected integration identities, setup/replace card, limits, separate tool/spending revocation, reserved/used, invoice/debt status and authenticated links to Stripe hosted invoices/PDFs. Reuse these owner-checked actions for links; no separate recovery page. | Browser/server-action tests for owner checks, private URL handling, stale links, replaced cards and revoked access after payment. |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/app/layout.tsx` and `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/app/settings/page.tsx`                                                                                                                                                            | Billing navigation/settings link using existing visual components. No unrelated portal redesign.                                                                                                                                                                                                 | Navigation smoke test.                                                                                                            |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/env.ts` and `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/.env.example`                                                                                                                                                                                     | Lazy Stripe configuration and explicit admission flag; placeholders only.                                                                                                                                                                                                                        | Extend `env.test.ts` for disabled/missing/mixed test-live config.                                                                 |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/package.json` and `/home/gianpaj/github/gianpaj/agentcaller-io/pnpm-lock.yaml`                                                                                                                                                                                                   | Add pinned Stripe server SDK during implementation. Hosted Checkout/Invoicing need no Stripe.js, Elements or recovery-form dependency. Add MCP dependencies only in its phase; preserve minimum package-release age.                                                                             | Frozen install/typecheck/build; no dependencies installed during planning.                                                        |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/vercel.json`                                                                                                                                                                                                                                                                     | Add authenticated billing drain schedule and verified GET handler; confirm Vercel plan limits and production/preview scheduler behavior. Keep documented external connect scheduler.                                                                                                             | Deployment smoke test with harmless ledger fixtures, metrics and authorization.                                                   |
| `/home/gianpaj/github/gianpaj/agentcaller-io/scripts/test-billing-db.mjs` (new), `/home/gianpaj/github/gianpaj/agentcaller-io/scripts/test-connect-db.mjs`                                                                                                                                                                                  | Reuse disposable DB approach; ensure suites load new migrations. Avoid simultaneous destructive migration bootstraps in one database.                                                                                                                                                            | Separate disposable DBs per suite; all legacy migrations and tests.                                                               |
| `/home/gianpaj/github/gianpaj/agentcaller-io/README.md`, `/home/gianpaj/github/gianpaj/agentcaller-io/apps/docs/content/docs/{index,dispatch,events,retention}.mdx`, `/home/gianpaj/github/gianpaj/agentcaller-io/apps/docs/content/docs/billing.mdx` (new), `/home/gianpaj/github/gianpaj/agentcaller-io/apps/docs/content/docs/meta.json` | Explain live funding modes, limits vs usage/debt, cents/rounding, schedule attribution, setup/recovery and x402 blocker. One canonical billing guide; link elsewhere.                                                                                                                            | Examples/schema validation, links and targeted formatting. Update significant decision note lifecycle when shipped.               |

Minimal UI language: **“Pay as you go. No upfront charge.”** Explain: “Allow this
integration to use AgentCaller for up to $10 per calendar month. You pay for
actual usage, collected automatically from your saved card.” Substitute the
approved currency/limits and actual calendar. Label “Used”, “Reserved for
scheduled calls”, “Remaining allowance”, “Unpaid” and “Collected”. State that
card setup can require bank verification and that revocation cancels pending
calls while consumed usage remains payable.

Do not require changing the operator-only new-call screen for agent API billing.
If customer portal submission is included, explicitly add Stripe selection to
`calls/new/actions.ts`, `page.tsx` and `call-form.tsx`; do not remove the operator
gate globally. This is optional after agent onboarding works.

### MVP OAuth and remote MCP files

Extend the existing verified-session profile helper in
`/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/portal.ts` with
`ensureClientProfileForUser()`. It creates one default customer profile for a
verified new UID, preserves disabled/manual legacy accounts, and never grants
operator or billing authority. Add `portal.test.ts` plus real-DB unique-UID and
concurrent-first-login tests. OAuth consent calls this helper after verifying
the human session, not from an unauthenticated MCP body.

| File                                                                                                                        | Work                                                                                                                                                                                                                  | Dependencies and verification                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/mcp.ts` (new)                                            | Register all six MVP tools over shared billing/call functions. Preserve input/idempotency on resumable billing setup; provide protocol-aware URL elicitation and ordinary-link fallback.                              | MVP phase 1 foundation with phase 2 billing integration; current/legacy/no-URL clients and complete agent onboarding acceptance.               |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/mcp/route.ts` (new)                                      | MVP OAuth-authenticated stateless remote HTTP transport; Origin/host validation, request-local tenant state and durable billing setup status rather than an open payment request.                                     | SDK transport probe and target-host onboarding before MVP release; expired token and reconnect tests.                                          |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/lib/mcp-auth.ts` (new)                                       | Validate OAuth issuer/JWKS/audience/expiry/client binding, resolve the previously consented connection and application permissions. Reauthorization/refresh must not create another grant.                            | Phase 0 issuer/target-host probe; phase 1 token, refresh/revocation, foreign audience/client and identity-binding tests.                       |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/.well-known/oauth-protected-resource/mcp/route.ts` (new) | Publish the canonical MCP resource and trusted issuer metadata; transport challenges advertise matching discovery. Use issuer-supported client registration for the tested host.                                      | MVP host discovery/registration/PKCE/resource test; reject browser/foreign-service tokens and token passthrough.                               |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/src/app/oauth/consent/page.tsx` and `actions.ts` (new)           | Validate issuer authorization request, support first-time human sign-in/profile provisioning, and approve tool access for the verified client. Keep spending consent distinct and preserve a safe login continuation. | Supabase supported authorization details/approval APIs; new user, PKCE/redirect, denied consent, concurrent profile creation and revoke tests. |
| `/home/gianpaj/github/gianpaj/agentcaller-io/apps/docs/content/docs/mcp.mdx` (new)                                          | Tested host/protocol matrix, OAuth connection, setup URL fallback and safe same-key retries.                                                                                                                          | End-to-end verified host names only.                                                                                                           |

If audience customization needs a Supabase access-token hook, specify its exact
supported API/SQL and deployment configuration after the issuer probe; do not
add an unverified token hook or new issuer service merely to complete a file
list. This is a phase 0 MVP release dependency; lower billing layers can be
tested independently, but the customer release cannot omit OAuth/MCP.

## 13. Phased roadmap and acceptance gates

| Phase                                   | Deliverable and dependencies                                                                                                                                                                                                    | Acceptance and verification                                                                                                                                                                                                                                                                                                         | Principal risk                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 0. Validate launch dependencies         | Prove issuer audience/client binding and a target MCP host's discovery/registration flow. Verify telephony answer/metering/limits, approve remaining tariffs and confirm how the USD 10 exposure cap is enforced.               | Demonstrate PKCE/resource-bound OAuth with the chosen issuer; controlled answered/no-answer/provider-loss scenarios verify metering and cleanup. Record host/protocol support and remaining tax/price decisions.                                                                                                                    | An incompatible issuer/host or unbounded, unmeasured telephone leg blocks the MVP.                            |
| 1. OAuth and MCP foundation             | Shared contracts/schema; OAuth resource server, discovery, validated human consent, first-time profile provisioning and consented agent connections. Register the six tools with safe not-ready results until billing is wired. | Eligible new human connects from the tested host without an API key/operator profile edit. Foreign/expired tokens and denied OAuth consent cannot access another tenant or schedule a call. Refresh/reconnect preserve identity and connection.                                                                                     | Tool access mistaken for spending permission; account or client mix-up.                                       |
| 2. Agent-to-billing setup and controls  | Hosted card setup, owner-bound setup URLs, separate spending consent, verified webhook activation, human limits/revoke/card UI and MCP setup/status tools.                                                                      | First schedule request returns native URL elicitation or a normal link. Correct human approves limits and saves a card with no payment; wrong human cannot. Agent polls readiness and retains the original key. Both URL-capable and fallback clients pass.                                                                         | Setup attaches to the wrong human/connection or lost sessions cannot resume.                                  |
| 3. Budgeted scheduling and usage        | Exact connect scheduling; atomic full-job holds; funding checks at admission/dispatch; late usage evidence and revocation/cancellation. Depends on phases 0–2.                                                                  | Same original MCP request creates exactly one call/reservation. Concurrent calls cannot exceed USD 10 total exposure or approved customer limits. Confirmed business answer is charged despite failed handoff; no answer/unknown are distinct. Customer calling stays disabled until invoicing passes.                              | Overspend, duplicate dial, incorrect answer metering or cancel/end races.                                     |
| 4. Monthly invoices and MVP release     | One invoice/account/month; Stripe-owned collection/retries/emails/hosted recovery; reconciliation/access gating; complete OAuth-to-call-to-invoice acceptance.                                                                  | From an unconnected MCP host and eligible first-time user, complete OAuth, setup/card consent, ready polling, idempotent scheduling, multiple calls and one aggregate payment. Verify failed payment/SCA, revoke, wrong-user URLs, both elicitation paths and x402/operator regressions. Launch only after every prior gate passes. | Duplicate invoices, missing consent/tax controls or an incomplete agent onboarding path.                      |
| Future. Link Agent Wallet compatibility | After the MVP, verify the merchant/invoice/token/approval compatibility checks in section 17. No wallet implementation is included in phases 0–4.                                                                               | Official support or a test-mode proof establishes payment against the same invoice, prevents automatic-card/wallet double collection, and reconciles refunds/disputes. Re-review scope before implementation.                                                                                                                       | Unsupported token/invoice integration or purchase-scoped credentials mistaken for reusable billing authority. |

These phases are implementation increments within one MVP. There is no separate
API-only customer launch before OAuth/MCP onboarding. Lower layers can ship
behind disabled admission while development proceeds. Native URL elicitation
can fall back to an ordinary setup link, but OAuth identity, human consent,
status polling and safe original-request retry are mandatory from launch.
Keep Stripe payment recovery on Stripe and preserve the existing x402/operator
routes. Runtime/provider tests still gate paid service; a working tool wrapper
alone does not demonstrate the full MVP.

## 14. Testing plan and environment

### Offline mocks and unit tests

- OAuth/MCP onboarding: unauthenticated discovery, validated issuer request,
  first-time verified profile creation, consent denial, client/subject binding,
  audience/issuer/expiry checks, PKCE/redirect protection, refresh/reconnect,
  disabled accounts and revoked connections. Tool access without a spending
  grant returns billing setup required and cannot reserve or dial.
- SDK request contract: no amount/line items in setup, exact Customer binding,
  permitted metadata, separate test/live config, stable creation keys and no
  unsupported Checkout `usage` parameter.
- Setup states: duplicate creation, Session persisted late, browser forged
  success, wrong UID/customer/method/environment, abandoned SCA, replaced card,
  expired/revoked request and stale generation webhook.
- Raw signature verification with a generated Stripe test signature: body
  modification, missing signature, expired timestamp, wrong endpoint secret.
  Synthetic unit fixtures are minimal and contain no real payloads or secrets.
- Quotes and limits: integer-only input, exact tariff/rounding, zero/unknown
  connection, two legs, six attempts, duration overflow, grant/account min caps,
  stale price, UTC/DST boundaries and cross-month credit exposure.
- Invoice issuance/reconciliation: draft holding, explicit invoice-item binding,
  total validation, explicit invoice payment-method selection, finalize-before-payment,
  failure/action-required/paid events, zero/subminimum, partial amounts, credit
  notes, out-of-band paid marks, refund states and disputes. Assert no direct
  PaymentIntent creation/confirmation, application payment retry or client-secret
  response. Stripe recovery is acceptance-tested, not reimplemented in mocks.
- MCP: current multi-round-trip, legacy URL elicitation, empty/form-only/no
  capabilities, decline/cancel, fallback links, dropped notification and retry
  after setup with original idempotency key. No charge from `action: accept`.
- x402 regression: original 402 challenge/header, malformed signature rejection,
  verify/settle payloads unchanged, generic minimum arithmetic unchanged, paid
  connect still blocked and operator never enters either collection adapter.
  Do not describe mock adapter tests as proof CDP supports current semantics.

### Real disposable PostgreSQL tests

Mocks cannot establish race safety. Use independent database connections, as
each `createDatabase()` instance has pool size one. Apply all migrations to
fresh and existing-history fixtures. Run races with a barrier so requests
actually overlap:

- Concurrent first OAuth logins create one profile/connection; a foreign client
  or guessed account cannot claim an existing tenant. Token refresh creates no
  duplicate billing authorization and revoke/refresh cannot restore access.
- Two reservations for the last allowance; same-key duplicates; unique failure
  rollback; request fingerprint conflict; no call on rejected reserve.
- Multiple grants sharing one account; future-period holds; no credit reset at
  month boundary; cap lowering versus admission; revoke versus dial/accept.
- Concurrent finalizers and cancel/late-end; unknown metering; usage after
  operator-confirmed cleanup; orphaned reservations and counter reconciliation.
- Duplicate event inserts, processor crash/lease recovery, distinct event IDs
  referring to one SetupIntent/Invoice, stale generation setup.
- Two closers/drains and crashes around invoice creation, item attachment and
  finalization; immutable closed-period amount, paid-before-response,
  failure-after-paid and credit-note/refund replay. Assert one Invoice and one
  usage item per period; no deadlocks under the common lock order.
- Composite FK rejects cross-tenant connection, account, grant, period and call
  associations even if application code is bypassed; RLS denies anon access.
- Financial evidence survives permitted content deletion; unpaid service cannot
  lose its reconciliation references.

### Stripe test mode / CLI

Do these only during approved implementation testing, never during this plan.
Use isolated Stripe test credentials/sandbox, test customer identities and owned
call destinations. Do not run live-mode API calls.

1. Start the platform locally. Run `stripe listen --forward-to
localhost:3000/api/stripe/webhook` in another terminal; use the listener's
   signing secret for local testing, not the deployed endpoint secret.
2. Through the real AgentCaller consent/setup UI, create a real **test-mode**
   Session. Complete normal and 3DS setup using Stripe's documented test cards.
   Verify Customer/SetupIntent/PaymentMethod associations through the server.
   Check no PaymentIntent/charge was created by enrollment.
3. Finish setup without visiting success URL, visit success URL before webhook,
   replay the same test event using CLI/Dashboard resend and expire/cancel setup.
   Generic `stripe trigger` fixtures are useful for delivery mechanics but do
   not prove application account binding; use actual app-created objects for
   acceptance.
4. Drive billing periods with an injected application clock/admin fixture in the
   isolated test environment. This design has no subscription clock; do not
   assume Stripe Test Clocks advance the local ledger or one-off retry calendar.
5. Create one aggregate draft invoice, check explicit item/Customer/default-card
   association and total, then finalize into Stripe automatic collection. Prove
   one invoice/payment for several calls. Test no invoice for zero/waived usage
   and no implicit small-amount/customer-balance carry-forward.
6. Use documented off-session authentication/decline fixtures. Confirm setup can
   succeed while invoice payment fails. Check invoice events suspend paid calls;
   complete recovery through Stripe's hosted invoice page, not a local form.
   Replace the saved card through setup and verify ownership/invoice overrides
   without application payment retries. Payment must not revive revoked grants.
7. Verify the chosen Stripe tier/settings for one-off Smart Retries, failed-card
   emails and hosted links; test the supported failure/recovery path and any
   documented simulation limits. Do not build an app retry scheduler to simulate
   unavailable test-mode timing. Stripe test emails/receipts may need previews
   or explicit manual procedures; no delivery assumption is a release check.
8. Create test credit notes/refunds/disputes using Stripe's supported workflow;
   replay events, fault-inject create/attach/finalize response loss and reconcile
   invoice totals, collected amounts, remaining debt, credits and refunds.
   Test collection-consent withdrawal actually disables invoice automation.
   Keep fixtures free of actual customer data.

Select current fixtures from [Stripe testing documentation](https://docs.stripe.com/testing)
at implementation time; do not copy unverified card-number folklore into tests.
Live carrier validation remains separate from Stripe test-mode validation.

### Browser and complete workflow

Add a small browser E2E suite under
`/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/e2e/billing.spec.ts`
with a future pinned Playwright dev dependency/config only when this phase
starts. Test two distinct human accounts and named agents. Cover login return,
wrong-account link, consent, pending webhook, limits, revoke, card replacement,
invoice links, hosted SCA recovery and original-call retry. Mock Stripe for routine CI; run
the hosted-Checkout acceptance path against Stripe test mode separately.

The end-to-end release fixture starts from an unconnected MCP host and an
eligible human with no AgentCaller profile. Complete discovery, OAuth sign-in,
profile creation and tool-access consent; then request a next-day connect call,
follow owner-bound billing setup, approve spending and save a card without
payment. Poll readiness and retry the original request with the same key.
Accept several budgeted jobs, charge confirmed business-answer usage (including
failed handoff), release unused holds and collect one monthly invoice. Run
native URL elicitation and ordinary-link variants, including browser/host closure,
token expiry and reconnect. No API-key copying, administrator profile linking
or direct REST-only substitute can satisfy this release test.
Also run an existing x402 request and operator connect test to confirm routing
is unchanged. Use mocked telephony for CI, then separately authorize owned-number
PSTN tests in each enabled business/callback language. English and Spanish paths
need independent checks; Italian connect behavior needs its own checks too.

### Configuration to add during implementation

Add server-only `BILLING_SETUP_TOKEN_SECRET`, an independently generated secret
of at least 32 bytes, for reproducible short-lived setup links. Do not reuse the
API-key pepper, cron secret or Stripe signing secret. Include it in lazy setup
configuration validation and token-rotation tests.

| Variable or external setting                | Scope and requirement                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STRIPE_SECRET_KEY`                         | Platform server only; `sk_test_…` locally/test, live key only after release approval.                                                                                                                                                                  |
| `STRIPE_WEBHOOK_SECRET`                     | Per-environment signed-event endpoint; local CLI secret differs from deployment. Support documented rotation without logging values.                                                                                                                   |
| `STRIPE_API_VERSION`                        | Fixed validated `2026-09-30.endive` implementation baseline, matching selected SDK and webhook format. Could be a code constant rather than mutable environment setting.                                                                               |
| `STRIPE_BILLING_ENABLED`                    | Default false; controls new Stripe-funded service. Webhooks, accrued usage and existing debt processing continue when admission is off.                                                                                                                |
| `NEXT_PUBLIC_APP_URL`                       | Existing canonical origin; setup/return and AgentCaller billing-page URLs come from configured origin. Stripe hosted invoice URLs are retrieved server-side only for the authenticated owner.                                                          |
| `CRON_SECRET`                               | Existing secret for billing/webhook drain; do not reuse it as webhook signing secret.                                                                                                                                                                  |
| Existing database/Supabase/LiveKit settings | Existing schema and provisioned provider setup remain required. No Stripe credentials on voice worker.                                                                                                                                                 |
| OAuth issuer/resource settings              | MVP requirement: exact Supabase issuer/JWKS/discovery and canonical MCP resource; registered target client/redirect and supported scopes/registration. Verify in phase 0, configure before launch, and keep issuer secrets outside host/model context. |
| Merchant limits/terms                       | Suggested defaults live in validated deployment policy or account snapshots; production prices/credit caps, agreement version, billing email/receipt business details and tax policy require explicit configuration.                                   |

Configure Stripe Invoicing for automatic card collection with the approved
retry count/duration, failed-payment emails and hosted payment links. Verify
feature availability on the selected tier and the verified billing email.
Disable partial payments, automatic short-payment forgiveness and unintended
credit-balance application for the MVP. These are Stripe account/invoice settings,
not new application retry environment variables or scheduled payment jobs.
Record the chosen settings and test-mode limitations in the deployment runbook.

Register `/api/stripe/webhook` for the pinned snapshot event version and only
the event types used by the reducer: `checkout.session.completed`,
`checkout.session.expired`, `setup_intent.succeeded`,
`setup_intent.setup_failed`, `setup_intent.canceled`,
`invoice.created`, `invoice.finalized`, `invoice.finalization_failed`,
`invoice.payment_failed`, `invoice.payment_action_required`,
`invoice.payment_succeeded`, `invoice.paid`, `invoice.updated`,
`invoice.voided`, `invoice.marked_uncollectible`, `invoice.deleted`,
`payment_method.detached`, `customer.updated`,
`credit_note.created/updated/voided`, `charge.refunded`,
`refund.created/updated/failed`, `charge.dispute.created/updated/closed`.
Do not subscribe to PaymentIntent lifecycle events to build a parallel payment
state machine; invoice events/current retrieval own collection reconciliation.
Verify exact supported names against
the pinned SDK event catalog during implementation. No subscription webhooks.
An event type being enabled never means every object it mentions belongs to an
AgentCaller account; stored-object association checks still apply.

After implementation, run scoped typechecks/tests during each phase, mandatory
disposable-DB tests for billing races, then repository `pnpm typecheck`,
`pnpm lint`, `pnpm test`, `pnpm format:check`, `pnpm build` and both DB suites at release.
For implementation changes to `.tsx`, run the affected platform/docs package's
lint script and fix its findings.
Report baseline failures distinctly. Current source includes the worker bundler;
do not repeat the August missing-build-output diagnosis without reproducing it.
This planning review performs document validation only.

## 15. Blocking decisions and safe defaults

### Blocks a paid pilot

- **Approved customer tariff.** Business answer is confirmed as the charging
  trigger, including an answered call whose handoff fails. Exact fees, rounding,
  tax treatment and service-fault credits remain open. Country-level tariff
  coverage and carrier overruns need evidence; no arbitrary $0.50 call promise.
- **Provider safety and metering.** Verify duration enforcement, room cleanup,
  actual end observations and provider reconciliation in deployed LiveKit/Telnyx.
  Confirm recording disabled at both providers. Missing evidence must not be
  billed as the minimum or silently treated as free.
- **Merchant and legal scope.** Stripe account/currency eligibility, variable
  off-session agreement, customer countries, consumer cancellation/refund rules,
  tax invoices and financial retention require a concrete merchant decision.
- **Financial risk operations.** The per-account unpaid-exposure cap is confirmed
  at USD 10. Set an aggregate pilot exposure ceiling, write-off/refund authority
  and operator recovery contact. Card setup cannot guarantee future funds.
- **Deployment operations.** Confirm applied migrations, worker deployment,
  exact scheduler frequency, provider credentials, webhook reachability and
  monitoring. The repository alone cannot attest to those resources.
- **Multi-customer call identity.** Existing connect prompts hardcode Gianfranco.
  Pass validated customer identity and disclosure before serving other humans.
- **Veterinarian example.** Decide which administrative requests fit the current
  regulated-services exclusion. Restrict the pilot to clearly allowed business
  connection requests until that policy is approved.

### Blocks the MVP OAuth and agent-onboarding release

- Confirm issuer availability, resource audience/client binding, discovery,
  registration and refresh/revocation in the deployed project and target host.
  A failed probe blocks the MVP; it does not defer OAuth to a later release.
- Provide first-time sign-in/profile creation for eligible humans and safe OAuth
  and billing login continuations. A pilot eligibility allowlist is acceptable;
  manual database linking or copying an API key is not the customer flow.
- Verify native URL elicitation where supported and a normal-link fallback,
  durable setup polling and safe retry/reconnect. Do not promise universal host
  support or conflate OAuth tool consent with spending authorization.

### Calling-scope and reservation proposals still under review

Worst-case holds across all allowed attempts and the initial `connect_me` task
scope remain proposals. The user's review did not select a different reservation
policy or confirm expansion to autonomous tasks. Keep those choices explicit
before implementation; do not add unsupported call types to complete onboarding.

### Proposed defaults that can proceed after review

USD only; UTC calendar months; one verified human/profile; one active saved card;
one shared account allowance with narrower integration grants; $10 suggested
monthly allowance and $1 suggested per-call limit, separate from the confirmed
USD 10 unpaid-exposure cap; seven-day schedule horizon;
one reservation month per connect job; no cross-month automatic retry; no
recording; no partial payments or automatic short-payment forgiveness; one-off
Stripe Invoicing with configured Stripe-owned retries/emails and hosted recovery;
zero and below-minimum months create no invoice/charge; ordinary setup/status URL fallback always
works; no automatic balance, top-up or threshold collection.

## 16. Smallest production-worthy demonstration

Ship a capped **OAuth/MCP-to-billing connect-me MVP** after phases 0–4. An eligible
human starts from their MCP host, signs in or creates an account through the
configured identity provider, and approves the named integration's tool access.
The authenticated agent requests a scheduled call and receives an AgentCaller
billing setup URL through native elicitation or the ordinary-link fallback.

The same verified human approves spending limits and future variable charges,
then saves a card in hosted Stripe setup with no payment. Verified server events
activate the matching spending grant. The agent polls readiness and retries its
original call request with the same idempotency key. Several calls reserve
budget atomically, charge confirmed business-answer usage and release unused
holds. USD 10 bounds the account's total unpaid usage plus reservations. One
monthly Stripe invoice collects actual usage; Stripe handles payment recovery.
AgentCaller reconciles the invoice and controls further service. A revoked grant
stays revoked after payment. Existing x402/operator routing and blockers remain.

OAuth, first-time eligible account onboarding, MCP tools, owner-bound billing
setup, polling/reconnect and safe request resumption are all MVP requirements.
API-key REST remains available for existing integrations; it cannot substitute
for the agent onboarding release test. Native elicitation improves navigation
and is used only when negotiated. Host payment/action approvals still apply.

Exact prices, reservation sizing/retry defaults and first calling-task scope
remain release review items.
Subscriptions, MPP, crypto custody, prepaid balances, top-ups and AgentCaller
wallet infrastructure are outside the MVP. Link Agent Wallet is a separately
scoped future merchant payment option under the checks below.

## 17. Future payment option: Link Agent Wallet

### Purpose and current evidence

Evaluate accepting Link Agent Wallet as an additional way to pay for AgentCaller
service after saved-card monthly Invoicing ships. AgentCaller acts as the seller;
it does not build a wallet for agents or take custody of user funds. Ordinary
Link checkout availability does not establish Agent Wallet compatibility.

Stripe's checked wallet guide describes customer-approved spend requests that
produce purchase-scoped Link Pay Tokens, shared payment tokens or single-use
virtual cards. It lists US/Canadian buyers and allows sellers outside those
countries. Those documented purchase flows are not evidence of reusable saved
billing credentials or an ongoing monthly allowance.
[Link Agent Wallet spending guide](https://docs.stripe.com/agentic-commerce/agents/link-agent-wallet/use-link-wallet-pay-online).

Link wallet OAuth authorizes an agent to access the buyer's Link wallet. It is
separate from the AgentCaller OAuth connection, human spending grant and Stripe
merchant Customer. Do not pass one issuer's token to another service, merge
identities by email or treat wallet purchase approval as a new AgentCaller grant.
[Link wallet OAuth](https://docs.stripe.com/agentic-commerce/agents/link-agent-wallet/oauth).

### Invoice compatibility gates before implementation

| Check                                  | Required evidence / behavior                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supported merchant acceptance path     | Verify which wallet credential can be used with AgentCaller's exact Stripe account/API version and a one-off invoice. Check whether the hosted invoice page supports the relevant Link Pay Token/WebMCP flow, whether an SPT can pay the invoice through a supported API, or whether the only supported path is an ordinary card payment. Do not infer support from generic Checkout or Link logos.  |
| Same invoice, no duplicate debit       | A wallet payment must discharge the existing account/month invoice and reconcile its amount paid/remaining. If a separate payment object is required, prove Stripe's supported invoice payment-association flow and accounting before choosing it. Never create an independent charge and mark the invoice paid without payment evidence.                                                            |
| Automatic collection ownership         | Decide whether wallet payment is an alternative selected before invoice finalization or a supported recovery option on an existing invoice. Coordinate with Stripe's automatic saved-card attempts; verify already-processing payments before exposing another payment path. A late wallet approval and automatic card retry must never collect twice. No parallel application payment-retry engine. |
| Approval timing and variable amount    | Verify the spend request's approved amount, currency, merchant, expiry and credential lifetime cover the finalized invoice. Do not request a purchase credential during initial setup and assume it remains valid a month later. Test invoice adjustments, credit notes and any required new approval. Unattended wallet budgets are not an assumed capability.                                      |
| Credential reuse and consent           | Never save a single-use virtual card/token as the account's reusable monthly card or use it for another invoice. Paying one invoice does not grant later spending or automatic collection authority. Keep the MVP saved-card/allowance enrollment path intact.                                                                                                                                       |
| Tenant and merchant binding            | Bind a supported payment to its account, invoice, Customer and verified agent connection using server-side references. Wallet credentials cannot select a different account or invoice. Verify seller restrictions, amount/currency and buyer eligibility without exposing the underlying buyer credentials to the model or logs.                                                                    |
| Events, retries and reconciliation     | Test duplicate/late approvals, expired/declined spend requests, SCA, response loss, paid-before-response, partial amounts and repeated invoice events. The invoice remains the collection record; unresolved state does not permit a second payment or release credit exposure prematurely.                                                                                                          |
| Refunds, credit notes and disputes     | Prove refunds/credit notes/disputes remain linked to the original invoice/payment and work after a single-use credential expires. Prevent a refund plus duplicate payment or an overlapping dispute refund. No future wallet credit balance is introduced.                                                                                                                                           |
| Availability, pricing and host support | Confirm current buyer/merchant geography, Stripe access/tier, fees, target agent capabilities and supported test-mode fixtures. Check regional service availability independently of the existing saved-card Stripe integration.                                                                                                                                                                     |

The hosted invoice page and invoice payment-association APIs are investigation
starting points, not proof that every wallet token is accepted.
[Hosted Invoice Page](https://docs.stripe.com/invoicing/hosted-invoice-page),
[Attach a payment to an invoice](https://docs.stripe.com/api/invoices/attach_payment).
Shared-token direct payment is another documented wallet flow; do not introduce
MPP merely to add this future option.
[Wallet machine-payment flows](https://docs.stripe.com/agentic-commerce/agents/link-agent-wallet/machine-payments).

Deliver a small compatibility record with official API evidence and isolated
Stripe test-mode scenarios before proposing implementation. If invoice
compatibility is unproven, retain saved-card collection and label Agent Wallet
support as unavailable. No wallet SDK, credential storage, new funding enum,
schema migration or live wallet transaction is part of the MVP implementation
scope. An invoice payment-channel choice would not require duplicating call
execution or weakening the USD 10 exposure cap.
