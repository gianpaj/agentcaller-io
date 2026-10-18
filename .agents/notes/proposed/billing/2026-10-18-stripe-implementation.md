# Agent billing implementation

Date: 2026-10-18. Branch: `codex/stripe-agent-billing`.
Integrated base: `feat/landing-page-refresh` at `13ab75e`.

## Decisions

Implement the [approved plan](../../../../plans/2026-10-18-stripe-agent-authorized-billing.md)
in tested commits. OAuth tool consent and spending consent remain separate.
Customer paid calling stays disabled until approved tariffs, issuer resource
binding, provider limits and the full MVP acceptance flow are verified.
Saved-card monthly Invoicing is the MVP; Link Agent Wallet stays future scope.

## Evidence

Supabase Auth JS 2.110.1 exposes the
authorization-details, approval and denial APIs needed for consent. Its official
[token example](https://supabase.com/docs/guides/auth/oauth-server/token-security)
uses `aud: authenticated`; this does not meet the MCP resource requirement.

## Progress

- Enrollment, reservation and invoice persistence uses server-only tables with
  account/tenant composite keys, checked money and states, immutable finalized
  usage/closed totals, append-only audit facts and a USD 10 maximum credit cap.
  Legacy tariffs require explicit USD/pricing approval; no rates are backfilled.

- Isolated worktree created; original uncommitted planning files preserved.
- Dependencies installed with the pinned package manager and frozen lockfile.
- OAuth/MCP foundation: resource metadata, strict asymmetric JWT validation,
  separate tool consent, verified first-time profile creation, durable connection
  uniqueness and human revocation. API keys retain a distinct principal.
- The v2 server package includes stateless legacy compatibility; no deprecated
  legacy package or Express dependency is needed. Current requests require
  matching protocol, method and tool-name headers and the per-request envelope.
- Six MCP tools call the billing application functions: setup, readiness, quote,
  reservation, integration-scoped call status and usage. Linked API keys use
  `/api/v1/billing/{setup,status,quote,calls,usage}`; unlinked keys cannot spend.
- Human enrollment exchanges a setup token for an HttpOnly continuation cookie,
  checks the verified owner, records unchecked-form consent and caps, then opens
  a card-only Stripe Checkout Session. GET and browser return never activate a
  grant. Authoritative Session/Intent/card verification activates it once.
- Checkout create operations have persisted generations, a two-minute lease,
  stable Stripe keys and a 23-hour retry boundary. Checkout expires after 31
  minutes so request latency does not violate Stripe's 30-minute minimum.
- Admission commits the call, job, full-job usage reservation and period counter
  under the shared account lock. Accepted-key replay precedes mutable quote and
  schedule checks. Unknown connected usage retains its hold; confirmed terminal
  jobs without dial intents release their reservation exactly once.
- Worker dispatch, claims and permissions check current account, connection,
  credential, grant, reservation and UTC period authority. The account lock
  serializes revocation with dialing permissions. Revocation cancels queued and
  active calls; cleanup runs through the scheduler. Confirmed late observations
  may settle held usage without reopening a terminal call.
- Human control functions reject limit reductions below committed liabilities,
  revoke spending separately from tool access, withdraw collection consent and
  explicitly link an owned API key to an owned integration.
- Paid calling remains disabled. Human control screens, event processing and
  monthly issuance are the remaining integration work.
- Billing contracts require cents and accepted quote versions, preserve legacy
  dollar inputs and reject mixed money/claimed authority. Domain functions cover
  full-job quotes, confirmed connected usage, aggregate rounding, unknown holds,
  merchant overruns, shared exposure, UTC/DST schedules and request fingerprints.
- Setup tokens are reproducible HMAC values bound to request, generation and
  expiry; storage needs only a digest. Enrollment stores the digest and checks the verified owner.
- Stripe Node 23.0.0 matches API `2026-09-30.endive`. Its installed Checkout
  creation type requires `allowed_payment_method_types: ["card"]`; the legacy
  `payment_method_types` request field is absent. The plan uses the supported
  filter. Setup verification checks both metadata generations, Customer, mode,
  currency, environment, succeeded off-session intent and attached-card ownership.
- Signed webhook ingestion persists only event routing, deduplicated by mode/ID.
  It accepts events while admission is off. Events remain pending until the
  account/setup/invoice processors exist; no provider resources are registered.
- Draft invoice parameters hold automatic collection off, exclude pending items
  and select a verified card. No invoice is created or collected in this increment.
- Human portal access rejects OAuth `client_id` and anonymous credentials, even
  when Supabase verifies their user. A valid delegated token is insufficient for
  settings, operator calls or human consent. The MCP route supports bearer
  preflight and exposed challenges only for exact configured browser origins.
- Empty leg evidence keeps a metering hold. Queued jobs that never acquired a
  dial intent need an explicit release path, not inference from an empty list.
- The integrated connect lifecycle accepts end observations after expiry while
  still denying observations after operational terminal state. Preserve the
  expiry handling; post-terminal accounting remains a billing integration task.

## Verification

- Workspace typecheck, tests and build pass across all five packages. Offline
  tests pass: platform 327, contracts 98, worker 41, database 2 and scheduler 6.
- Disposable PostgreSQL passes 14 onboarding/enrollment/reservation tests and 46 existing
  connect tests, including upgrades with a historical x402 call. Tests use
  independent connections; OAuth profile ownership and event RLS are enforced.
- Lint exits successfully with zero findings. The shadcn plugin reports that its
  configured UI alias has no directory; this configuration belongs to the base.
- Repository formatting reports 51 files: 50 are byte-identical to the base;
  the modified pnpm lockfile also fails formatting on the base. Changed source
  and documentation pass targeted formatting. No unrelated formatting is applied.
- Initial docs typecheck requires generated Fumadocs collections; generation
  resolves it. Both Next.js builds and the worker bundle build succeed.
- No provider setup, Stripe API transaction, remote migration, deployment, live
  call or target-host OAuth acceptance test has been performed.

## Open release checks

- Confirm resource-bound Supabase issuance and target MCP host behavior.
- Approve customer tariff, rounding, tax, reservation/retry and calling scope.
- Verify carrier bounds, metering, multi-customer prompts and Stripe settings.
- Complete card setup, atomic reservations, usage and monthly invoice acceptance.
