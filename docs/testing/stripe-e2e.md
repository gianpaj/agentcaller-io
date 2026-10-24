# Mocked Stripe journey tests

Run from the repository root after installing dependencies:

```bash
pnpm --filter @agentcaller/platform exec playwright install chromium
pnpm test:stripe-e2e
pnpm test:stripe-e2e stripe-journey.spec.mjs
pnpm test:stripe-e2e admission.spec.mjs billing.spec.mjs
```

Use a worktree without `.env`, `.env.local`, `.env.development` or
`.env.development.local` under `apps/platform`. The launcher rejects these before
starting resources because Next would merge local configuration into the synthetic
environment. `.env.example` is allowed.

Docker must be running. The launcher owns PostgreSQL, a loopback provider
coordinator and a Next development server. It applies all migrations and supplies
synthetic credentials. No provider account or payment credential is required.
The launcher removes its container, processes and temporary browser diagnostics
on completion or failure. Run one suite per worktree at a time; use separate
worktrees for concurrent development.

## Coverage and boundaries

The complete journey starts with no AgentCaller profile or billing records.
A fresh human signs in and approves agent tools, then separately approves
spending and saves a simulated card. The agent quotes and schedules two calls.
The actual voice worker reports both connected legs, private DTMF acceptance,
handoff and hangup through authenticated HTTP. Real scheduler cleanup and billing
produce one monthly invoice and reconcile allocated successful card cash.

The ES fixture tariff is 10 cents per connection plus 20 cents per started
connected minute. Two positive sub-minute legs cost 60 cents; two calls produce
one 120-cent invoice. These are customer tariff assertions, not provider expenses.

| Tests                                                         | Application behavior covered                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `identity.spec.mjs`                                           | Discovery, fresh consent, denied access, token validation, refresh/reconnect, revocation and two-human isolation        |
| `admission.spec.mjs`                                          | Setup-required without a call/hold, unchanged request retry, spending limits and fresh-browser setup resumption         |
| `billing.spec.mjs`                                            | Signed setup evidence, delayed/duplicate events, card ownership/replacement, monthly recovery and exact cash allocation |
| `call-failures.spec.mjs`                                      | Busy/no-answer fees, refused handoff, foreign DTMF, transport replay, cancellation and revocation before acceptance     |
| `cleanup.spec.mjs`                                            | Unresolved cleanup retains the hold and prevents invoicing until reconciliation                                         |
| `stripe-journey.spec.mjs`                                     | Fresh user/agent through two calls, usage, one invoice, payment replay and the human's private invoice link             |
| `boundaries.spec.mjs`, `runtime.spec.mjs`, `*egress.spec.mjs` | Real SDK/worker routes, separate billing clock and blocked outbound requests                                            |

Next routes/actions, MCP, signature/ownership checks, the worker flow, accounting
and PostgreSQL run for real. Supabase/GitHub, Stripe, LiveKit/SIP and model/audio
responses are fake. Existing focused Vitest/database suites retain detailed
rounding, races, long timeouts and legacy funding coverage.

## Shared fixture contract

Provider state lives in `apps/platform/e2e/support/coordinator.mjs`.
`control(path, input)` authenticates fixture operations on that separate server;
the application exposes no testing or time-travel endpoint.

- `state`: identity IDs, Stripe objects/request summaries, dispatches, deleted rooms
  and unexpected outbound origins. Do not upload raw object snapshots.
- `reset`: resets providers. An automatic browser fixture also resets its owned
  database and seeds the ES tariff before each test.
- `command`: provider scenario operations using `target`, `action` and arguments.
  Identity and Stripe helpers own their operations; LiveKit's `cleanup-failure`
  toggles room-deletion failure for reconciliation tests.
- `stripe`: forwards the real SDK request to the small stateful Stripe fake.
- `violation`: records blocked traffic. Teardown rejects unexpected requests and
  unsupported Stripe methods.

`installBrowserGuards(context)` protects every additional browser context.
Inherited Node preloading protects the application, driver, API client and workers.
Only the exact application/coordinator origins can pass through. Stripe HTTPS
requests and Next's development version lookup receive local responses; fake
hosted pages retain Stripe's HTTPS origins and the application's URL validation.

The voice bridge consumes actual dispatches and leaves `connectRequest` unmocked.
Room movement/deletion produces both legs' disconnect observations. Application
success, cleanup, usage and collected counters are never fabricated in SQL.

`runAccounting(at)` invokes the actual billing pipeline with optional ISO billing
time in a Vitest process. It does not advance app, JWT or webhook clocks.
`runVoiceScenario(scenario)` launches the voice bridge; its interface is documented
in `apps/voice-agent/e2e/README.md`. Short real-time observations keep the
application's timestamp checks intact.

CI runs `.github/workflows/stripe-e2e.yml` with no provider secrets. Skipped E2E
cases fail the result gate; its seven regression tests run with `pnpm test`.
Traces/screenshots are disabled and temporary browser output is deleted.
The complete journey prints only its source revision, mocked scope and accounting
totals as JSON.

Hosted OAuth, Stripe/SCA, real telephony, actual provider expenses and production
release acceptance remain in [release readiness](../release-readiness.md).
