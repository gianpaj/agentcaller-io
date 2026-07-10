# AgentCaller MVP Design

## Goal

AgentCaller lets an AI agent make an outbound business call, complete an allowed task, and return a structured result. The MVP supports English and Spanish calls to Spain and the United States. It supports reservations, appointments, availability checks, and information requests. It does not support purchases, card data, regulated services, emergencies, or automatic redialing.

## Architecture

The repository becomes a Turbo monorepo with three applications:

- A Next.js platform app on Vercel serves marketing at `/`, the authenticated developer portal at `/app`, and the control-plane API at `/api`.
- A separate Fumadocs app serves documentation from `docs.agentcaller.io`.
- A Node.js LiveKit agent runs in LiveKit Cloud in `eu-central` and `us-east`. It uses Telnyx SIP trunks, xAI STT, Grok dialog logic, and xAI TTS.

Supabase provides PostgreSQL and GitHub OAuth. Drizzle manages database access and migrations. Cloudflare R2 stores consented recordings. The platform app dispatches a regional LiveKit job; LiveKit creates the outbound Telnyx SIP participant and runs the agent in an isolated call room.

## API and payment contract

`POST /api/v1/calls` requires an API key, idempotency key, E.164 destination, requested language, optional allowlisted xAI voice ID, duration limit of at most 1,800 seconds, USDC ceiling, and a typed task payload.

The first valid unpaid request returns x402 payment requirements. The caller retries with a Base payment authorization. AgentCaller uses CDP batch settlement: it authorizes the requested ceiling before dispatch and settles the measured connection fee plus started minutes after the call ends. The active rate-card version is saved with the call. The service rejects a dispatch with no active destination rate.

The API exposes list, detail, cancellation, transcript, recording, and deletion operations. Call state (`queued`, `dialing`, `in_progress`, `completed`, `failed`, `cancelled`) remains separate from payment state (`authorized`, `settling`, `settled`, `failed`). Signed, replay-protected webhooks announce state and settlement changes. The developer portal configures only the verified webhook endpoint, calls-per-minute limit, active-call limit, and call logs.

## Call behavior and retention

Every call announces that AgentCaller is an automated assistant and states the purpose. It requests recording consent. Consented recordings remain in private R2 for seven days; redacted transcripts remain for 30 days. A developer can delete a call only as one atomic operation. The operation removes task data, results, events, transcript, recording, and provider artifacts. AgentCaller retains only a non-content settlement receipt for reconciliation.

The agent ends a call after success, explicit refusal, voicemail, unsupported request, provider failure, budget exhaustion, or duration expiry. It never redials automatically. It validates a structured result before publishing it; incomplete tasks return a failure or clarification-needed outcome.

## Release and verification

Staging uses isolated Supabase, LiveKit, Telnyx, R2, and Base Sepolia resources. It must pass schema, state-machine, payment, deletion, webhook, and tenant-isolation tests. Controlled English and Spanish test calls in both regions must cover no answer, voicemail, cancellation, declined recording, limits, and settlement failure. Production starts with a capped Base-mainnet pilot after Spain and US calling, disclosure, recording, and retention review.
