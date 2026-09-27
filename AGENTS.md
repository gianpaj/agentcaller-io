# AGENTS.md

## Mission

AgentCaller should let an AI agent place a bounded call to a phone-only business,
complete an allowed task, and return a trustworthy result. Optimize for the
smallest system that makes this behavior unsurprising.

This repository is a pre-production prototype. Do not describe unfinished paths
as production-ready or preserve accidental complexity merely because it exists.

## Start here

Before making a material change, read:

1. `README.md` for current status, architecture, and release blockers.
2. `.agents/notes/2026-08-18-architecture-review.md` for review evidence and
   decisions.
3. `docs/specs/2026-07-10-agentcaller-mvp-design.md` for the original product
   intent. Treat it as historical design, not proof of implementation.

## Source of truth

The active product is the pnpm/Turborepo workspace:

- `apps/platform` owns the API, portal, authentication, durable call state,
  payment state, and webhook delivery.
- `apps/voice-agent` owns the realtime voice session and should own the complete
  SIP lifecycle.
- `apps/docs` documents the public API.
- `packages/contracts` owns schemas shared across process boundaries.
- `packages/database` owns the active Drizzle model.
- `supabase/migrations` is the append-only database history.

The root Vite app, `api`, root `openapi.yaml`, generated root API clients, and
root Drizzle config belong to the earlier waitlist site. They are outside the
Turbo workspace. Do not extend them for the call platform.

## Architectural direction

Keep one owner for each hard problem:

- The platform authorizes, records, settles, and notifies.
- The voice worker dials, detects answer, converses, measures, and hangs up.
- Contracts define requests, lifecycle events, and terminal results.
- PostgreSQL enforces durable uniqueness and state.

Prefer explicit state transitions and small functions over extra services,
queues, or abstraction layers. Add machinery only when a measured failure mode
requires it.

## Non-negotiable invariants

### Calls and billing

- Never dial before a verified authorization and its call record are committed.
- One client and idempotency key maps to one call.
- One call has at most one settlement.
- Terminal call states never reopen.
- Keep call state separate from payment state.
- Measure chargeable duration from telephony connection signals, not worker or
  request wall-clock time.
- Bound every PSTN leg with a provider-enforced maximum duration and a reliable
  hangup path.
- Treat provider callbacks and retries as replayable. State transitions must be
  idempotent under races.

### Tasks and agent behavior

- Validate task type, fields, destination, and policy before dispatch.
- Treat client task text as untrusted data. Prompt fencing helps model behavior;
  it is not an authorization or policy boundary.
- Return a schema-validated result for the requested task. A transcript or verbal
  recap is not a structured result.
- Reject purchases, payment-card handling, regulated services, emergencies, and
  automatic redialing except for the bounded `connect_me` task described in
  README.md. Other tasks must never redial automatically.
- Test English and Spanish behavior independently.

### Tenancy, privacy, and outbound requests

- Derive tenant identity from verified credentials or the Supabase auth UID,
  never client-submitted identifiers or mutable profile metadata.
- Scope every client-facing query by tenant.
- Never log secrets, payment payloads, full task data, transcripts, or recording
  URLs.
- Do not record before consent is captured in application state. If recording is
  absent, remove recording claims from product documentation.
- Make retention and deletion deterministic, observable, and retryable across
  PostgreSQL, R2, LiveKit, and telephony providers.
- Preserve per-client webhook secrets, raw-body signatures, replay protection,
  HTTPS-only delivery, redirect blocking, and private-network rejection.
- Revisit destination, consent, disclosure, recording, and caller-ID rules before
  enabling a country or use case. A dialing prefix alone is not a compliance
  check.

### Data and contracts

- Change shared wire formats in `packages/contracts` before changing producers
  and consumers independently.
- Add migrations; never rewrite an applied migration.
- Keep `packages/database/src/schema.ts` aligned with Supabase migrations.
- Preserve database constraints for idempotency, tenant ownership, and unique
  settlement.
- Do not use the legacy root Drizzle config for platform migrations.

## Working method

- Confirm the real constraint before proposing architecture.
- Make the smallest coherent change that completes the requested behavior.
- Avoid unrelated refactors and speculative extensibility.
- Preserve user changes in a dirty worktree.
- Add or update tests for state transitions, retries, provider failures, and
  security boundaries affected by a change.
- Update the README and `apps/docs` when implementation changes make them false.
- Record significant review findings and durable decisions in a dated file under
  `.agents/notes`. Separate evidence, decisions, and open questions. Do not add
  notes for routine edits.
- Save plans and specifications under `plans` with a `YYYY-MM-DD-` filename.
  Do not create `brainstorm/spec` directories.

## Setup and validation

Use the repository-pinned package manager:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Run the full checks when the change warrants them:

```bash
pnpm typecheck
pnpm test
pnpm format:check
pnpm build
```

Use package-scoped checks while iterating:

```bash
pnpm --filter @agentcaller/platform typecheck
pnpm --filter @agentcaller/platform test
pnpm --filter @agentcaller/voice-agent typecheck
pnpm --filter @agentcaller/voice-agent test
pnpm --filter @agentcaller/contracts test
```

The repository has known pre-existing formatting and voice-agent build failures.
Report them accurately. Do not hide them, broaden a scoped task to fix them, or
attribute them to an unrelated change.

Never commit `.env`, `.env.local`, provider credentials, wallet material, API
keys, transcripts, recordings, or populated payload fixtures.

## Commits

Use short commitlint-style messages in the imperative mood:

- Capitalize the subject.
- Keep the subject near 50 characters.
- Do not end it with punctuation.
- Add a body only when it explains useful context.
- Separate the body with a blank line and wrap it at 72 characters.
- Do not include raw diff output.
