# Bounded connect-me workflow

Date: 2026-09-18

## Evidence

The platform dispatched and dialed with `waitUntilAnswered: false`; the worker
started its session before answer. No retry or handoff existed. The payment
adapter sends `batch-settlement` to CDP as variable capture, with a one-hour
maximum timeout. This cannot safely fund a multi-attempt, multi-leg job.

The holaBrisa `feat/telnyx-inbound-telephony` plan and integration, including
correction `77e89f9`, cover inbound provisioning. They supply useful credential
and attribution patterns, not an outbound workflow or current account evidence.

## Decisions

- Keep one call/authorization, with PostgreSQL job, attempt, leg and event-receipt
  rows. Row locks serialize cancellation, scheduling and worker commands.
- Only confirmed busy/no-answer schedules a fresh attempt. Never reuse a terminal
  attempt. Unknown dispatch/dial outcomes stop instead of risking duplicate calls.
- The worker owns SIP creation for all tasks. The platform only dispatches.
- Private callback room, DTMF 1 acceptance, silence both AI sessions, then move the
  callback participant. The worker retains supervision after the join.
- LiveKit AMD plus conversational agreement is fallible. No claim of robust
  human detection or Telnyx Voice API AMD on a SIP connection.
- Reserve worst-case quoted usage for both legs. Do not refund reservations
  during the job. Measured usage derives from observed SIP answer/disconnection;
  missing observations remain unknown. No legacy settlement of connect jobs.
- Block paid connect-me creation until a supported expiry-aware payment adapter
  is verified. Operator-funded testing has separate audited authorization, with
  no x402 receipt or settlement. See the operator funding decision below.
- Use LiveKit SIP duration limits and scheduler cleanup. They are not verified
  Telnyx carrier guarantees. Repeat cleanup for ambiguous and cancelled attempts;
  do not infer failure from an empty room or resend a dial command.
- Geographic business destinations and Spanish mobile callbacks only. Recording
  is disabled. Independent authorized caller IDs prevent destination spoofing.
- Bundle workspace TypeScript into the worker entrypoint; native SDK dependencies
  remain external. Avoid a second call-control system or cross-repository imports.

## Open constraints

The paid-task payment adapter, country-level rate precision, live provider configuration,
worker deployment, scheduler operation, SIP limit enforcement, private DTMF,
participant movement and multilingual detection require verification before a
live pilot. Paid connect-me creation returns an actionable 503. Job deletion remains
blocked until cleanup and financial reconciliation can be proven.

Setup, provider sources and the controlled live procedure are canonical in
[dispatch documentation](../../../../apps/docs/content/docs/dispatch.mdx).

## Offline verification

- Workspace typecheck, tests and build pass; 97 ordinary tests pass.
- `pnpm test:connect-db` passes 23 additional tests on disposable PostgreSQL 17,
  applying all five migrations. No provider credentials or calls are used.
- The bundled worker imports successfully under Node.
- Full formatting check reports 67 files. The only changed file among those is
  the pnpm-generated lockfile, whose existing formatting is preserved; its diff
  adds six dependency lines. Other changed supported files pass Prettier.
- Initial docs typecheck requires its generated `collections/server` module;
  the docs build generates it. No live-account configuration was changed.

## Operator-funded tests

The user authorizes a distinct operator-funded mode for testing without x402.
An explicit funding header selects the mode; a server-managed `is_operator`
profile, a disabled-by-default deployment switch, both exact destination
allowlists and a per-job deployment cap authorize it. Authorization is persisted
on the call with the principal, time and budget before scheduling. The provider
accounts fund usage; `not_required` describes customer payment state only.

No payment payload or settlement row is fabricated. Paid connect jobs retain the
unsupported-scheme blocker. Worker permissions re-check role and configuration;
revocation stops active workers on their next heartbeat. Scheduler reconciliation
continues for stale workers even when new dispatch is disabled. This avoids
coupling a controlled operator pilot to a customer-billing rewrite.
