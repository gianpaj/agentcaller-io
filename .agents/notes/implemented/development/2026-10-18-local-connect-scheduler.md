# Local connection scheduler and failure logs

## Decision

Root `pnpm dev` runs `scripts/dev-connect-scheduler.mjs` alongside the platform
through Turbo's `with` task setting. It posts to the existing authenticated
connection drain on localhost:3000 at startup and every 30 seconds. It reads
the platform's `.env.local`; an exported `CRON_SECRET` takes precedence.

The loop awaits each request, bounds requests at 30 seconds, and aborts on
SIGINT or SIGTERM. Idle success is quiet. Connection refusal during startup
is reported once until recovery; HTTP errors, timeouts, and failed cleanup
remain visible. Direct package dev commands require a separate
`pnpm dev:scheduler` process. Production uses an external recurring trigger.

An in-process Next.js timer was rejected because hot reload and multiple
server processes can create duplicate timers. Submission-only dispatch was
rejected because it cannot handle retries and crash cleanup.

Platform dispatch, authorization, claim, and cleanup failures identify their
stage and available call/attempt IDs. Worker callbacks report HTTP status,
timeout/network classification, invalid responses, and transport retry count.
Logs exclude raw errors, response bodies, secrets, and task contents.
Dispatch failures retain the existing no-redispatch rule; callback transport
retries reuse the same event ID.

## Verification

Mocked scheduler tests cover startup refusal, authenticated ticks, HTTP errors,
malformed responses, timeout recovery, overlap prevention, and shutdown.
Worker and platform tests cover failure context, secret omission, replay-safe
transport retries, dispatch failure, and cleanup accounting.

A temporary Turbo workspace and mock HTTP endpoint verify one scheduler starts
with `pnpm dev`, sends an authenticated tick, and stops on Ctrl+C. Workspace
tests, both application typechecks, worker build, and targeted formatting pass.
The 45 PostgreSQL integration tests require a disposable database and are skipped
by the default workspace test command.
