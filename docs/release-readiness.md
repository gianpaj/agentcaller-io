# Remaining work and release readiness

Updated: 2026-10-24. This is the canonical checklist for outstanding work.

The combined implementation has passed workspace checks and disposable database
tests. No paid release has been accepted. MCP and Stripe paid admission default
to disabled. Offline tests do not establish deployed issuer, Stripe or carrier
behavior. See the [integration evidence](../.agents/notes/implemented/discovery/2026-10-23-agent-discovery.md)
and [billing decisions](../.agents/notes/proposed/billing/2026-10-18-stripe-implementation.md).

## Next task

Prove resource-bound OAuth issuance and one target MCP host's connection flow in
an isolated deployment. Start with a human who has no AgentCaller profile and
use ordinary setup links and polling. Keep paid admission disabled while proving
identity and tool consent. An incompatible issuer or host blocks the customer
onboarding path before any optional integration work is useful.

## Required for the paid connect_me pilot

All items below are open. A check needs linked evidence, not an implementation
claim. Detailed scenarios are in the [billing plan](../plans/2026-10-18-stripe-agent-authorized-billing.md#14-testing-plan-and-environment).

### 1. Verify OAuth and MCP interoperability

- [ ] Verify the configured issuer issues tokens with the exact MCP resource
      audience, human subject and OAuth client identity. Exercise discovery, client
      registration, PKCE, refresh, reconnect and revocation in a named target host.
- [ ] Complete first-time human sign-in, profile creation and tool consent
      without manual profile linking or API-key copying. Denied consent, foreign
      credentials and revoked connections must remain blocked.

Close with the deployment/version, issuer configuration, tested host and protocol,
and recorded end-to-end results. HTTPS/loopback redirect support must fit the host.

### 2. Approve commercial and calling policy

- [ ] Approve supported countries, languages and business tasks; caller IDs,
      consent/disclosure and the human introduction; and any regulated-service
      boundary. Keep saved-card scope limited to connect_me and recording disabled.
- [ ] Approve USD tariffs, rounding, taxes, service-fault credits, full-job
      reservations and retry defaults. Confirm coverage for both legs and all costs.
- [ ] Set pilot eligibility, an aggregate merchant exposure ceiling, and financial
      retention/refund responsibilities. The enforced per-account exposure cap is $10.

Close with an approved policy and tariff version, matching rate-card configuration,
and named merchant/operator responsibilities.

### 3. Add human-flow browser coverage

- [ ] Add the missing browser E2E suite for login/setup continuation, two-human
      isolation, explicit consent, pending webhook state, limits, revocation, card
      replacement and private invoice links.
- [ ] Exercise setup-link resumption and unchanged-request retry after browser
      or host closure. Browser return and opening a link must not grant spending.

Close with automated browser results. Static markup and mocked server-action
tests do not cover the complete human workflow.

### 4. Complete hosted Stripe acceptance

- [ ] Use isolated Stripe test mode to save a card with no enrollment charge,
      including authentication, abandoned/expired setup and card replacement.
- [ ] Collect one monthly invoice covering several calls. Exercise payment
      failure, action-required recovery, configured retries/emails, event replay,
      delayed events and lost create/finalize responses.
- [ ] Verify customer/card/invoice associations, exact totals, one invoice/item
      per month and successful allocated card-payment evidence. Record simulation
      limits; mocks cannot establish Stripe account configuration.

Close with the tested setup-to-invoice flow and reconciliation evidence. Stripe
owns payment attempts and recovery; no application payment-retry engine is needed.

### 5. Verify telephony bounds and metering

- [ ] Run explicitly authorized owned-number tests for answer, busy/no-answer,
      voicemail/uncertainty, failed callback/handoff and private DTMF acceptance.
- [ ] Verify per-leg duration limits, hangup, cancellation, revocation, expiry,
      worker loss and uncertain dispatch cleanup. Confirm recording is off at both
      application and provider levels.
- [ ] Compare both legs' connected/end observations and costs with provider
      records, including billable business answers without a successful handoff.
      Test each enabled business and callback language independently.

Close with bounded-call evidence and reconciled provider records. Prefix checks,
local mocks and a successful conversation do not establish carrier safety.

### 6. Complete personal-data retention and deletion

- [ ] Define retention for destinations, task text, names, transcripts and provider
      artifacts, separately from required financial evidence. Recording being off
      does not remove this personal data.
- [ ] Implement and test deterministic, retryable connect_me deletion/expiry
      after provider cleanup and financial reconciliation. Its deletion endpoint
      currently rejects requests; identify which financial facts must survive.

Close with an exercised deletion/expiry workflow covering PostgreSQL and every
provider that stores the pilot's data, including retries and observable failures.

### 7. Prove financial and deployment operations

- [ ] Verify applied migrations, configured secrets/origins, compatible worker
      deployment, authenticated cron frequency and signed webhook reachability.
- [ ] Add or verify monitoring for delayed events, metering holds, room cleanup,
      stalled issuance, debt and ledger/invoice discrepancies; name the responder.
- [ ] Exercise operator recovery for unknown usage/issuance, refunds, credits,
      disputes and write-offs. The code blocks financial adjustments for review;
      resolution and audit procedures still need proof. Implement missing controls
      where a supported operator procedure cannot resolve a block safely.
- [ ] Define the 48-hour unknown-metering escalation and daily reconciliation
      procedure. Confirm rollback stops admission while preserving accounting and
      consented outstanding liabilities.

Close with a deployment runbook, responsible operators and recovery-drill results.
No successful payment or recovery action may restore revoked spending authority.

### 8. Record complete release and discovery acceptance

- [ ] Run the full human OAuth → billing setup → quote → bounded call → usage →
      monthly invoice flow in the isolated environment. Include reconnect and legacy
      x402/operator routing regression checks. Resolve or explicitly limit failures.
- [ ] Verify the combined deployment's docs hostname, OpenAPI, Auth.md, robots,
      sitemap, API catalog and homepage Link headers. Re-run the public scanner and
      record its actual results. Historical discovery-only results do not validate
      the combined implementation.
- [ ] Record acceptance against an exact version/deployment and pilot scope
      before enabling paid admission. Verify the enabled flags and configuration
      rather than assuming repository defaults describe a deployment.

Auth.md registration detection can remain an explicit limitation: human OAuth
onboarding does not implement autonomous agent registration.

## Optional follow-ups

These are not prerequisites for the bounded saved-card pilot:

- Native MCP URL elicitation and completion notifications; ordinary links and
  durable polling are implemented.
- Link Agent Wallet, subject to the plan's invoice-compatibility investigation.
- Autonomous Auth.md registration and credential issuance.
- Deferred effective-date limit changes and human reauthorization of a revoked
  integration; current limits/revocation behavior must remain explicit.

## Broader prototype gaps outside this pilot

- Generic reservation/appointment/availability/information tasks need validated
  task-specific results and independently tested language behavior.
- Generic x402 variable usage authorization and settlement need a supported
  payment scheme and durable crash/replay recovery. This is separate from Stripe.
- Broader task/destination policy needs enforceable validation before dialing.
  Recording, consent capture, redaction and retention across any additional
  storage/providers require implementation before those features are enabled.

## Maintaining this checklist

Keep open/closed work here. Keep detailed acceptance procedures in the plan,
implementation rationale and evidence in agent notes, and API usage in app docs.
Link those documents to this file instead of maintaining another release list.
When closing an item, record its date and evidence link, tested version/environment,
and any scope limits. Reopen it when code or deployment changes invalidate that evidence.
