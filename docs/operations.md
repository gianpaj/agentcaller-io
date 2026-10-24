# Operations

How to configure, test and run an AgentCaller deployment. The public API
documentation for agents and humans lives in `apps/docs`; release gates live in
[release readiness](release-readiness.md).

## Scheduled drains

`apps/platform/vercel.json` runs three Vercel Cron jobs every minute:
`/api/internal/connect/drain`, `/api/internal/billing/drain` and
`/api/internal/webhooks/drain`. Each accepts `GET` (Vercel Cron) or `POST` with
`Authorization: Bearer $CRON_SECRET`. The connect drain is designed for a
30-second interval; one minute is the Vercel Cron minimum. Local development is
covered in the README.

The billing drain returns `{"skipped":"stripe_not_configured"}` while
`STRIPE_SECRET_KEY` is unset. A set but malformed key returns `503`.

## Connect-me deployment

Apply migrations in order and deploy the bundled voice worker before the
platform when shared contracts change. Both deployments must use contracts that
accept `callingWindow: "now"` and the supported mobile destination ranges before
submitting those calls; an older worker cannot parse those tasks.

### Telephony

Configure the worker's `.env.example` values server-side. Use an authenticated
LiveKit outbound trunk targeting Telnyx's documented European signaling endpoint
[`sip.telnyx.eu`](https://sip.telnyx.com/), with SIP credentials and authorized
caller IDs. Trunks are provisioned separately, never per attempt. Both legs use
E.164 destinations. Configure `CONNECT_CALLER_ID_ES`, `CONNECT_CALLER_ID_IT`, and
`CONNECT_CALLBACK_CALLER_ID` separately; none may equal either destination.

Telnyx lists Spain and Italy for
[Local Calling](https://support.telnyx.com/en/articles/6622229-pstn-replacement-local-calling-with-telnyx).
Coverage does not establish account readiness. Associate the SIP connection with
an [outbound profile](https://support.telnyx.com/en/articles/4320411-more-about-outbound-voice-profiles)
permitting both countries, including Spain for the mobile leg; additional account
verification may be required. The dated holaBrisa US/Canada snapshot is not a
current account check. Its inbound integration does not implement this workflow.

Same-country routing needs a Telnyx caller-ID number with Local Calling enabled;
check the specific number's capability. Otherwise use authorized international
caller IDs under the [Telnyx caller-ID policy](https://support.telnyx.com/en/articles/3546251-caller-id-number-policy),
including valid EEA P-Asserted-Identity requirements. Verify SIP connection
header/override behavior with Telnyx. Never spoof the mobile or business number.
The callback mobile is a destination and needs no purchase or port to Telnyx.

### Rate cards

Configure conservative all-in rate cards that cover the exact destination
classes, including mobile termination, provider surcharges and inference.
Before a live mobile-destination test, verify the rate card, outbound routing,
caller ID, recipient consent and disclosure requirements for that country.
Current country-level rates cannot prove an actual Telnyx invoice ceiling.
Missing connection/end observations leave measured cost null; worker loss never
becomes zero usage. Connect jobs cannot use the legacy single-leg settlement
helper.

### Scheduler and logs

PostgreSQL locks and unique indexes serialize drain ticks and worker claims.
Dispatch timeouts are not retried; a 90-second stale lease stops the attempt.
Workers heartbeat every 10 seconds and fail closed when the platform cannot
confirm permission. The connect drain reports `paidCallingEnabled`, which is
`true` only when saved-card paid calling is enabled. Enabled operator jobs can
dispatch either way.

Platform dispatch and cleanup failures log the stage, call ID, attempt ID when
available, and HTTP status or timeout classification. Worker callback failures
also include the command and transport retry number. Logs omit credentials,
request/response bodies, task contents, and raw exception messages. A dispatch
failure never causes an immediate redispatch; lease expiry and cleanup retain
ownership of an uncertain attempt.

Callbacks taking at least one second log `Slow connect operation` with the action,
call and attempt IDs, total time, funding authorization time, command time, HTTP
status and permission result when available. A separate transaction timing splits
connection acquisition plus the `BEGIN` round trip (`transactionStartMs`) from
transaction execution and commit (`transactionMs`). These timings help distinguish
connection contention from slow database work without logging callback contents.

### Call bounds and cleanup

The worker uses the pinned SDK's `waitUntilAnswered`, `ringingTimeout` and
`maxCallDuration` on each SIP leg. These are **LiveKit SIP service limits**, not
Telnyx carrier-enforced guarantees. The upstream SIP service starts its duration
budget during dialing, so ringing can reduce remaining conversation time.
Application phase timers and repeated room deletion provide additional cleanup.
The [LiveKit SIP implementation](https://github.com/livekit/sip/blob/main/pkg/sip/outbound.go)
provides the duration timeout independently of the voice worker.

LiveKit's explicit room-not-found response counts as a successful deletion;
other deletion failures remain visible and retryable. Attempts ending in
`dial_unknown`, `worker_lost`, `cancelled` or `configuration_error` keep repeated
cleanup through the later of their cleanup deadline or 15 minutes after ending,
even when rooms are absent. Room absence does not prove an in-flight dial failed
or resolve provider reconciliation.

The website permits a fresh manual submission after cancellation or a
configuration failure only when the call is terminal and none of its attempts
has a recorded dial leg. A recorded leg preserves the reconciliation block even
after room cleanup. Monitor scheduler failures and its `cleanup.failedRooms`
count; reconcile provider call records before deleting these jobs. No API
idempotency key is documented for this dial method; persisted intent prevents
redial rather than pretending participant identity is idempotency.

### Answer detection and handoff

AMD runs through LiveKit's agent SDK, followed by an explicit conversational
agreement to wait. Telnyx Voice API AMD is not used. Detection is probabilistic,
especially for short greetings, hold music and multilingual menus. Human,
voicemail and uncertain scenarios need controlled tests in both languages.
Callback acceptance is DTMF 1 from the callback SIP participant only; speech and
SIP answer cannot accept. The private-room join follows
[LiveKit's warm transfer workflow](https://docs.livekit.io/telephony/features/transfers/warm/)
and requires working `moveParticipant` support in the deployed LiveKit project.

## Operator-funded testing

The platform pays Telnyx, LiveKit and inference charges. `not_required` means no
customer x402 settlement, not a free call. All destination, window, duration,
retry and spend controls still apply. This mode supports only `connect_me`.

1. Apply every migration in timestamp order. Commit
   `20260918200000_operator_payment_state.sql` before applying the following
   funding migration; PostgreSQL must commit an enum value before using it.
2. Enable the existing client profile associated with your verified Supabase UID
   as an operator using the database owner's connection:

   ```sql
   UPDATE client_profiles
   SET is_operator = true
   WHERE supabase_user_id = '<your verified Supabase auth UUID>';
   ```

   Check that exactly your intended profile was updated. `is_operator` is
   server-managed; browser metadata and request headers cannot grant it.
   Use an AgentCaller API key belonging to that profile. API keys use the
   manual provisioning path: prefix `ac_`, and `api_keys.hash` is the SHA-256 hex
   digest of `API_KEY_PEPPER + ':' + rawKey`. Do not put raw keys in the database.

3. Set these **platform** environment variables:

   ```dotenv
   CONNECT_OPERATOR_CALLS_ENABLED=true
   CONNECT_OPERATOR_MAX_USD=5
   ```

   The default switch is `false`; the default per-job cap is USD 5. Omit
   `CDP_API_KEY`, `X402_PAY_TO` and `X402_USDC_ASSET` for an operator-only deployment.
   Keep the platform and worker configuration described above, plus active
   rate cards for the business country and Spanish callback.

   Migration `20261018160000_personal_test_rate_card.sql` supplies an ES internal
   test quote when no active ES rate exists: USD 0 per connection and USD 0.10 per
   started minute on each leg. It preserves existing active rates and does not
   reactivate a retired version. With the default phase durations, one attempt
   reserves USD 2.50; use `maxAttempts: 1` with the default USD 5 cap.
   This quote is for personal testing and does not establish actual provider
   costs. Replace it with verified all-in rates before accepting paid calls or
   relying on it to cover provider charges. Italian destinations need a separate
   active IT rate card.

4. Deploy the platform and voice worker. After authorizing a controlled test,
   save a `connect_me` request from the public
   [dispatch guide](../apps/docs/content/docs/dispatch.mdx) as
   `connect-test.json`, replacing destinations, expiry and scheduled hours (or
   use `callingWindow: "now"`). Start with `maxAttempts: 1` and a cap no greater
   than the deployment's cap. Submit it from your own terminal:

   ```bash
   curl --fail-with-body "$PLATFORM_URL/api/v1/calls" \
     -H "Authorization: Bearer $AGENTCALLER_API_KEY" \
     -H 'Idempotency-Key: owned-number-test-001' \
     -H 'X-AgentCaller-Funding: operator' \
     -H 'Content-Type: application/json' \
     --data-binary @connect-test.json
   ```

   A `202` response durably queues the job. Reuse the same idempotency key only
   for retries of that submission. No `PAYMENT-SIGNATURE` is needed.

5. The scheduled drain triggers dialing when the calling window permits it,
   including Call now before expiry. To run one scheduler tick manually
   **after authorizing the test**:

   ```bash
   curl --fail-with-body -X POST "$PLATFORM_URL/api/internal/connect/drain" \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

   Keep the scheduler running for retries and crash cleanup. Poll
   `GET /api/v1/calls/{id}` and cancel with `POST /api/v1/calls/{id}/cancel`, using
   the same API key. `fundingSource`, `operatorAuthorizedBy` and the creation
   timestamp identify the recorded authorization; there is no x402 settlement row.

Worker permissions re-check the operator role, enabled profile, and cap.
Revoking the role or disabling the mode stops new dispatch and causes an active
worker to stop on its next heartbeat. Cancellation is the immediate per-job stop
action. Paid users cannot opt into this mode by sending the funding header.
Complete the controlled scenarios below before a post-office call.

## Controlled live validation

For operator-funded testing, x402 is not required. Verify rate coverage,
scheduler, worker image, account verification, outbound permissions, caller IDs
and provider duration behavior before calling. Recording must also be disabled
in the Telnyx outbound profile; application `record: false` cannot override
provider recording.

The operator must obtain explicit authorization and exact owned test destinations,
Spanish callback mobile, caller IDs, business/callback languages, test window,
expiry and spend cap. First run a single attempt between owned numbers. Verify
that the business cannot hear callback prompts or DTMF, voicemail cannot accept,
press 2 stops, press 1 joins, the AI stays silent, and either hangup clears both
legs. Then test busy/no-answer, voicemail, Spanish/Italian menus and uncertainty,
cancellation during each phase, worker termination, dial API timeout, and
provider-enforced duration limits. Compare both leg timings/costs with provider
records. Only after these pass should the owner authorize a post-office call.

## MCP and OAuth

Apply the Supabase migrations in timestamp order. Set `NEXT_PUBLIC_APP_URL` to
the exact application origin and configure the Supabase environment. The
canonical MCP resource is that origin plus `/mcp`.

Configure Supabase's OAuth server with authorization path `/oauth/consent`.
Use authorization code with PKCE and the target host's supported client
registration. The issuer owns registered redirects, code exchange and refresh
tokens. See
[Supabase OAuth setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started).

The platform requires asymmetrically signed ES256/RS256 access tokens with the
configured Supabase issuer, a verified human subject, OAuth `client_id`, expiry,
issue time and the exact MCP resource audience. Generic browser tokens and
tokens with only `aud: authenticated` are rejected. Prove the deployed issuer
can honor resource binding before claiming host compatibility. No host has a
completed end-to-end acceptance test.

`MCP_ENABLED` defaults to `false`. Setting it to `true` enables discovery,
consent and the transport. It does not enable billing or dialing. HTTP is
allowed only on loopback for development. Browser requests must use the
configured application origin or an exact origin in `MCP_ALLOWED_ORIGINS`;
server clients may omit Origin.

Offline tests cover signed-token validation, ownership, constrained login
return, consent denial/replay, discovery and both transport eras. Native URL
elicitation is not implemented. `pnpm test:billing-db` uses a fresh local
PostgreSQL container to test concurrent first login and consent, foreign-owner
constraints, RLS and revocation. These tests do not prove Supabase project
configuration or compatibility with a particular MCP host.

## Stripe billing

Apply migrations in timestamp order, including the separate payment enum
migration. Set independent server-only `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET` and `BILLING_SETUP_TOKEN_SECRET`. Set
`STRIPE_PRICING_VERSION` to a reviewed tariff version and explicitly approve
matching active USD `rate_cards`; legacy rows are not automatically approved.
Keep `STRIPE_BILLING_ENABLED=false` until the release gates pass.

Signed raw webhooks enter `/api/stripe/webhook`; storage retains routing IDs and
safe processing codes, not payment payloads. The billing drain processes events,
usage, periods and invoices. Leases and stable keys recover API delivery
failures; they do not retry payments. Webhook ingestion and accounting remain
available when admission is disabled.

Setup completion verifies the retrieved Checkout Session, a succeeded
off-session SetupIntent, the attached card, customer, environment and consent
generations. Each closed positive month creates one held Stripe draft with one
explicitly attached usage item; unrelated pending items are excluded. The server
verifies ownership, lines, currency and total before finalizing. Provider
overruns block service for review, and unknown timing keeps a hold.

`STRIPE_PORTAL_CONFIGURATION_ID` is optional. AgentCaller refuses to open a
portal configuration that is inactive, belongs to the other Stripe mode, or
enables payment method updates. Invoices charge the card saved through consented
setup, so card replacement stays in that flow.

## Discovery

Add or remove entries in `apps/platform/src/app/sitemap.ts` when indexable public
platform pages change. Keep portal pages, login, password recovery, and tenant
data out of the sitemap. Documentation on a different host belongs in that
host's sitemap.

Keep `/openapi.json` aligned with the public route handlers and shared contracts.
The legacy root `openapi.yaml` describes the waitlist API and is not the
platform's API description.

Discovery describes production only. The catalog, `auth.md`, robots and sitemap
use absolute `https://agentcaller.io` URLs. Previews require Vercel login and
are not meant for agent discovery.

Check the deployed responses for HTTP 200 and their media types: `text/plain`
for robots, XML for the sitemap, `application/linkset+json` for the catalog,
JSON for OpenAPI, and `text/markdown` for authentication instructions. Then run
the public scanner:

```bash
curl --fail-with-body https://isitagentready.com/api/scan \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://agentcaller.io"}'
```

Expect `pass` for `checks.discoverability.robotsTxt`,
`checks.discoverability.sitemap`, `checks.discoverability.linkHeaders`, and
`checks.discovery.apiCatalog`. Record the Auth.md result for the deployed
version. The discovery-only deployment reported `registrationMissing`, because
AgentCaller offers human-approved OAuth, not autonomous agent registration; the
combined MCP and billing deployment has not been scanned. See the
[Auth.md implementation guide](https://workos.com/auth-md/docs/apps). A passing
discovery check does not establish readiness to place or bill calls.
