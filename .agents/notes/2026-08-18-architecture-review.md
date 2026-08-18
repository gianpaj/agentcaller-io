# Architecture review notes

Date: 2026-08-18

## Scope

Review AgentCaller's architecture and its feasibility for the product's main
purpose: let an AI agent place a bounded call to a phone-only business, complete
an allowed task, and return a useful result.

This is a working record of evidence and decisions. The README is the concise
contributor-facing source of truth.

## Evidence reviewed

- Product intent in `README.md` and
  `docs/specs/2026-07-10-agentcaller-mvp-design.md`
- Platform API, authentication, payment, settlement, webhook, storage, and
  portal code under `apps/platform`
- LiveKit worker code under `apps/voice-agent`
- Shared validation and persistence code under `packages`
- Supabase migrations and developer documentation
- Current x402, LiveKit, FCC, and Spanish regulatory documentation
- Recent commits, package scripts, type checks, tests, and builds

## Architecture observed

The active product is a pnpm/Turborepo with three applications:

- `apps/platform`: Next.js control plane, API, portal, ledger, settlement, and
  webhook delivery
- `apps/voice-agent`: LiveKit worker for the realtime conversation
- `apps/docs`: Fumadocs developer documentation

`packages/contracts` contains request schemas, and `packages/database` contains
the active Drizzle model. Supabase migrations are the deployed database history.

The root Vite application, waitlist functions, root OpenAPI document, and root
Drizzle configuration predate the monorepo MVP. Turbo does not build them, and
they do not describe the active `/api/v1/calls` service.

## Findings

### Release blockers

1. The voice-agent build does not emit `dist`. The shared TypeScript config sets
   `noEmit: true`, while the worker's Docker image copies and runs `dist/main.js`.
2. The platform creates the SIP participant with `waitUntilAnswered: false`.
   The worker starts its session and duration clock without waiting for the
   callee, so ringing can be treated as an active call and no-answer outcomes are
   unreliable.
3. The payment code uses x402 `batch-settlement` as a variable capture. Current
   x402 defines that behavior as `upto`; `batch-settlement` uses payment channels
   and off-chain vouchers that this repository does not implement.
4. The worker reports `{ reason: "call_ended" }`, not a result shaped for the
   requested task. A verbal recap and transcript do not fulfill the structured
   result promise.
5. The model has no reliable hangup path. Prompting it to stop does not close a
   LiveKit room or PSTN leg after success, refusal, or an unsupported request.

### Incomplete product behavior

- The prompt asks for recording consent, but no code captures consent, starts a
  recording, writes it to R2, or reports its key.
- No scheduled retention or transcript-redaction job exists.
- Deletion spans R2 and several database operations without an atomic or
  resumable workflow.
- Policy restrictions rely mainly on model instructions. Free-text task fields
  need deterministic validation before a live call.
- The API trusts a client-declared destination country after checking only the
  dialing prefix. It does not establish whether a US destination is a business,
  residential line, or mobile number, nor whether required calling consent
  exists.
- Profiles, API keys, rate cards, trunks, and caller IDs require manual operator
  provisioning. No complete onboarding workflow exists.

### Verification results

- Type checks passed for all five workspace packages.
- The contracts package passed 3 assertions.
- The platform package passed 40 assertions.
- Database, docs, and voice-agent test commands passed with no test files.
- The root Turbo commands could not find pnpm through the local asdf shim; direct
  Corepack package commands worked.
- `pnpm format:check` reports existing formatting drift across 84 files.
- The voice-agent build exited successfully but produced no files.
- The platform build reached Next.js compilation, then the sandbox prevented a
  Turbopack helper from binding a local port. This is an environment limit, not
  evidence of a repository build failure.
- The docs build was stopped after it made no progress for more than a minute in
  the same constrained environment.

## Feasibility decision

The product is technically feasible, and the high-level split between a control
plane, a realtime worker, and shared contracts is appropriate. The present code
is a pre-production prototype, not a working MVP.

The smallest credible architecture gives each boundary one owner:

- The platform authorizes requests, persists the ledger, receives events,
  settles usage, and delivers webhooks.
- The voice worker owns the SIP participant from dialing through hangup and
  reports provider-derived timing and a typed terminal outcome.
- Shared contracts define requests, lifecycle events, and results.
- The database records state transitions and enforces idempotency and settlement
  uniqueness.

## Documentation decisions

- Describe the repository as a pre-production prototype.
- Put the feasibility verdict and release blockers in the README.
- Identify the active monorepo and label the root landing-page stack as legacy.
- Add a root `AGENTS.md` that protects the architectural boundaries and billing,
  tenant, telephony, privacy, and webhook invariants.
- Document existing validation gaps without changing unrelated code.
- Do not add a speculative roadmap or claim functionality that the code does not
  implement.

## Primary external references

- x402 network and scheme support:
  <https://docs.cdp.coinbase.com/x402/network-support>
- x402 scheme definitions:
  <https://github.com/x402-foundation/x402>
- LiveKit outbound call lifecycle:
  <https://docs.livekit.io/telephony/making-calls/outbound-calls/>
- LiveKit xAI integration:
  <https://docs.livekit.io/agents/integrations/xai/>
- FCC ruling on AI-generated voices:
  <https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf>
- Spanish rules for unsolicited commercial calls:
  <https://www.boe.es/buscar/act.php?id=BOE-A-2023-15071>

## Future review rule

Update these notes when a finding is resolved or an architectural decision
changes. Add a new dated file for a separate review rather than erasing this
record.

## Documentation change log

- Replaced the six-line README with a contributor guide that distinguishes the
  target lifecycle, current implementation, release blockers, and smallest path
  to a credible pilot.
- Added a root `AGENTS.md` with active source boundaries, architectural
  ownership, non-negotiable invariants, validation guidance, and repository
  writing and commit conventions.

## Post-change validation

- All five workspace packages passed type checking.
- Contracts passed 3 assertions, and the platform passed 40 assertions.
- Database, docs, and voice-agent test commands passed with no test files.
- Every local path referenced by the README exists.
- `README.md`, `AGENTS.md`, and this note pass the targeted Prettier check.
- The staged three-file diff passed `git diff --check` before commit.
