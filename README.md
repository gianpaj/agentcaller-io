# AgentCaller.io

<https://agentcaller.io>

AgentCaller is an API for AI agents that need to call a business when no useful
online workflow exists. The intended MVP handles restaurant reservations,
appointments, availability checks, and information requests in English or
Spanish, with per-call time and spend limits.

> [!IMPORTANT]
> This repository is a pre-production prototype. Its main components exist and
> type-check, but the system is not ready to place or bill unattended production
> calls. See [Feasibility](#feasibility) for the release blockers.

## Product boundary

An accepted task should be narrow, reversible, and easy to verify. The intended
MVP supports calls to Spain and the United States and excludes purchases,
payment-card handling, regulated services, emergency calls, and unrestricted
automatic redialing. The `connect_me` exception below permits bounded retries
only for confirmed busy/no-answer outcomes.

The target lifecycle is:

1. A client submits a typed task, an API key, an idempotency key, and call limits.
2. The platform validates the request and an x402 payment authorization.
3. The platform records the authorization and dispatches a regional LiveKit job.
4. The voice worker owns the call from dialing through hangup and reports
   provider-derived timing plus a typed result.
5. The platform settles actual usage, persists the terminal state, and delivers
   signed webhooks.

The current implementation reaches parts of this flow, but not the complete
contract.

### Bounded connection task

`connect_me` connects a Spanish or Italian geographic business number to a
Spanish mobile, with independently configured business and callback languages.
Its contract, PostgreSQL attempt/leg ledger, scheduler, worker and private
press-1 handoff are implemented and tested offline. Operators can use the
[operator-funded test mode](apps/docs/content/docs/dispatch.mdx#operator-funded-testing)
without x402. It requires an enabled server-managed operator profile, an explicit
funding header, exact destination allowlists and a per-job spend cap
(`CONNECT_OPERATOR_MAX_USD`, default $5).
**Paid connect-me requests remain blocked** by the unsupported payment scheme.
Operator jobs record their authorization and `paymentState: not_required`; they
do not create a payment receipt or settle through x402.

The platform reserves the worst-case quoted cost of both legs before each
attempt and does not release that hold. Admission rejects a cap that cannot
fund every `maxAttempts` reserve. Only confirmed busy/no-answer can schedule
another attempt. Unknown
dial outcomes, refusal, voicemail, uncertain classification and failed handoff
stop the job. Local observation of SIP answer/disconnection drives leg usage;
missing cost stays null. Reservations are deliberately not refunded between
attempts. They bound quoted usage, not an unverified carrier invoice.

The business and mobile remain in separate LiveKit rooms until callback DTMF 1
and a durable acceptance check. Both AI sessions are silenced before the mobile
moves into the business room. The worker remains alive to supervise cleanup.
Recording is disabled. LiveKit AMD plus conversational signals are fallible;
Spanish/Italian accuracy and all real PSTN behavior remain unverified.

See [dispatch setup and controlled test procedure](apps/docs/content/docs/dispatch.mdx)
and the [decision record](.agents/notes/implemented/telephony/2026-09-18-bounded-connect-me.md).
The existing API exposes job details and cancellation; the portal shows outcomes
and a cancel action. Job deletion is blocked pending provider cleanup and payment
reconciliation.

## Repository map

The active product is a pnpm/Turborepo:

| Path                  | Responsibility                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `apps/platform`       | Next.js API, developer portal, authentication, call ledger, settlement, and webhook delivery |
| `apps/voice-agent`    | LiveKit realtime voice worker                                                                |
| `apps/docs`           | Fumadocs developer documentation                                                             |
| `packages/contracts`  | Shared Zod request and state definitions                                                     |
| `packages/database`   | Active Drizzle schema and database client                                                    |
| `supabase/migrations` | Append-only database migration history                                                       |
| `docs/specs`          | Historical product and implementation designs                                                |
| `.agents/notes`       | Dated review evidence and architectural decisions                                            |

The root `src`, `api`, `openapi.yaml`, `orval.config.ts`, and `drizzle.config.ts`
belong to the earlier Vite waitlist application. Turbo does not build that
surface, and its OpenAPI document does not describe the active call API. Treat it
as legacy until it is removed or deliberately restored.

## Architecture

The overall split is appropriate for the product:

- The platform is the control plane. It authenticates clients, validates tasks,
  records state, settles payment, and publishes webhooks.
- The voice worker is the realtime data plane. It should own SIP setup, answer
  detection, the conversation, timing, and hangup.
- Shared contracts define every message that crosses that boundary.
- PostgreSQL is the durable ledger for call, payment, and delivery state.

Supabase provides PostgreSQL and GitHub OAuth. LiveKit Cloud connects the worker
to Telnyx SIP trunks and xAI inference. Coinbase's x402 facilitator is intended
to handle Base payments. Cloudflare R2 is intended for consented recordings.

Keeping call state separate from payment state is a sound choice: a call can end
while settlement is still pending or failed. The existing idempotency key,
single-settlement constraint, tenant-scoped API access, per-client webhook
secrets, and webhook retry lease are also useful foundations.

## Feasibility

The product is technically feasible, but the current repository is a prototype
rather than a working MVP.

| Area                    | Assessment                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Control plane           | Good foundation; authentication, idempotency, rate limits, state, and webhook delivery exist                           |
| Voice path              | Worker owns dialing and waits for SIP answer; connect-me detection and handoff require live verification               |
| Payment                 | Blocked; `batch-settlement` is used like variable capture, but that behavior belongs to x402 `upto`                    |
| Task result             | Blocked; the worker returns a generic end reason instead of a schema-validated result                                  |
| Hangup                  | Connect-me deletes both LiveKit rooms on every exit, including refusal, timeout, and cancellation                      |
| Recording and retention | Incomplete; consent capture, recording creation, redaction, and scheduled expiry are not implemented                   |
| Deployment              | Worker build emits bundled `dist/main.js`; deployment and provider limits require live verification                    |
| Compliance              | Requires a launch review and enforceable destination, consent, disclosure, recording, and task policies                |
| Verification            | Offline contracts, worker/provider mocks and PostgreSQL concurrency tests exist; real PSTN scenarios remain unverified |

The most important provider mismatches are documented upstream:

- x402 describes `upto` as the usage-based authorization scheme and
  `batch-settlement` as a payment-channel flow. See the
  [x402 scheme overview](https://github.com/x402-foundation/x402) and
  [Coinbase network support](https://docs.cdp.coinbase.com/x402/network-support).
- LiveKit recommends waiting for the outbound call to be answered, binding the
  session to the SIP participant, and handling SIP failures explicitly. See
  [LiveKit outbound calls](https://docs.livekit.io/telephony/making-calls/outbound-calls/).

Before any live pilot, obtain jurisdiction-specific review. AI-generated voice
calls can trigger consent and disclosure rules in the United States, and Spain
has separate restrictions for automated and commercial calls. Starting points
include the [FCC's AI voice ruling](https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf)
and [Spain's calling rules](https://www.boe.es/buscar/act.php?id=BOE-A-2023-15071).
These links provide context, not legal advice.

## Smallest path to a credible pilot

1. Make the voice worker deployable and give it sole ownership of dialing,
   answer detection, connected duration, terminal outcomes, and hangup.
2. Define typed results for each task and validate them before publishing a
   successful terminal event.
3. Replace the payment flow with a supported variable-capture scheme, then test
   authorization, settlement, expiry, replay, failure, and cancellation against
   Base Sepolia.
4. Enforce task and destination policy before dispatch. Treat model instructions
   as conversation guidance, not a security boundary.
5. Either implement consented recording and deterministic retention or remove
   recording from the MVP. Test deletion as a resumable cross-system workflow.
6. Run controlled English and Spanish calls that cover answer, no answer, busy,
   voicemail, refusal, cancellation, timeout, and provider failure before a
   capped pilot.

## Local development

### Prerequisites

- Node.js 22 or newer
- pnpm 10.16.1, as pinned by `packageManager`
- Corepack when pnpm is not already available on `PATH`

The full call flow also needs provisioned Supabase, LiveKit, Telnyx, Coinbase
Developer Platform, Base, and Cloudflare R2 resources.

```bash
corepack enable
pnpm install --frozen-lockfile
```

If an asdf shim reports that no pnpm version is configured, install pnpm 10.16.1
through asdf or put Corepack's pnpm shim before asdf on `PATH`. Turbo launches
workspace scripts through `pnpm`, so `pnpm` itself must be resolvable.

Copy the application-specific examples and fill in local credentials:

```bash
cp apps/platform/.env.example apps/platform/.env.local
cp apps/voice-agent/.env.example apps/voice-agent/.env
```

The platform dashboard and email/password login require a database URL, a
Supabase URL, and a Supabase publishable key. The canonical names are
`DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`. The Vercel
Supabase integration names `POSTGRES_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are accepted as fallbacks. Set
`NEXT_PUBLIC_APP_URL` for a production or non-Vercel deployment. The remaining
blocks in `apps/platform/.env.example` are validated when their API, scheduler,
telephony, payment, or recording path runs. Do not add placeholder provider
credentials to make the dashboard load.

`DATABASE_URL` must point to the PostgreSQL database where the
`supabase/migrations` files were applied. When Supabase Auth and Supabase
PostgreSQL share a project, confirm that the project reference in the database
connection matches `SUPABASE_URL`. For Vercel, copy the **Transaction pooler**
URI from the Supabase Connect panel, replace its password placeholder, and set
it for the matching Vercel environment. A database URL left by another storage
integration will authenticate the user and then fail when the portal queries
`client_profiles`.

The database package applies libpq semantics to `sslmode=require` connection
strings so Supabase pooler traffic remains encrypted without requiring its CA
certificate in the Vercel runtime. Connections that request `verify-ca` or
`verify-full` keep certificate verification enabled and must provide the
appropriate CA configuration.

Connect the Supabase resource to every Vercel environment that runs the
platform. Feature branches use Vercel's **Preview** environment even when they
act as staging. Integration variables scoped only to **Production** are absent
from preview functions. Redeploy after changing the resource connection scope.

Password recovery uses `NEXT_PUBLIC_APP_URL` or Vercel's stable deployment
origin and returns through `/auth/callback`. In Supabase **Authentication → URL
Configuration**, set the Site URL to the stable deployment and allow these
redirect URLs:

```text
http://localhost:3000/auth/callback*
https://agentcaller-git-feat-bounded-connect-me-gianpaj.vercel.app/auth/callback*
```

The trailing `*` permits the allowlisted callback's recovery query string. Add
the callback pattern for each stable deployment. For changing Vercel preview
hosts, Supabase also supports a preview wildcard such as
`https://*-gianpaj.vercel.app/**`. Keep the narrow callback pattern for
production. The password-reset email template must use
`{{ .ConfirmationURL }}` or otherwise honor `{{ .RedirectTo }}` so the
application-provided callback is preserved.

`NEXT_PUBLIC_APP_URL` is optional for Vercel previews. The platform uses
Vercel's stable `VERCEL_BRANCH_URL`, which requires **Automatically expose
System Environment Variables** in the Vercel project settings. Each push gets a
new immutable deployment URL, but its branch URL remains stable.

Never commit populated environment files. Apply the SQL files under
`supabase/migrations` in timestamp order through the project's Supabase
environment before running the platform.

Run each long-lived application in its own terminal:

```bash
pnpm --filter @agentcaller/platform dev
pnpm --filter @agentcaller/docs dev
pnpm --filter @agentcaller/voice-agent dev
```

## Validation

Run the workspace checks from the repository root:

```bash
pnpm typecheck
pnpm test
pnpm test:connect-db # isolated disposable PostgreSQL; requires Docker
pnpm format:check
pnpm build
```

The 2026-08-18 review records baseline failures. The worker build emits its
entrypoint; repository-wide formatting drift remains. When changing a scoped package, run its checks directly
as well:

```bash
pnpm --filter @agentcaller/platform typecheck
pnpm --filter @agentcaller/platform test
pnpm --filter @agentcaller/voice-agent typecheck
pnpm --filter @agentcaller/voice-agent test
```

See
[`docs/specs/2026-07-10-agentcaller-mvp-design.md`](docs/specs/2026-07-10-agentcaller-mvp-design.md)
for the original MVP design and
[`.agents/notes/2026-08-18-architecture-review.md`](.agents/notes/2026-08-18-architecture-review.md)
for the evidence and decisions behind this review.
