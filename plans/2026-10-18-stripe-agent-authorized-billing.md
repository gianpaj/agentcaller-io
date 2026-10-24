# Agent-authorized, pay-as-you-go Stripe billing

Date: 2026-10-18. Updated: 2026-10-24.
Status: implemented and tested offline; paid release remains gated.
Current outstanding work is tracked in the
[release-readiness checklist](../docs/release-readiness.md).

This plan describes the implementation on `codex/agent-discovery`. The
[implementation record](../.agents/notes/proposed/billing/2026-10-18-stripe-implementation.md)
tracks billing decisions and implementation evidence. The
[discovery integration record](../.agents/notes/implemented/discovery/2026-10-23-agent-discovery.md)
records validation of the combined billing, MCP and discovery code.
Neither record establishes hosted Stripe, issuer, MCP-host or carrier acceptance.

## 1. Recommendation and scope

Saved-card postpaid billing uses the existing platform, Stripe Checkout
in setup mode, an AgentCaller spending authorization, PostgreSQL reservations
and usage records, and one Stripe invoice for each nonzero, collectible monthly
total. Stripe Invoicing owns automatic saved-card collection, configured retries,
failed-payment emails and hosted payment/authentication recovery. Keep x402 and
operator funding as explicit, independent modes.
The spending ceiling never represents deposited money.

The MVP includes remote MCP onboarding with OAuth and the complete human billing
setup flow. A person connects an agent, authenticates, approves tool access,
approves an AgentCaller spending allowance, saves a card without payment, and
resumes the original call request. Manual API-key copying or operator account
linking cannot be required for this customer path. Existing API-key integrations
remain supported alongside MCP.

The implemented saved-card calling scope is `connect_me`: reach a business and
connect the human after private callback acceptance. It needs exact scheduling, reliable
usage finalization and explicit funding checks throughout execution. Support for
autonomous reservation/appointment tasks remains a separate scope decision.
Saved-card monthly Invoicing is the MVP collection mechanism; accepting Link Agent
Wallet is a future option with compatibility gates in section 17. No AgentCaller
wallet, subscription, meter service, queue service or carrier migration is needed.

### Confirmed review decisions

| Decision                    | Required behavior                                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP and OAuth at launch     | Remote MCP authentication, human account onboarding and agent-to-billing setup are MVP release requirements. An API-only release does not satisfy this plan.                                                                                         |
| Business answer is billable | Charge confirmed connected business-leg usage even if classification, callback or handoff fails. Human conversation or successful bridging is not a prerequisite. No answer means no connected usage; unknown answer/timing requires reconciliation. |
| Unpaid-exposure cap         | USD 10 (1,000 cents) per account, including unpaid consumed usage and active reservations across billing months. The user's monthly allowance is separate; its suggested $10 default is not a second credit facility.                                |
| Cancellation and revocation | Cancel pending jobs, stop active calls and retain charges for consumed usage. Reject an immediate limit decrease below consumed plus reserved usage; offer explicit cancellation before retrying the limit change.                                   |

Full-job worst-case holds, the existing bounded retry defaults and the
`connect_me`-only scope are implemented with paid admission disabled. Their
commercial approval, tariff coverage and provider acceptance remain release
gates; implemented defaults do not establish approval for paid use.

Success means one verified human connects an integration, approves a recurring
allowance and future variable charges, saves a card without paying, requests
several calls, sees correct usage, and pays one aggregate amount. Paid access
must remain disabled until collection, failure recovery, and provider limits
work. Saving a card alone does not make calling safe to enable.

The code includes OAuth/MCP, enrollment, reservations, usage finalization,
monthly invoicing and human controls. `MCP_ENABLED` and `STRIPE_BILLING_ENABLED`
default to `false`. The remaining operational requirements below are release
checks, not claims that provider configuration or live behavior has been verified.
Link Agent Wallet and native URL elicitation are unimplemented future work.

## 2. Current implementation and evidence

The active pnpm/Turborepo contains the Next.js platform, Fumadocs documentation,
LiveKit voice worker, shared contracts and Drizzle schema. The root Vite app,
waitlist API, root OpenAPI and root Drizzle configuration are legacy.

### Runtime and deployment

- [Platform dependencies](../apps/platform/package.json) pin Stripe 23.0.0,
  `@modelcontextprotocol/server` 2.3.1 and TypeScript 7.0.2. The platform uses
  Next.js 16.3.8 and React 19.3.0. The lockfile owns resolved versions.
- [Worker build](../apps/voice-agent/build.mjs) emits `dist/main.js`; its
  [Dockerfile](../Dockerfile) builds from the workspace root.
- [Drizzle schema](../packages/database/src/schema.ts) and the 12 append-only
  [Supabase migrations](../supabase/migrations) define the active ledger.
  [postgres.js configuration](../packages/database/src/index.ts) uses one
  connection per process instance with prepared statements disabled.
- [Vercel configuration](../apps/platform/vercel.json) schedules connection,
  outbound-webhook and billing drains once per minute. Each drain supports
  authenticated GET and POST. Local development runs the connection scheduler
  every 30 seconds. Provider timing and production scheduling require acceptance.
- [CI workflows](../.github/workflows) and repository scripts are checked in;
  their existence does not establish deployed credentials or provider readiness.

### Identity, API and billing

- [API authentication](../apps/platform/src/lib/auth.ts) checks peppered `ac_`
  key hashes, revocation and enabled clients. `authenticateApiPrincipal()` also
  retains credential and connection identity. Human linking grants a key access
  to an owned integration; an unlinked key has no implicit spending grant.
- [Portal identity](../apps/platform/src/lib/portal.ts) derives ownership from
  the verified Supabase UID and can create a first non-operator profile.
  Delegated OAuth tokens cannot act as human portal sessions. Disabled profiles
  remain disabled. [Login continuations](../apps/platform/src/lib/auth-redirect.ts)
  allow the constrained billing and OAuth consent paths.
- [MCP authentication](../apps/platform/src/lib/mcp-auth.ts) verifies asymmetric
  signatures, issuer, exact resource audience, human subject, OAuth client,
  expiry and consented connection. [Resource metadata](../apps/platform/src/lib/mcp-config.ts)
  advertises the configured Supabase issuer when MCP is enabled. Issuer/host
  compatibility and resource-bound token issuance remain external release gates.
- [Shared contracts](../packages/contracts/src/index.ts) preserve legacy
  `maxAmountUsd` and add strict saved-card inputs with integer `maxAmountCents`,
  accepted `quoteVersion` and optional offset-resolved `scheduledFor`.
- [Call admission](../apps/platform/src/app/api/v1/calls/route.ts) routes
  `stripe_postpaid` to `reserveStripeCall()` in
  [billing usage](../apps/platform/src/lib/billing-usage.ts). It commits the
  call, job, reservation and period counter together and fingerprints accepted
  requests. `submitCall()` retains legacy x402/operator behavior.
- [Scheduling](../apps/platform/src/lib/billing-period.ts) attributes a job to
  its first permissible UTC start month within a seven-day horizon. Call now
  requires one attempt, no `scheduledFor`, and expiry within 30 minutes.
- [Funding authority](../apps/platform/src/lib/billing-authority.ts) checks
  Stripe reservations and current account, connection, credential, grant and
  period at dispatch and worker transitions. x402 `connect_me` remains blocked;
  operator funding retains its separate role, deployment flag and per-job cap.
- [USD tariffs](../packages/database/src/schema.ts) require explicit pricing
  approval. Country rates and the personal-test tariff are not commercial price
  approval. Generic x402 settlement retains its separate limitations.
- [Metering](../apps/platform/src/lib/billing-usage.ts) finalizes confirmed
  connected legs, releases unused full-job holds, and retains unknown evidence
  for reconciliation. Terminal worker observations can complete accounting
  without reopening a call or granting another action.
- [Billing controls](../apps/platform/src/app/app/billing/page.tsx) provide human
  limits, spending revocation, collection withdrawal, card replacement,
  API-key linking and private invoice links. Customer introductions use the
  human-approved name pinned at reservation.
- [Invoices](../apps/platform/src/lib/billing-invoices.ts) close reconciled UTC
  periods, waive positive totals below 50 cents with an audit record, issue one
  held draft/item per collectible month, and verify allocated successful card
  payments. Credits, refunds, disputes and mismatched cash require operator review.
- [Public discovery](../apps/docs/content/docs/discovery.mdx) publishes robots,
  sitemap, API catalog, active OpenAPI and Auth.md. The credential documents
  distinguish API keys from optional human-approved MCP OAuth.

Offline evidence includes shared-contract tests, worker tests, platform tests,
and disposable PostgreSQL suites for billing and connection races. Current
results and the remaining release checks are recorded in the linked notes.

## 3. Decisions and tradeoffs

| Choice                          | Recommendation                                                                        | Reason and alternative                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout setup vs Elements      | Hosted Checkout setup for enrollment and card replacement                             | Stripe hosts enrollment and any setup SCA. Hosted invoice pages handle collection-time payment and SCA recovery. No custom Elements/Stripe.js payment form is needed for this MVP.                                                                                                                                                                                                                          |
| Payments vs Billing             | AgentCaller usage and allowance records plus Stripe Invoicing                         | One-off invoices can collect monthly usage without a subscription. Stripe owns invoice/payment lifecycle, configured retries, customer payment emails and hosted recovery. AgentCaller owns pre-dial authorization, period close, idempotent invoice issuance and reconciliation. Raw PaymentIntents would require extra collection machinery; metered subscriptions add no needed capability for this MVP. |
| Monthly vs per-call collection  | Monthly, with low credit exposure                                                     | Avoid repeated fixed transaction costs for small calls. Postpaid creates merchant credit risk. Optional threshold collection is a later explicitly consented policy, not a top-up.                                                                                                                                                                                                                          |
| Account vs agent budget         | One account ceiling shared by all integrations, plus per-integration grants           | Several agents must not each acquire a separate copy of the human's allowance. Per-agent monthly/per-call sublimits can only narrow the account cap.                                                                                                                                                                                                                                                        |
| MCP vs ordinary integration     | OAuth-authenticated remote MCP and full billing onboarding in the MVP                 | Implement in the existing platform and share billing/call functions with REST. The customer connects through OAuth without copying API keys. OAuth identity, billing consent and resumed-call acceptance must pass one complete launch test; API compatibility is preserved.                                                                                                                                |
| URL elicitation vs returned URL | Return setup URLs and poll durable status; native elicitation remains future work     | Durable setup/status makes manual retry work when a host cannot pause/resume. Never interpret client acceptance as successful payment setup.                                                                                                                                                                                                                                                                |
| Future scheduling               | Reserve the planned first-start month's budget at acceptance                          | Gives a meaningful acceptance guarantee. Recheck authorization before dialing. Do not accept an unreserved task and hope budget exists later. Restrict automatic retries to that month in the MVP.                                                                                                                                                                                                          |
| Monetary precision              | Keep pinned rates in integer USD micros; finalize one logical call into integer cents | Reuse existing rates without float calculations. Round the sum of all billable legs/attempts once, upward to a cent, with this tariff rule disclosed. Quote uses the same rounding. A published cents-only tariff is a simpler future option.                                                                                                                                                               |
| Funding integration             | Explicit switch over `x402`, `stripe_postpaid`, `operator`                            | Reuse execution, not payment semantics. Do not create fabricated x402 receipts or make operator permissions stand in for customer consent.                                                                                                                                                                                                                                                                  |

Stripe Invoicing supports one-off invoices with automatic saved-card collection;
creating one each month does not require a Stripe subscription. AgentCaller
calculates the month's usage, creates its invoice, and lets Stripe collect it.
The additional fee buys less payment code and a hosted invoice/recovery flow.
[Invoicing integration](https://docs.stripe.com/invoicing/integration).

Confirm merchant-specific Invoicing and processing fees, selected recovery features
and the approved tariff before paid launch. The implementation does not verify
the Stripe account's pricing tier or email/retry configuration.
[Invoicing pricing](https://support.stripe.com/questions/stripe-invoicing-pricing).

A metered Billing subscription could automate recurring usage billing, but adds
subscription/meter mapping without replacing the synchronous allowance check.
For this MVP, keep the local usage totals and use one-off Invoicing; no Stripe
subscription, meter feed or custom payment-retry engine is needed.
[Stripe usage-based billing](https://docs.stripe.com/billing/subscriptions/usage-based).

## 4. Account and integration authority

Use `client_profiles.id` as the paying account boundary. Its linked Supabase UID
is the human owner for this MVP; do not add organization membership or joint
accounts. The first OAuth consent must support a verified human with no existing
AgentCaller profile. Create/reuse a profile using only the verified Supabase UID
under the existing unique constraint. Never claim an existing API-only x402
account by email, GitHub name, a URL or client-submitted account ID. Linking such
an existing account still requires independent ownership verification.

Use existing Supabase human authentication, including a first-time sign-in path
through an enabled provider, and a constrained continuation to OAuth consent.
A verified first-time session can create its own profile with server-controlled
defaults, `is_operator=false` and no spending grant. Do not recreate or enable a
suspended profile during onboarding. A pilot allowlist can restrict eligible
users/hosts, but an eligible new user must complete OAuth and billing without
manual profile/key provisioning. General organization/admin onboarding is out
of scope.

The shared authenticated principal contains `clientId`, `connectionId`,
credential identity/kind and allowed operations. `authenticateApiRequest()` is
retained for legacy REST routes. `authenticateApiPrincipal()` preserves key
identity; MCP resolves the same principal shape from verified OAuth credentials. Spending authority is never inferred from a login, OAuth
token or old unscoped API key.

During OAuth consent, resolve the authorization request through the issuer's
supported API, show the verified integration identity and requested tool access,
and persist the human's approval bound to the issuer/subject/client tuple.
After token validation, resolve that approved connection; never let a model's
claimed agent/user ID create or select it. Existing API keys retain their mode
and can gain Stripe access only through explicit human linking/consent. They
are a compatibility path, not the required MCP onboarding mechanism.

For the MVP remote MCP service, use OAuth authorization code with PKCE and
Supabase Auth's OAuth server if the project supports the required resource/audience
binding. Its access tokens must resolve both the verified human subject and
OAuth client identity. Store permissions and connection revocation in
AgentCaller; OAuth tool access alone cannot authorize expenditure.
The repository implements the MCP resource server and Supabase-directed human
consent. `MCP_ENABLED` defaults to `false`; deployed Supabase issuance and
compatibility with a target MCP host remain acceptance requirements.
[Supabase OAuth server](https://supabase.com/docs/guides/auth/oauth-server),
[Supabase MCP integration](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication).

Require issuer, signature, expiry, MCP resource audience and connection checks.
Publish protected-resource metadata and appropriate `WWW-Authenticate`
discovery. Use exact registered redirect URIs, state, PKCE, refresh-token
rotation/revocation and a human connection-consent screen. Do not accept a
generic Supabase browser JWT or a third-party host token as an MCP token merely
because its signature is valid. If Supabase cannot issue the correct audience,
the MVP remains unreleased until a conforming issuer configuration is proven.
Do not weaken validation or substitute an API-only launch. Prefer a supported
existing issuer/configuration over building a new authorization server.
[MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

Use application permissions `calls:read`, `calls:create`, `billing:setup`,
`billing:read`; limit/card/grant changes require the human session. These are
AgentCaller permissions; do not assume Supabase supports arbitrary OAuth
scopes. Bind `(issuer, subject, oauth_client_id)` to a connection. Several
agents behind one OAuth client are one integration unless the issuer supplies
another trustworthy identity. Agent names supplied by a model are display data.

## 5. End-to-end setup and Stripe API details

### Verified API baseline

The platform pins Stripe Node 23.0.0 and the `stripeApiVersion` code constant
`2026-09-30.endive` in `apps/platform/src/lib/stripe.ts`. Request and webhook
versions must agree in each deployed environment. Avoid preview APIs.
[Stripe Node release](https://github.com/stripe/stripe-node/releases/tag/v23.0.0),
[API version source](https://github.com/stripe/stripe-node/blob/v23.0.0/src/apiVersion.ts).

Checkout accepts `mode: setup`, an existing Customer, currency, metadata and
success/cancel URLs. It creates a SetupIntent and can attach the saved method
to that Customer. SetupIntent usage defaults to `off_session`.
[Hosted setup guide](https://docs.stripe.com/payments/checkout/save-and-reuse?payment-ui=stripe-hosted),
[SetupIntent API](https://docs.stripe.com/api/setup_intents/create).

Do not pass `setup_intent_data.usage`: the checked 23.0.0 type exposes only
description, metadata and on-behalf-of there. Do not use
`payment_intent_data.setup_future_usage` in setup mode. Rely on the documented
SetupIntent default and verify the resulting intent's usage during activation.
[Checkout SDK parameter definitions](https://github.com/stripe/stripe-node/blob/v23.0.0/src/resources/Checkout/Sessions.ts),
[Checkout create API](https://docs.stripe.com/api/checkout/sessions/create).

### OAuth entry and billing sequence

```mermaid
sequenceDiagram
    participant A as Agent / MCP host
    participant P as AgentCaller platform
    participant O as OAuth issuer
    participant D as PostgreSQL
    participant H as Human browser
    participant S as Stripe
    A->>P: Connect to remote MCP
    P-->>A: 401 + protected-resource discovery
    A->>O: Start authorization code flow with PKCE
    O-->>H: AgentCaller sign-in and OAuth consent
    H->>P: Authenticate; approve this integration's tool access
    P->>D: Create/reuse own profile; persist connection consent
    P->>O: Approve validated issuer authorization request
    O-->>A: Authorization code through registered redirect
    A->>O: Exchange code using PKCE and resource binding
    O-->>A: Scoped access token
    A->>P: schedule_call with stable idempotency key
    P->>D: Verify principal, connection and billing authorization
    P-->>A: billing_setup_required + AgentCaller URL
    Note over A,H: Agent shares the ordinary setup URL with the human
    H->>P: Open setup; verify same human and connection
    H->>P: Approve limits and future-charge agreement
    P->>D: Persist billing consent and setup operation
    P->>S: Reuse/create Customer; create setup Checkout
    P-->>H: Redirect to hosted card setup
    H->>S: Save card; complete any setup SCA
    S->>P: Signed setup webhook
    P->>D: Persist verified event
    P->>S: Retrieve Session, SetupIntent and PaymentMethod
    P->>D: Verify ownership; activate matching spending grant
    A->>P: get_billing_status
    P-->>A: ready + allowance and usage
    A->>P: Retry unchanged schedule_call with original key
    P->>D: Commit call, budget reservation and scheduled job
    P-->>A: Accepted call ID
```

The host retains the original call intent and idempotency key across OAuth and
billing setup. An unauthenticated request receives an OAuth challenge, not a
billing setup link. OAuth access consent and billing/spending consent are
separate records even if their browser steps reuse the same signed-in session.
An OAuth denial, abandoned setup or card failure must never schedule a paid call.

Preserve only allowlisted OAuth/billing continuation destinations and opaque
server-validated request references through login. Validate issuer authorization
details and exact registered client redirect before approval. Do not route OAuth
access authorization through MCP URL elicitation. If native elicitation is
added, it applies only to the billing step after MCP authentication.

A user can close the host/browser and resume using token refresh or a new OAuth
session, durable setup status and the original key. Expired tokens trigger OAuth
reauthorization, not a new spending grant. A changed/revoked connection cannot
reuse another connection's setup even when the human account is the same.

1. Authenticate the agent before creating any setup request. A request for a
   Stripe-funded call with no grant returns HTTP 409 and a structured
   `billing_setup_required` body. It creates no call or budget reservation.
   x402 requests keep their existing 402 challenge. Authentication failures
   return 401, not a billing link.
2. Create/reuse a pending request bound to account, verified human UID,
   connection and requested agreement version. Derive a 32-byte opaque token
   with HMAC-SHA256 under a dedicated setup-token secret, binding request UUID,
   generation and expiry; store only its digest. This makes the same pending
   link reproducible after a lost API response without storing its plaintext.
   Rate-limit creation. A link locates a request and has no authentication
   authority. Default enrollment link lifetime: 24 hours. Key rotation can
   invalidate pending links; issue a fresh generation after reauthentication.
3. The URL is `https://agentcaller.io/billing/connect?request=<opaque-token>`.
   On entry use `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, no
   analytics or third-party assets, and strip the token from the address after
   exchanging it for a restricted HttpOnly/Secure/SameSite continuation cookie.
   The cookie can resume this setup only. Redact query tokens from access logs.
4. Require a verified Supabase session and exact owner match before displaying
   account/integration detail or creating Checkout. Wrong user: deny with no
   enrollment side effects. Ask them to sign in to the correct account. A GET,
   email scanner, or stolen link cannot approve limits, switch owner or add a
   method. The setup request cannot rebind its account.
5. Show account identity, connection name/verified publisher where available,
   tariffs, taxes/rounding, recurring monthly ceiling, optional narrower
   per-call ceiling, billing calendar, no upfront collection, revocation rules,
   and treatment of consumed usage. Record an unchecked explicit consent action
   with human UID, time, exact agreement/pricing version and approved limits.
6. Under a short database transaction, mark the consented request as creating
   Checkout and persist its operation ID. Create the Customer outside the
   transaction with a stable idempotency key based on billing account ID.
   Persist the mapping with unique constraints. Retry/reconcile interrupted
   Customer creation rather than creating a different customer each time.
7. Create Checkout server-side with `mode: "setup"`, `customer`,
   `currency: "usd"`, card-only methods, `client_reference_id` pointing to the
   setup request and internal IDs in both Session and SetupIntent metadata.
   Use the pinned SDK's supported card restriction parameter. The checked API
   supports `allowed_payment_method_types: ["card"]`; do not allow delayed bank debit
   methods in this MVP. Use a fixed success URL under `/billing/connect/return`
   and cancel URL under `/billing/connect`. No line items or charge amount.
   The returned Stripe URL goes only to the authenticated browser.
8. Persist a 31-minute Checkout expiry and the configured return origin before
   calling Stripe. Parameter creation and expiry validation share the injected
   request clock. Creation uses a two-minute lease and stable operation key;
   retries reuse the saved expiry, origin and generation. After 23 hours, require
   reconciliation rather than blindly recreating an uncertain operation. An
   expired Session needs a fresh setup request; automatic generation rollover
   within the same request is unimplemented. Persist the Session before redirect
   and reconcile server-written metadata when an event arrives first.
9. Receive `checkout.session.completed`; also process setup failure/cancellation
   and expiry events for status. Verify the raw request body with
   `stripe.webhooks.constructEvent`, signature header and endpoint secret.
   Durably insert a minimal event receipt before returning 2xx; return 5xx if
   the insert fails. Reject invalid signatures with 400. Queue work in the
   database; processing retries independently of HTTP delivery.
10. Retrieve the authoritative Session, expanded SetupIntent and PaymentMethod
    using server credentials. Require stored Session/generation, mode/setup
    completion, succeeded SetupIntent, off-session usage, exact Customer,
    attached card ownership, expected livemode/environment, account/connection
    binding, and valid consent. Store only IDs, brand/last4/expiry for the human
    UI. `payment_method.attached` alone is insufficient.
11. Lock account, connection and grant. Compare account card-generation and
    grant-generation so concurrent setup by two integrations cannot let an
    older webhook overwrite a later card choice. Initial human consent advances
    the grant version; verified completion activates that matching version.
    Replacing a card preserves an active spending grant's version and limits.
    Revoked, expired or superseded authority cannot activate.
    A late successful setup never clears an account's unpaid/dispute block.
    Replacement keeps the existing method usable until the new one is verified;
    changing a card never silently grants spending to another connection.
    Invoice creation must explicitly select this verified saved card through
    `default_payment_method`; Checkout attachment alone does not select an
    invoice default. The application need not maintain a separate Customer-default
    synchronization workflow. On card replacement, update existing unpaid invoice
    method overrides and verify the change, without initiating payment in app code.
    Stripe's configured recovery flow owns subsequent collection.
    The browser return directs the human to setup status; it cannot activate a
    grant. The agent polls durable readiness. Missing webhooks require verified
    server reconciliation, never a browser assertion.
12. Agent polls setup/status and retries the original operation using its same
    idempotency key and unchanged parameters. Success does not depend on keeping
    an MCP request, browser tab, SSE stream or Vercel process alive.

Stripe requires consent for the intended future use, including timing and how
variable amounts are determined, and retention of the agreement. Setup may
authenticate a card but cannot guarantee that every later charge succeeds.
[Stripe saved-payment compliance guidance](https://docs.stripe.com/payments/save-and-reuse?payment-ui=elements).

Stripe webhook delivery can duplicate and reorder events. Deduplicate event
IDs, retrieve current objects when needed, and apply guarded transitions.
Keep signature verification's timestamp tolerance; do not disable it to replay
an old signed body. [Stripe webhooks](https://docs.stripe.com/webhooks).

## 6. API and MCP contracts

Shared Zod contracts precede the route producers and consumers. AgentCaller JSON
uses camelCase; Stripe request parameters use snake_case. The
[active OpenAPI](../apps/platform/src/lib/openapi.ts) describes the REST inputs,
responses and credential alternatives.

| Endpoint                               | Authentication and behavior                                                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/billing/setup`           | Linked API key or resource-bound OAuth; `billing:setup` and `Idempotency-Key`. Returns status, setupRequestId, expiresAt and setupUrl.                                                 |
| `GET /api/v1/billing/setup/{id}`       | Own integration and `billing:read`. Returns setupRequestId, status and expiresAt; no credential or card details.                                                                       |
| `GET /api/v1/billing/status`           | `billing:read`; current UTC month, readiness and shared headroom. No future-period query parameter.                                                                                    |
| `GET /api/v1/billing/usage`            | `billing:read`; integration-scoped rows and optional `before` cursor, up to 50 rows. No period filter.                                                                                 |
| `POST /api/v1/calls/quote`             | `calls:create`; validates the connection task and schedule, returns maximum cents, accepted quote/pricing versions, period bounds and expiry. No reservation or dial.                  |
| `POST /api/v1/calls`                   | `stripe_postpaid` selects integer maxAmountCents and quoteVersion, optional scheduledFor, and linked key or OAuth authority. Returns HTTP 201 with data. Legacy modes retain HTTP 202. |
| Call detail/cancel                     | OAuth is limited to its integration's saved-card calls; existing key access retains tenant scope. List/delete/transcript/recording remain key-only.                                    |
| `POST /api/stripe/webhook`             | Signed raw Stripe body, Node runtime. Provider callback rather than an agent API.                                                                                                      |
| `GET/POST /api/internal/billing/drain` | Cron bearer secret; bounded event, metering, period, issuance and reconciliation work. Stripe owns payment retries.                                                                    |

Saved-card requests reject both `PAYMENT-SIGNATURE` and `X-Payment`. There is no
fallback between funding modes. Fingerprints bind the validated input, funding,
schedule and accepted quote. Reusing an accepted Stripe key with changed input
returns HTTP 409. A new request needing enrollment returns HTTP 409 with
`billing_setup_required`, setupRequestId and setupUrl, creating no call or hold.
Quotes expire at the next five-minute UTC boundary.

Billing setup states are pending, consented, creating_checkout, processing,
ready, failed, expired and revoked. Billing readiness returns a top-level object,
without a data wrapper. For a fully authorized account with paid admission
turned off, an illustrative response is:

```json
{
  "status": "disabled",
  "reason": "paid_calling_disabled",
  "currency": "USD",
  "periodStartsAt": "2026-10-01T00:00:00.000Z",
  "periodEndsAt": "2026-11-01T00:00:00.000Z",
  "monthlyLimitCents": 1000,
  "perCallLimitCents": 100,
  "spentCents": 120,
  "reservedCents": 200,
  "availableCents": 680,
  "collectedCents": 0
}
```

The complete object includes integration totals and unpaid exposure from
`getBillingStatus()`. Available cents are bounded by account month, integration
month and shared exposure; they are not deposited funds. No billing account
returns setup_required, currency and reason. Other readiness states are blocked
and ready. Private Stripe hosted invoice links are restricted to the human UI.

### MCP transport and remaining host acceptance

The six implemented tools are setup_billing, get_billing_status, quote_call,
schedule_call, get_call_status and get_usage. They share billing application
functions with REST. schedule_call accepts the saved-card connect_me contract
and does not create another execution ledger.

`@modelcontextprotocol/server` 2.3.1 serves stateless HTTP with current 2026-07-28
and legacy request compatibility, JSON responses and a 64 KiB body limit.
`MCP_ENABLED=false` disables the transport, resource metadata and human consent.
The live files are `mcp.ts`, `mcp-auth.ts`, `mcp-config.ts` and `app/mcp/route.ts`.

Native 2026 multi-round-trip URL elicitation, legacy 2025 URL elicitation and
completion notifications are unimplemented. Tools return an ordinary setupUrl,
structured setup-required result, durable status polling and safe original-key
retry. A host must complete the real OAuth-to-billing acceptance flow before
compatibility is claimed. Native elicitation remains an optional future host
integration; it cannot grant spending or substitute for verified setup.

## 7. Data model and migrations

Use nine focused tables. Combining reservation and finalized call usage in one
row avoids a separate reservations table; the account stores its one active card
reference, avoiding a payment-method catalog. Existing attempts/legs remain the
telephony measurement ledger. Existing x402 settlements remain x402 settlements.

The tables use RLS, server-only platform access, timestamps, tenant-scoped
queries and checked states. IDs are UUIDs; instants are `timestamptz`; monetary
columns are bounded integers. Rate arithmetic uses BigInt micros internally
and returns checked integer cents. Positive/nonnegative checks exist in SQL
and shared validation. No unchecked BigInt is exposed through JSON.

### Implemented tables

The [Drizzle schema](../packages/database/src/schema.ts) and migrations own
exact fields, indexes, checked states and foreign keys.

| Table                  | Responsibility and enforced boundary                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| billing_accounts       | One paying client, USD limits, verified card, contact name and collection consent; credit limit cannot exceed 1,000 cents.                          |
| agent_connections      | Verified issuer/subject/client tuple, human tool consent, operations and revocation.                                                                |
| billing_authorizations | Account/integration spending consent, limit snapshots and version; same-owner foreign keys.                                                         |
| billing_setup_requests | Owner-bound token digest, purpose, expiry, consent/card generations, frozen Checkout origin/expiry and operation lease.                             |
| billing_periods        | Unique account/UTC start, reserved/spent/collected/waived cents and immutable closed totals.                                                        |
| billing_call_usage     | Unique call reference, connection/grant/credential snapshots, reserved/final cents and metering state. Final charges cannot exceed the reservation. |
| billing_invoices       | Unique period and provider invoice mapping, expected amount, issuance lease and mirrored Stripe collection evidence.                                |
| stripe_events          | Unique environment/event receipt, safe routing fields, retry lease and processing result.                                                           |
| billing_audit_events   | Append-only financial and consent facts, keyed to prevent duplicate effects.                                                                        |

`billing_invoices` does not replace the unique per-call x402 settlement.
For Stripe, each call has one finalized usage assessment; multiple such calls
belong to one monthly invoice. The local invoice row maps and reconciles the
Stripe object; it does not implement its payment state machine. No call belongs to two funding sources.
No nullable FK alone protects historical identity: keep an immutable financial
call reference even after content deletion.

Use text for Stripe IDs, digests, versions and checked-state values; UUID for
internal references; integer for cents, generations, expiry month/year and retry
counters; boolean for livemode; JSONB only for bounded snapshots/permissions.
Customer/card IDs remain nullable until setup succeeds. Include an integer
`card_generation` on the account and its snapshot on setup requests. All referenced
tenant-owned targets need unique `(id,client_id)` keys for their composite FKs,
including existing calls. Same-account relationships must be enforced as well as
same-tenant relationships. Finalized usage amounts and consent facts are immutable;
financial corrections append separate records rather than rewriting their source.
For refunds/disputes, distinguish lifecycle observation facts from financial
effects: observations use distinct event/phase keys; each provider adjustment
can produce a given monetary effect only once. A pending-refund event must not
consume the unique key intended for its later successful financial effect.

### Integrated models

- `api_keys`: nullable `connection_id`, composite FK `(connection_id,client_id)`;
  index on connection for revocation. Existing rows remain null/unscoped and
  cannot incur Stripe charges until explicitly linked.
- `calls`: includes `stripe_billing_account_id`, `billing_authorization_id`,
  nullable request fingerprint, optional `scheduled_for`; funding constraint
  permits `stripe_postpaid` with same-tenant account/grant and nonnull references.
  x402 branch requires Stripe references null; operator branch keeps its exact
  current role/task/payment invariants. Index account+created where Stripe.
- `payment_state`: includes `accruing`, `accrued`. Stripe starts `accruing` and becomes
  `accrued` when final usage is known, including zero. Collection is exposed from
  its monthly invoice, not by relabeling every call after a charge. Existing
  enum values and x402/operator semantics stay intact.
- `rate_cards`: explicit `currency`/pricing interpretation, with checked USD
  snapshots for Stripe. Preserve existing version uniqueness and active-country
  rules. Stripe requires explicit approval of the pricing version; existing USDC
  rates do not establish a commercial card tariff. Immutable rate snapshots on usage rows protect finalization
  from edits to an active rate card.
- `connect_jobs`: initialize `next_attempt_at` from validated `scheduledFor` or
  the next permissible window. Existing `reserved_micros` remains the cumulative
  per-job attempt guard. It is never summed as actual monthly spending.
- `call_legs`/`connect_receipts`: allow idempotent cost observations after the
  operational call becomes terminal, without granting dial/accept/bridge
  permissions or reopening state. Do not delete evidence with call content
  until finalized financial summaries exist. Add a measurement reconciliation
  marker/source only if current timestamps cannot express verified correction.

Use one explicit lock order everywhere: account, connection/grant, periods
in chronological order, usage/call, attempts/legs, invoice mapping. Adapt connect
transactions touching Stripe to this order; do not call a helper that obtains an
account lock after holding a call lock. Operator/x402-only transactions can keep
their existing call locks. Add deadlock/retry tests for this integration.

### Migration and backfill sequence

1. Add enum values in their own committed migration; later migrations consume
   them. Follow the repository's operator-payment migration precedent.
2. Add new tables, RLS, fields, composite keys/FKs, state/money checks and indexes
   in a new timestamped migration; keep all old data valid. Validate existing
   ownership before adding composite FKs.
3. Deploy code understanding all modes with Stripe admission off. Create billing
   accounts/connections lazily for verified humans. Do not enroll, migrate debt,
   reinterpret USDC amounts or attach cards automatically.
4. Update schema and SQL together. Run fresh bootstrap and upgrade tests through
   every existing migration plus additions. Verify historical x402/operator
   fixtures still satisfy funding constraints.
5. Backfill rate currency only after an operator confirms its interpretation;
   deny Stripe quoting on unreviewed tariffs. Allow explicit switch to card
   billing only for new calls. Historical and in-flight x402 calls finish on
   x402; the same idempotency key cannot move a call to a different method.
6. Rollback means disable new Stripe admission and continue finishing usage,
   collecting liabilities and accepting webhooks. Do not drop financial tables
   or detach cards needed for consented outstanding charges during rollback.

The billing sequence is checked in under `supabase/migrations`: agent
connections (`20261018110000`), Stripe event inbox (`20261018111000`), separate
payment enum expansion (`20261018120000`), postpaid tables (`20261018120100`),
and enrollment identity (`20261018120200`). Apply every migration in timestamp
order, including the later personal-test tariff migration. Existing migration
files are append-only; these files do not establish remote application.

## 8. Budget enforcement, scheduling and usage

### Money and caps

All new limits, reserves, finalized call charges and Stripe totals are integer
cents. Tariff calculation uses checked integer micros/BigInt:

```text
connected leg micros = connection fee + ceil(connected seconds / 60) × minute fee
logical call cents = ceil(sum(all known billable leg micros) / 10_000)
maximum cents = ceil(sum(worst permitted usage for all attempts/legs) / 10_000)
available month = approved cap - gross consumed cents - active reserved cents
uncollected exposure = consumed but uncollected cents + active reserved cents
```

The confirmed charging trigger is business answer, measured by a trusted SIP
connection signal. Connected business time is billable while waiting, navigating
an IVR or reaching voicemail; human detection and successful handoff are separate
outcomes. Count callback usage only when that leg also connects. Confirmed
unanswered legs cost zero; missing evidence does not prove either answer or no
answer. Service-fault credit policy, exact rates and rounding still need approval.

Round elapsed milliseconds upward into started minutes directly with integer
arithmetic; do not round duration to whole seconds first. A leg requires
confirmed connection before any minimum fee. A leg known never to have
connected costs zero. Unknown connection/end information remains unknown.

For Stripe requests use `maxAmountCents`; never multiply the old binary floating
`maxAmountUsd` value into a card authorization. Preserve that field for legacy
funding modes. Database `max_amount_micros` can store exact cents × 10,000 for
Stripe within the existing range. Reject ambiguous/mixed money fields.

Reserve the computed worst-case quote, which must fit the client's requested
ceiling, human per-call ceiling and integration ceiling. Quote all allowed
attempts and both legs, including waiting, callback, handoff, inference and any
customer-tax component. The actual tariff must be commercially approved;
provider cost and customer price need separate labels. A $1 cap might not cover
the default six attempts. Return a specific quote-too-large result and suggest
fewer attempts/shorter durations rather than silently weakening the job.

Enforce the confirmed server-managed USD 10 (1,000 cents) total uncollected-
exposure cap per account. The $10 monthly allowance and $1 per-call default are
separate suggested customer limits, not approved tariffs or additional credit.
A user raising their allowance cannot raise the merchant credit cap. Future
reservations count toward that same exposure cap. Paying an intermediate bill
reduces exposure, but never restores the month's consumed allowance. Refunds
do not automatically restore gross spend or enable another call.

### Atomic admission

1. Authenticate, parse the request and generate a canonical fingerprint. For a
   known Stripe idempotency key, verify the original fingerprint and return the
   existing call before checking mutable grant status, tariff or schedule expiry.
   Returning an accepted resource cannot authorize another dial. For a new key,
   validate deterministic task/destination policy, exact schedule, tariff and
   requested funding. Include an explicit accepted `quoteVersion` when using a
   previously returned quote; do not fingerprint a newly looked-up mutable rate.
2. Begin transaction; lock billing account, connection/grant and the target month.
   Recheck enabled/revoked/expiry/card/collection status and credential identity
   using current rows. Check idempotency again inside the lock.
3. Compare against both account-month and grant-month consumption/reservations.
   The grant-month total is an indexed sum of its usage rows under the account
   lock; a separate per-agent period table is unnecessary. Check total exposure
   across all open/uncollected periods, not just this month.
4. Require requested ceiling, per-call caps, month allowance and credit headroom
   all to cover the quote. Reject with a typed limit reason on any failure.
5. Insert the call, its full-job usage reservation, connect job, queued event
   and outbound call webhook in the same transaction. Update period counters.
   Recheck existing throttle/concurrency under the lock. Commit before dispatch.
6. Scheduler polls committed connect rows. No external queue enqueue is needed.
   Rollback leaves neither a call nor a hold. Crash after commit leaves a durable
   job to pick up; crash/timeout after dispatch does not cause a second dial.

Admission and ordinary provider work keep network calls outside transactions.
Consent-sensitive invoice finalization and collection updates deliberately hold
the account lock across Stripe calls to serialize them with withdrawal.
The quote response is advisory until admission pins a tariff; expire it if the
tariff changed and require the client
to accept the new quote. A changed quote cannot increase an approved ceiling.

### Scheduling and billing periods

Use UTC calendar months, no prorating and no unused allowance carryover. Display
these rules explicitly even when business calling windows use Europe/Madrid or
another IANA timezone. Store a requested local time as an unambiguous UTC instant
using `scheduledFor`; local calling windows retain their IANA timezone. The
shared contract requires an offset-resolved instant rather than an ambiguous
local wall time. The existing seven-day horizon remains.

Attribute the job to its planned first permissible start month. Reserve that
month immediately, including future-month rows. Once its first attempt begins,
the job's month is immutable. All permitted attempt starts must be in that
month; at a boundary expire remaining retries and release unused reservation
after reconciling any live leg. A running leg may finish in the next month and
is billed to its start month. Do not split a started-minute tariff at midnight.
Do not automatically move a job to a new budget month or silently reschedule it.

Future period rows snapshot the recurring approved cap. Changing a cap locks
the account and applies to all unclosed future periods. Reject an immediate
decrease below consumed plus reserved usage. The human can cancel calls and
retry the limit change; deferred effective-date changes are unimplemented. Raising a limit requires human
consent, not a tool parameter. No increase of merchant credit headroom follows.
Apply the same consumed-plus-reserved checks to an integration's narrower
monthly grant before lowering it.

### Dispatch, revocation and metering

Funding authorization must be checked at scheduler selection, dispatch and each
worker permission transition. For Stripe, check active grant/account/connection,
reservation, pinned ceiling, target period and supported task. Preserve operator
checks and the x402 paid-connect blocker. Make these checks transactionally
consistent with revocation in `connectCommand()`; a check outside the call
transaction alone leaves a revoke/dial race.

The accepted dial intent is the race's linearization point. If intent commits
first, revocation immediately requests teardown; the provider might connect
before hangup. Preserve its reservation and account for any confirmed usage.
If revocation commits first, deny intent. Never promise zero cost for an
already-issued dial request.

Revoking a connection or spending grant cancels queued jobs and triggers cleanup
of active jobs; the worker fails closed on its next heartbeat at the latest.
Mark the grant revoked synchronously before batched cancellations, so a slow
cancel pass cannot permit another dispatch. Revocation stops future service;
already-consumed charges remain payable under the agreement. A separate request
to withdraw automatic collection permission blocks new invoice collection and
queues verified `auto_advance=false` updates for outstanding Stripe invoices.
Confirm the Stripe updates and escalate any already-processing payment; a local
flag cannot stop Stripe's scheduled retries. Keep service blocked while the
external change is pending. Existing debt still needs an agreed manual payment
path. Do not detach the method before deciding treatment of outstanding service.

Retain current conservative per-attempt `connect_jobs.reserved_micros` behavior.
Reserve the full customer job once at account admission; do not reserve it again
for each attempt. After terminal cleanup and all leg measurements, atomically
replace the account's reserved cents with actual cents and release the unused
part. If billing exceeds the pinned maximum because of provider overruns,
charge no more than the agreed ceiling, record the overrun as merchant loss,
and suspend the affected tariff/path pending investigation.

Operational terminal state and accounting completion are separate. The Stripe
observation path accepts idempotent connected/end evidence for existing owned
legs after termination without authorizing new actions. SIP identity, timestamp
ordering and bounds remain checked. Finalization waits for cleanup and complete
leg evidence; the terminal reason alone does not establish cost.

Missing evidence keeps the reservation in `metering_pending`. Reconcile provider
records by SIP IDs; ambiguous provider outcomes never become zero automatically.
The 48-hour reconciliation/waiver target is an operational release requirement,
not an automated waiver controller. An operator must establish cleanup and the
financial treatment of unsupported charges. If cleanup/exposure is uncertain,
suspend further usage and escalate; period close must not guess a fee or release
a live-leg hold.

The generic terminal-event path has an update-before-settlement crash gap and
no durable replay of finalization. Do not reuse it for the Stripe pilot. Before
enabling Stripe for generic tasks, add connected/disconnected evidence and a
durable finalization marker in the same terminal transaction, plus a collector
that can retry it after a crash. Generic result validation is a separate task
completion dependency.

## 9. Monthly invoicing, Stripe collection and financial operations

```mermaid
sequenceDiagram
    participant W as Voice worker
    participant P as Platform / billing drain
    participant D as PostgreSQL
    participant S as Stripe Invoicing
    participant H as Human
    W->>P: Idempotent connected/end observations
    P->>D: Finalize usage and release unused hold
    P->>D: Close resolved month; persist unique invoice operation
    P->>S: Create draft invoice and attach monthly usage item
    P->>S: Verify total; finalize with automatic collection enabled
    S->>S: Charge saved card; manage configured retries
    S->>P: Signed invoice payment/status events
    P->>D: Reconcile invoice and gate further service
    alt Payment or authentication action required
        S-->>H: Configured email with hosted invoice page
        H->>S: Complete payment / 3DS on hosted page
        S->>P: Signed invoice payment/status event
        P->>D: Reconcile debt; restore service only if authorized
    end
```

### Ownership

AgentCaller owns period attribution, approved prices, usage, allowances,
reservation release, invoice creation/finalization idempotency and account
access. Stripe owns the invoice/payment lifecycle, automatic card collection,
configured retry policy, payment emails, hosted payment/SCA recovery, invoice
PDFs and payment receipts. AgentCaller mirrors those outcomes and reconciles
missing events. There is no application card-decline classifier, confirmation
retry scheduler, PaymentIntent creation/replacement worker, client-secret API,
custom 3DS page or transactional dunning-email service in this project.

One-off invoices support these recovery features when configured, including
Smart Retries for eligible card invoices with `auto_advance=true`. Enable and
test the merchant account's chosen retry policy and failed-payment emails,
including links to Stripe's hosted page. Feature availability and exact timing
must be confirmed for the selected Invoicing tier before paid launch.
[Stripe automatic collection](https://docs.stripe.com/invoicing/automatic-collection).

### Close, create and finalize one monthly invoice

At UTC month end, stop new attempt starts against that month. Cancel/expire
unstarted jobs for that month, finish/reconcile live legs, finalize usage and
reconcile counters. Once reserved cents are zero, freeze the period's usage
and approved adjustments. Several integrations share one account/month invoice.

1. Under the account lock, insert/reuse the unique `billing_invoices` row with
   expected amount/currency, Customer and period. Persist stable issuance keys
   before any Stripe request; lease this invoice-creation work in bounded batches.
2. Create a draft using `stripe.invoices.create` with the verified `customer`,
   `currency: "usd"`, `collection_method: "charge_automatically"`,
   `auto_advance: false`, `pending_invoice_items_behavior: "exclude"`, the
   authorized `default_payment_method`, card-only payment settings and internal
   account/period metadata. Do not include a subscription. Persist its Invoice ID.
3. Attach one aggregate monthly usage item with `stripe.invoiceItems.create`,
   specifying this Invoice ID, its Customer, integer amount/currency, a safe
   usage-period description and period reference. Explicit invoice association
   prevents a pending item being swept into another invoice. Use one stable key
   for the item; if transport fails, retrieve/reconcile before adding it again.
   Keep per-call itemization in AgentCaller rather than risking Stripe's line
   count limit on a busy account.
4. Retrieve the draft and validate Customer, livemode, currency, item association
   and expected tax-inclusive total. Refuse finalization if discounts, taxes,
   credit balances, extra items or configuration change the authorized amount.
   Persist an actionable discrepancy; never correct it by charging separately.
5. Finalize that invoice with `stripe.invoices.finalizeInvoice` and
   `auto_advance: true` only while collection consent is active. Persist/reconcile
   the returned invoice. Stripe owns automatic collection and subsequent retries;
   the application never separately creates/confirms/pays its PaymentIntent or
   schedules `invoices.pay` calls. Finalization is not proof of payment. Stripe's
   collection delay is acceptable; there is no exact month-end payment promise.
6. Record finalization and collection outcomes from verified invoice events and
   periodic retrieval. A stalled draft/finalization error needs operator action
   or retry of the same issuance operation, not a second invoice.

The draft hold keeps incomplete invoices from collecting. Creation, item
attachment and finalization each have an independent stable idempotency key
derived from the local invoice ID and operation step in `billing-invoices.ts`.
[Invoice creation API](https://docs.stripe.com/api/invoices/create),
[InvoiceItem API](https://docs.stripe.com/api/invoiceitems/create),
[Invoice finalization API](https://docs.stripe.com/api/invoices/finalize).

Zero usage: close a $0 AgentCaller statement without a Stripe invoice. For a
positive USD total below 50 cents, waive it before invoice
issuance and record the merchant subsidy. Never increase the amount or allow
Stripe's small-invoice balance carry-forward to create an implicit customer
credit/debt balance. Account for tax-document requirements for waived usage
before launch. [Stripe currency/minimum rules](https://docs.stripe.com/currencies).

Stripe's v1 idempotency keys can be pruned after at least 24 hours. Permanent
uniqueness comes from the local account/month mapping, persisted Invoice/Item
IDs and reconciled Stripe objects. If creation or item attachment returns an
unknown result, reuse its key promptly and reconcile events and the Customer's
invoices/items. After the retention window, do not blindly repeat the create;
leave issuance blocked for reconciliation/operator resolution. Never use a
missed HTTP response or an empty immediate search result as proof of absence.
[Stripe idempotency](https://docs.stripe.com/api/idempotent_requests).

### Invoice outcomes and service access

| Stripe outcome                             | AgentCaller response                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoice finalized/open, collection pending | Mirror the invoice and keep usage unpaid. Ordinary bounded processing time is allowed within existing credit exposure; finalization does not mean collected. Escalate overdue collection using invoice evidence.                                                                                                                                          |
| Invoice payment failed                     | Suspend new reservations/dispatch across periods. Mirror the invoice and safe failure reason. Let Stripe's configured recovery policy retry it; never create a replacement invoice or a parallel application payment.                                                                                                                                     |
| Invoice payment action required            | Keep service blocked. Billing settings show a human-only link to the invoice's `hosted_invoice_url`; configured Stripe emails provide the same recovery flow. The agent receives only the AgentCaller billing-page URL/status.                                                                                                                            |
| Customer completes hosted payment/3DS      | Reconcile the same invoice from signed events/current retrieval. Restore service only after debt is resolved and account, connection and spending grant are still valid. A successful payment cannot revive revoked authorization.                                                                                                                        |
| Invoice paid                               | Verify account/Customer/currency, original expected amount, amount paid/remaining and any approved credit notes. Count cash collection once. `invoice.paid` can also reflect an out-of-band mark, so require allocated successful card payment evidence. Non-card settlements require operator review; there is no automatic acceptance path.             |
| Card replaced                              | Verified Checkout setup selects the attached card locally; new invoices specify it explicitly and unpaid invoice method overrides are updated as appropriate. Stripe owns subsequent collection. Paying an invoice with a different card alone does not prove consent to save/select it for future use; retain the explicit setup/default-selection flow. |
| Invoice uncollectible or void              | Keep the account blocked until an operator resolves/writes off the liability under policy. Neither state means money was collected; retain financial history and distinguish waived/credited usage. No automatic new invoice for the same period.                                                                                                         |
| Partial payment or mismatch                | Keep received and remaining amounts distinct; block while a receivable remains. Do not enable partial payments, split tender or automatic short-payment forgiveness in the MVP. Use Stripe's invoice/credit-note workflow for exceptional manual resolution; no separate remainder-charge engine.                                                         |
| Dispute                                    | Preserve the payment/invoice evidence, record the dispute and suspend service. Handle evidence and deadlines through Stripe's tools. Do not recharge disputed service or automatically issue an overlapping refund.                                                                                                                                       |

Stripe's hosted invoice page provides payment, 3DS, invoice and receipt downloads.
Read the current URL only for an authenticated owner, keep it out of general
logs/agent output, and retrieve again when expired. No custom payment form or
publishable-key frontend dependency is needed.
[Hosted Invoice Page](https://docs.stripe.com/invoicing/hosted-invoice-page).

For webhooks, use current retrieved invoice state rather than arrival order.
`invoice.payment_failed` must not overwrite a later resolved payment. A valid
`invoice.paid` event must still reconcile payment versus approved credits or
out-of-band settlement. [Stripe invoice events](https://docs.stripe.com/api/events/types).

### Corrections, refunds, invoices and tax

The implemented event processor retrieves credit, refund and dispute objects,
associates the affected customer, records a review block, and keeps service
suspended. It does not apply automatic credit allocations, restore allowance,
or treat out-of-band paid flags as card cash. Invoice reconciliation requires
exact totals and allocated successful card payments. The correction policy
below requires operator procedures and release acceptance.

Approve a correction with an immutable local audit record; retain gross usage
for allowance enforcement. Before finalization, adjust the held draft and
validate the approved total again. After finalization, use Stripe credit notes
for amount corrections. For a paid invoice, issue/associate the appropriate
refund through Stripe's invoice/credit-note/Dashboard workflow and reconcile
CreditNote/Refund events. Use an explicit refund rather than a future customer
credit balance for the MVP. No application refund-attempt queue or allocation
engine is required; an operator can perform the bounded action through Stripe
and record which usage/period was corrected.
[Invoice corrections](https://docs.stripe.com/invoicing/integration/workflow-transitions).

Keep credit-note, refund pending/succeeded/failed and dispute facts distinct.
An unsuccessful refund must not be shown as paid back. Apply each provider
adjustment once, and never rewrite measured usage to disguise it. A completed
refund does not automatically restore the month's spending allowance.
[Stripe refunds](https://docs.stripe.com/refunds).

Use Stripe invoices, PDFs and receipts as the billing documents; AgentCaller
shows its detailed call usage and links to the corresponding invoice. There is
no separate custom tax-invoice/receipt generation system. Configure the verified
billing email, business details and Stripe customer communications and confirm
which emails automatic-charge invoices actually send in this account.
[Stripe receipts](https://docs.stripe.com/receipts).

Before paid launch, identify merchant legal entity, supported customer countries,
tax-inclusive/exclusive tariffs, customer location evidence, invoice numbering,
credit-note and financial-retention obligations. Prefer approved tax-inclusive
pilot tariffs so the human's cap includes the full charge. Collect required
billing address/tax fields through Stripe where possible. Stripe Invoicing
supplies documents and collection, not an automatic resolution of every tax
registration or legal duty. Do not enable tax/discount behavior that can exceed
a reserved allowance.

### Credit risk and operations

Saving/authenticating a card is not a funds guarantee. The merchant pays Telnyx,
LiveKit and inference before collection and can lose the complete allowed
exposure plus provider overruns and dispute costs. Start with an explicit pilot
eligibility allowlist, a global exposure ceiling, per-account credit caps and no
self-approved merchant credit increases. A due failed/action-required invoice
blocks paid service even while Stripe is retrying. Cross-month reservations and
unpaid old usage remain in exposure; a calendar reset cannot create another
$10 debt. Disable new admission independently from necessary usage finalization
and consented invoice processing.

Optional later threshold collection charges only already-consumed usage under
explicit consent and requires invoice-to-usage allocation changes. It is outside
this monthly-only design. No deposits, top-ups, customer credit balances or
prepaid funds are introduced.

Monitor setup/event age, metering holds, stale job leases, room cleanup failures,
period close, unknown draft/item creation results, unfinalized invoices,
`invoice.finalization_failed`, failed/action-required/uncollectible invoices,
amount discrepancies, debt/exposure and daily ledger-to-invoice reconciliation.
Stripe sends configured payment recovery communications; AgentCaller supplies
status, access gating and operator alerts. Do not build a dunning email sender,
retry calendar or duplicate hosted payment recovery in the platform.

## 10. Edge-case requirements and acceptance checks

| Scenario                                 | Required behavior                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. $10/month and several future calls    | Reserve every full job in its planned start month; apply account/grant caps plus total exposure across months. Return accepted only after commit. Show scheduled reservations separately from consumed usage. Seven-day horizon remains.                                                           |
| 2. Two requests want remaining allowance | Account row lock serializes both. Exactly one fits; the other gets a budget error. Duplicate keys return the same call and never reserve twice. Test with independent PostgreSQL connections.                                                                                                      |
| 3. Start in one month, finish in another | Whole logical job stays in its reserved first-start month; charge all its measured legs there. Delay closing for bounded completion. No new retry starts in the next month without a fresh request/reservation.                                                                                    |
| 4. Never answered                        | Confirmed pre-answer busy/no-answer has zero usage. Retry only within connect policy and reserved job ceiling. On final terminal/cleanup release unused hold. Unknown dial outcomes retain a reconciliation hold.                                                                                  |
| 5. Answered, user never connected        | Business answer is the confirmed charging trigger. Bill measured connected business time, including IVR/voicemail/waiting, even if the callback or handoff fails. Bill callback usage only if that leg connects. Rates/rounding and discretionary service-fault credits remain separate decisions. |
| 6. Approaches maximum cost               | Quote covers hard per-leg duration and all attempts before acceptance. Refuse a duration/attempt set that cannot fit. Worker timers, server permission checks and LiveKit SIP maximums stop each leg. Merchant absorbs any unapproved overrun; alert and disable the affected route.               |
| 7. Revocation with scheduled calls       | Revoke synchronously, deny new intent, cancel queued jobs, tear down active ones and retain metering holds until evidence/cleanup. Accrued debt remains; late setup/webhooks cannot reactivate.                                                                                                    |
| 8. Lower limit below reservations        | Reject an immediate lower cap with consumed/reserved totals and the option to cancel pending jobs and retry. Deferred effective-date changes remain unimplemented. Never invalidate a committed reservation silently.                                                                              |
| 9. First charge needs 3DS                | Pause paid usage; show an AgentCaller billing-page link to the agent. The authenticated human follows the private Stripe hosted invoice page and completes 3DS there. Stripe sends configured recovery emails; readiness follows verified payment reconciliation.                                  |
| 10. Monthly collection fails             | Keep debt and monthly spent intact, block new paid jobs across periods and let Stripe manage configured retries/emails for the same invoice. No custom retry worker or automatic switch to x402/new funding.                                                                                       |
| 11. Duplicate/late Stripe event          | Unique event ID plus authoritative invoice/setup reconciliation. Late setup cannot revive a revoked grant; an old payment failure cannot downgrade a paid invoice. Credits/out-of-band marks do not count as card collection without evidence.                                                     |
| 12. Agent disconnects, account stays     | Revoke its credentials/connection/grant and cancel its scheduled jobs. Keep account, card, statements, other agents and consumed debts. Distinguish tool disconnection from withdrawal of collection consent.                                                                                      |
| 13. Several agents                       | Separate credentials/grants and optional narrower sublimits, one shared account cap and one monthly payment. Untrusted display names do not create new identities or allowances.                                                                                                                   |
| 14. x402 customer switches               | Verify/link human ownership and explicitly approve a new Stripe grant. Future calls choose Stripe; in-flight/historical x402 calls and receipts remain x402. Reject funding change under an existing idempotency key.                                                                              |
| 15. Zero usage                           | Close a zero AgentCaller statement with no Stripe invoice or charge. Waive positive below-minimum totals before invoice issuance; do not create customer balance carry-forward.                                                                                                                    |
| 16. Payment succeeds, client times out   | Retrieve/reconcile the existing invoice and its payment evidence; apply collection once. Retain uncertain issuance state when an Invoice/Item creation response is lost. Never create another invoice or directly charge a PaymentIntent because HTTP timed out.                                   |

## 11. Threat model and reliability boundaries

Assets: human identity and consent, payment identifiers/credentials, authorized
allowances, call intent, telephony usage evidence, receivables, settlement
uniqueness and private call data. Trust boundaries: agent/host → platform,
human browser → platform, platform → database, worker → platform, platform ↔
Stripe, and worker ↔ LiveKit/Telnyx. The model and task text are untrusted.

| Threat or failure                             | Control and verification                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unauthorized paid tool                        | Verify credential and tenant, then separate current spending grant; restrict operations by connection. No paid authority from request IDs, client labels, task instructions or possession of a URL. Test cross-tenant and revoked keys.                                                                                                                                               |
| Prompt injection changes limits/card/customer | Limits and Stripe identifiers come only from verified database rows and human actions. Model can request a quote/setup link, never modify consent. Validate tasks/destinations independently. Test malicious purpose/information fields.                                                                                                                                              |
| Concurrent overspend                          | Account-first locks, transactionally inserted full-job holds, DB uniqueness, nonnegative counters, immutable ceiling and reconciliation. Test parallel clients, cancellations, limit changes and close.                                                                                                                                                                               |
| Leaked/wrong-person setup URL                 | HMAC-derived token with stored digest, expiry, verified UID match, fixed account/connection, no authority from token. No identifying details before ownership check. Test wrong signed-in user, modified ID/token and replay.                                                                                                                                                         |
| CSRF/session fixation                         | Consent and changes through authenticated POST/server actions with Origin/CSRF protection; secure cookies, rotate/verify login session, short restricted continuation, no GET mutations and no arbitrary return URLs. Test consent POST from another origin and forced-account login.                                                                                                 |
| Attacker swaps Checkout/customer/method       | Server creates mappings; verify Session, SetupIntent, PaymentMethod customer and current generation plus environment. Metadata supplements, never replaces, stored ownership. Test valid Stripe objects for another account.                                                                                                                                                          |
| Webhook spoof/replay                          | Raw bytes + Stripe signature/timestamp, event-ID uniqueness, durable processing and object validation. No disable-signature test switch in deployable code. Test modified raw body, bad/stale signature and parallel duplicate events.                                                                                                                                                |
| Out-of-order events                           | Guarded current-state transitions and authoritative retrieval; terminal/revoked states stay final. Process setup and payment histories independently. Test success-before-failure and revoke-before-setup-success.                                                                                                                                                                    |
| Double charge after crash                     | Persist invoice/item issuance operations before network, stable keys, unique account/month invoice mapping, leases and retrieval. Stripe alone owns payment attempts. Test crashes at create, attach, finalize and payment-success/webhook boundaries; no parallel application debit.                                                                                                 |
| Revocation races                              | Same transaction/lock order as admission and dial permission; synchronous revoked flag before background cancellation. Keep already-issued leg bounded and metered. Test cancel/revoke/dial/bridge races.                                                                                                                                                                             |
| Lost dispatch or worker                       | Durable queued job/attempt/intent, bounded heartbeat lease, no repeat dial after uncertainty, provider duration limit and repeated teardown. Test crash after commit, delayed dispatch and worker loss.                                                                                                                                                                               |
| Terminal row loses end evidence               | Separate immutable operational state from late accounting observations; idempotent leg evidence accepted after cancel. Keep unknown cost held and surfaced. Test shutdown after terminal, late disconnect and duplicate measurement.                                                                                                                                                  |
| Card fails after consumption                  | Low merchant credit cap and account gate on failed/action-required invoices. Stripe handles configured retries and hosted recovery; unresolved debt stays visible. Test failure, SCA, card replacement and disabling Stripe automation after collection-consent withdrawal.                                                                                                           |
| Money/unit errors                             | Integer cents and micros, bounded BigInt arithmetic, explicit currency/pricing version, same quote/finalization rounding. Test sub-cent rates, max duration, multiple legs and overflow.                                                                                                                                                                                              |
| Data exposure/GDPR                            | Server-only billing RLS; minimum identifiers/card display metadata; redact tokens, secrets, tasks, payloads and receipt URLs from logs. Keep setup tokens short-lived; financial data has a separately approved legal retention schedule. Delete call content independently; retain pseudonymized financial evidence only as required. Test deletion while unpaid and across tenants. |
| Account takeover/billing abuse                | Recent human authentication for limit increases, grant/card/collection-consent changes; rate-limit setup/recovery. Preserve audit and operator disable controls. Avoid storing unnecessary IP/device data as a substitute for consent.                                                                                                                                                |
| Secret compromise                             | Stripe secrets only in platform server environment; separate test/live resources/signing secrets and rotation. Worker/MCP never receives card or client secrets; hosted recovery avoids passing client secrets through AgentCaller. Lazy config keeps disabled Stripe optional.                                                                                                       |
| Unsafe outbound callbacks                     | Preserve existing per-client HMAC raw-body signatures, timestamps/event IDs, HTTPS-only URLs, private-address denial and redirect blocking. Billing additions cannot weaken existing webhook delivery.                                                                                                                                                                                |

Card collection through hosted Checkout reduces card-data handling; it does not
eliminate merchant consent, privacy, PCI validation or calling-law obligations.
Launch review must address the actual merchant/customer jurisdictions and the
bounded telephone use case. Veterinary contact/regulated-service scope in the
example needs a product-policy decision; do not silently broaden current rules.

## 12. Implemented files and ownership

The active implementation stays within the existing platform, worker and shared
packages. These paths replace speculative per-feature modules; no separate
billing service, queue service, session store or payment retry engine exists.

| Concern                          | Live files                                                                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared inputs and principal      | `packages/contracts/src/index.ts`, `billing.ts`, `agent-auth.ts`, `connect-me.ts`                                                                                                                                 |
| Persistence                      | `packages/database/src/schema.ts`, `supabase/migrations/`                                                                                                                                                         |
| Credentials and permissions      | `apps/platform/src/lib/auth.ts`, `agent-auth.ts`, `mcp-auth.ts`, `oauth-consent.ts`, `billing-store.ts`                                                                                                           |
| Human identity and login return  | `apps/platform/src/lib/portal.ts`, `auth-redirect.ts`, `app/login/`, `app/auth/callback/`                                                                                                                         |
| MCP transport and tools          | `apps/platform/src/lib/mcp.ts`, `mcp-config.ts`, `app/mcp/route.ts`, `app/oauth/consent/`, `app/.well-known/oauth-protected-resource/mcp/route.ts`                                                                |
| Stripe SDK and webhook ingress   | `apps/platform/src/lib/stripe.ts`, `stripe-events.ts`, `app/api/stripe/webhook/route.ts`                                                                                                                          |
| Human enrollment                 | `apps/platform/src/lib/billing-setup.ts`, `billing-tokens.ts`, `app/billing/connect/`, `app/billing/connect/start/route.ts`                                                                                       |
| Prices, schedule and fingerprint | `apps/platform/src/lib/billing-money.ts`, `billing-period.ts`, `billing-policy.ts`                                                                                                                                |
| Quotes, admission and metering   | `apps/platform/src/lib/billing-usage.ts`, `billing-agent.ts`, `app/api/v1/calls/route.ts`, `app/api/v1/calls/quote/route.ts`                                                                                      |
| Worker permission and lifecycle  | `apps/platform/src/lib/billing-authority.ts`, `connect-me.ts`, `connect-scheduler.ts`, `livekit.ts`, `app/api/internal/calls/[id]/connect/route.ts`; `apps/voice-agent/src/connect-flow.ts`, `connect-livekit.ts` |
| Agent billing REST               | `apps/platform/src/app/api/v1/billing/[operation]/route.ts` handles setup/status/usage; `setup/[id]/route.ts` handles setup polling                                                                               |
| Monthly accounting               | `apps/platform/src/lib/billing-invoices.ts`, `billing-events.ts`, `billing-drain.ts`, `app/api/internal/billing/drain/route.ts`                                                                                   |
| Human settings                   | `apps/platform/src/lib/billing-controls.ts`, `app/app/billing/page.tsx`, `app/app/billing/actions.ts`, `app/app/connections/`                                                                                     |
| Deployment                       | `apps/platform/src/lib/env.ts`, `apps/platform/.env.example`, `apps/platform/vercel.json`                                                                                                                         |
| Public discovery                 | `apps/platform/src/app/auth.md/route.ts`, `.well-known/api-catalog/route.ts`, `openapi.json/route.ts`, `robots.ts`, `sitemap.ts`; `src/lib/openapi.ts`, `next.config.ts`                                          |
| Documentation                    | `apps/docs/content/docs/mcp.mdx`, `billing.mdx`, `dispatch.mdx`, `discovery.mdx`; `README.md`                                                                                                                     |

Billing tests include `billing.integration.test.ts`, `billing-money.test.ts`,
`billing-period.test.ts`, `billing-http.test.ts`, `billing-tokens.test.ts`,
`stripe.test.ts`, `stripe-webhook.test.ts`, and OAuth/MCP tests under
`apps/platform/src/lib`. Shared contracts, voice-worker behavior and both
PostgreSQL suites have their own tests. Browser, provider and target-host
acceptance remain separate from offline coverage.

The canonical user-facing instructions are the
[MCP guide](../apps/docs/content/docs/mcp.mdx),
[billing guide](../apps/docs/content/docs/billing.mdx), and
[dispatch guide](../apps/docs/content/docs/dispatch.mdx). Setup and operating
instructions live in the [operations runbook](../docs/operations.md). Keep implementation
inventories aligned with these files instead of creating placeholder modules.

## 13. Phase status and acceptance gates

The table describes milestone criteria. Open/closed release status is maintained
only in the [release-readiness checklist](../docs/release-readiness.md).

| Phase                      | Implemented and tested offline                                                                      | Remaining release acceptance                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0. Dependencies and policy | Pinned SDKs, schema/migration fixtures and bounded exposure policy                                  | Approved tariffs/tax, real issuer resource binding, host compatibility, carrier duration/metering and merchant risk controls |
| 1. OAuth and MCP           | Verified profile provisioning, tool consent, scoped tokens, revocation and six tools                | Eligible human completes the configured issuer/host connection without manual key/profile provisioning                       |
| 2. Enrollment and controls | Owner-bound setup links, human consent, Checkout verification, limits, replacement and key linking  | Hosted Stripe test-mode, human browser and collection-consent acceptance                                                     |
| 3. Scheduling and usage    | Full-job holds, exact scheduling, funding authority, cancellation, late metering and UTC boundaries | Controlled provider calls, tariff coverage, cleanup and operational reconciliation                                           |
| 4. Monthly collection      | Period close, held draft/item verification, collection evidence and durable accounting drain        | Stripe recovery/email settings, hosted payment outcomes and accounting/legal review                                          |
| Future integrations        | No Link Agent Wallet or native URL elicitation implementation                                       | Independently scoped compatibility work; neither is proof of the saved-card release                                          |

No phase is release-accepted. `STRIPE_BILLING_ENABLED=false` retains the paid
admission gate; event ingestion and accounting continue independently. Optional
MCP also defaults to disabled. The complete customer release requires OAuth,
human consent, setup polling and safe call resumption. REST-only tests and
mocked provider adapters cannot substitute for that end-to-end acceptance.

## 14. Testing plan and environment

### Offline mocks and unit tests

- OAuth/MCP onboarding: unauthenticated discovery, validated issuer request,
  first-time verified profile creation, consent denial, client/subject binding,
  audience/issuer/expiry checks, PKCE/redirect protection, refresh/reconnect,
  disabled accounts and revoked connections. Tool access without a spending
  grant returns billing setup required and cannot reserve or dial.
- SDK request contract: no amount/line items in setup, exact Customer binding,
  permitted metadata, separate test/live config, stable creation keys and no
  unsupported Checkout `usage` parameter.
- Setup states: duplicate creation, Session persisted late, browser forged
  success, wrong UID/customer/method/environment, abandoned SCA, replaced card,
  expired/revoked request and stale generation webhook.
- Raw signature verification with a generated Stripe test signature: body
  modification, missing signature, expired timestamp, wrong endpoint secret.
  Synthetic unit fixtures are minimal and contain no real payloads or secrets.
- Quotes and limits: integer-only input, exact tariff/rounding, zero/unknown
  connection, two legs, six attempts, duration overflow, grant/account min caps,
  stale price, UTC/DST boundaries and cross-month credit exposure.
- Invoice issuance/reconciliation: draft holding, explicit invoice-item binding,
  total validation, explicit invoice payment-method selection, finalize-before-payment,
  failure/action-required/paid events, zero/subminimum, partial amounts, credit
  notes, out-of-band paid marks, refund states and disputes. Assert no direct
  PaymentIntent creation/confirmation, application payment retry or client-secret
  response. Stripe recovery is acceptance-tested, not reimplemented in mocks.
- MCP: current and legacy transport, constrained origins, verified principal,
  structured setup links, polling and original-key retry. Native URL elicitation,
  decline/cancel and completion-notification behavior need new implementation
  and tests if that optional host integration is added.
- x402 regression: original 402 challenge/header, malformed signature rejection,
  verify/settle payloads unchanged, generic minimum arithmetic unchanged, paid
  connect still blocked and operator never enters either collection adapter.
  Do not describe mock adapter tests as proof CDP supports current semantics.

### Real disposable PostgreSQL tests

Mocks cannot establish race safety. Use independent database connections, as
each `createDatabase()` instance has pool size one. Apply all migrations to
fresh and existing-history fixtures. Run races with a barrier so requests
actually overlap:

- Concurrent first OAuth logins create one profile/connection; a foreign client
  or guessed account cannot claim an existing tenant. Token refresh creates no
  duplicate billing authorization and revoke/refresh cannot restore access.
- Two reservations for the last allowance; same-key duplicates; unique failure
  rollback; request fingerprint conflict; no call on rejected reserve.
- Multiple grants sharing one account; future-period holds; no credit reset at
  month boundary; cap lowering versus admission; revoke versus dial/accept.
- Concurrent finalizers and cancel/late-end; unknown metering; usage after
  operator-confirmed cleanup; orphaned reservations and counter reconciliation.
- Duplicate event inserts, processor crash/lease recovery, distinct event IDs
  referring to one SetupIntent/Invoice, stale generation setup.
- Two closers/drains and crashes around invoice creation, item attachment and
  finalization; immutable closed-period amount, paid-before-response,
  failure-after-paid and credit-note/refund replay. Assert one Invoice and one
  usage item per period; no deadlocks under the common lock order.
- Composite FK rejects cross-tenant connection, account, grant, period and call
  associations even if application code is bypassed; RLS denies anon access.
- Financial evidence survives permitted content deletion; unpaid service cannot
  lose its reconciliation references.

### Stripe test mode / CLI

Run these only in an explicitly authorized isolated provider test environment.
Use isolated Stripe test credentials/sandbox, test customer identities and owned
call destinations. Do not run live-mode API calls.

1. Start the platform locally. Run `stripe listen --forward-to
localhost:3000/api/stripe/webhook` in another terminal; use the listener's
   signing secret for local testing, not the deployed endpoint secret.
2. Through the real AgentCaller consent/setup UI, create a real **test-mode**
   Session. Complete normal and 3DS setup using Stripe's documented test cards.
   Verify Customer/SetupIntent/PaymentMethod associations through the server.
   Check no PaymentIntent/charge was created by enrollment.
3. Finish setup without visiting success URL, visit success URL before webhook,
   replay the same test event using CLI/Dashboard resend and expire/cancel setup.
   Generic `stripe trigger` fixtures are useful for delivery mechanics but do
   not prove application account binding; use actual app-created objects for
   acceptance.
4. Drive billing periods with an injected application clock/admin fixture in the
   isolated test environment. This design has no subscription clock; do not
   assume Stripe Test Clocks advance the local ledger or one-off retry calendar.
5. Create one aggregate draft invoice, check explicit item/Customer/default-card
   association and total, then finalize into Stripe automatic collection. Prove
   one invoice/payment for several calls. Test no invoice for zero/waived usage
   and no implicit small-amount/customer-balance carry-forward.
6. Use documented off-session authentication/decline fixtures. Confirm setup can
   succeed while invoice payment fails. Check invoice events suspend paid calls;
   complete recovery through Stripe's hosted invoice page, not a local form.
   Replace the saved card through setup and verify ownership/invoice overrides
   without application payment retries. Payment must not revive revoked grants.
7. Verify the chosen Stripe tier/settings for one-off Smart Retries, failed-card
   emails and hosted links; test the supported failure/recovery path and any
   documented simulation limits. Do not build an app retry scheduler to simulate
   unavailable test-mode timing. Stripe test emails/receipts may need previews
   or explicit manual procedures; no delivery assumption is a release check.
8. Create test credit notes/refunds/disputes using Stripe's supported workflow;
   replay events, fault-inject create/attach/finalize response loss and reconcile
   invoice totals, collected amounts, remaining debt, credits and refunds.
   Test collection-consent withdrawal actually disables invoice automation.
   Keep fixtures free of actual customer data.

Select current fixtures from [Stripe testing documentation](https://docs.stripe.com/testing)
at implementation time; do not copy unverified card-number folklore into tests.
Live carrier validation remains separate from Stripe test-mode validation.

### Browser and complete workflow

Add a small browser E2E suite under
`/home/gianpaj/github/gianpaj/agentcaller-io/apps/platform/e2e/billing.spec.ts`
with a future pinned Playwright dev dependency/config only when this phase
starts. Test two distinct human accounts and named agents. Cover login return,
wrong-account link, consent, pending webhook, limits, revoke, card replacement,
invoice links, hosted SCA recovery and original-call retry. Mock Stripe for routine CI; run
the hosted-Checkout acceptance path against Stripe test mode separately.

The end-to-end release fixture starts from an unconnected MCP host and an
eligible human with no AgentCaller profile. Complete discovery, OAuth sign-in,
profile creation and tool-access consent; then request a next-day connect call,
follow owner-bound billing setup, approve spending and save a card without
payment. Poll readiness and retry the original request with the same key.
Accept several budgeted jobs, charge confirmed business-answer usage (including
failed handoff), release unused holds and collect one monthly invoice. Run
the ordinary-link flow, including browser/host closure, token expiry and
reconnect. Add native URL-elicitation acceptance only if that optional host
integration is implemented. No API-key copying, administrator profile linking
or direct REST-only substitute can satisfy this release test.
Also run an existing x402 request and operator connect test to confirm routing
is unchanged. Use mocked telephony for CI, then separately authorize owned-number
PSTN tests in each enabled business/callback language. English and Spanish paths
need independent checks; Italian connect behavior needs its own checks too.

### Implemented configuration and external setup

[Environment validation](../apps/platform/src/lib/env.ts) requires an independent
setup-token secret of at least 32 characters and rejects reuse of the API-key
pepper, cron secret or Stripe signing secret. Rotation invalidates pending links;
rotation and recovery procedures still require operational verification.

| Setting                            | Implemented use and release requirement                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`                | Server-only SDK credential; isolated test key for hosted acceptance, live only after release approval.                                                          |
| `STRIPE_WEBHOOK_SECRET`            | Per-environment raw-body signature verification.                                                                                                                |
| `BILLING_SETUP_TOKEN_SECRET`       | Independent setup-link HMAC secret, lazily validated at enrollment.                                                                                             |
| `STRIPE_PRICING_VERSION`           | Required approved tariff version matching active USD rate cards.                                                                                                |
| `STRIPE_BILLING_ENABLED`           | Defaults false. Gates new paid calling; test-mode enrollment and required accounting have separate behavior. Live enrollment also requires this flag.           |
| `MCP_ENABLED`                      | Defaults false. Gates transport, protected-resource discovery and human tool consent.                                                                           |
| `MCP_ALLOWED_ORIGINS`              | Optional comma-separated exact browser origins in addition to the configured app origin.                                                                        |
| `NEXT_PUBLIC_APP_URL`              | Canonical origin for MCP resource and human setup/return links.                                                                                                 |
| `SUPABASE_URL` and publishable key | Configured identity provider; issuer is the Supabase origin plus `/auth/v1`, with its JWKS endpoint. Real resource-bound OAuth issuance remains a release gate. |
| `CRON_SECRET`                      | Authenticates billing, webhook and connection drains; no role in Stripe signature verification.                                                                 |
| Existing database/LiveKit settings | Active migrations and provider configuration remain required; the voice worker receives no Stripe credentials.                                                  |

`STRIPE_API_VERSION` is not an environment variable. `stripeApiVersion` in
`apps/platform/src/lib/stripe.ts` pins `2026-09-30.endive`; configure matching
webhook event format. Human spending limits are recorded on account/grant rows;
merchant credit cannot exceed the checked 1,000-cent exposure cap.

Configure Stripe Invoicing for automatic card collection with the approved
retry count/duration, failed-payment emails and hosted payment links. Verify
feature availability on the selected tier and the verified billing email.
Disable partial payments, automatic short-payment forgiveness and unintended
credit-balance application for the MVP. These are Stripe account/invoice settings,
not new application retry environment variables or scheduled payment jobs.
Record the chosen settings and test-mode limitations in the deployment runbook.

Register `/api/stripe/webhook` for the pinned event version and the supported
routing types in [stripe-events.ts](../apps/platform/src/lib/stripe-events.ts).
The reducer handles Checkout/setup, invoice, card/customer and financial-review
events. It never builds a parallel PaymentIntent or subscription state machine.
Verified routing does not establish object ownership; current retrieval and
stored associations remain required. Provider endpoint registration has not
been verified by the offline suites.

After implementation, run scoped typechecks/tests during each phase, mandatory
disposable-DB tests for billing races, then repository `pnpm typecheck`,
`pnpm lint`, `pnpm test`, `pnpm format:check`, `pnpm build` and both DB suites at release.
For implementation changes to `.tsx`, run the affected platform/docs package's
lint script and fix its findings.
Report baseline failures distinctly. Current source includes the worker bundler;
do not repeat the August missing-build-output diagnosis without reproducing it.
Combined-branch validation recorded on October 24 passes workspace typecheck,
lint, tests and build. Platform tests pass 373 assertions; the separate disposable
PostgreSQL suites pass 29 billing and 46 connection tests. Repository formatting
flags 50 files unchanged from the billing branch; changed files pass targeted
formatting. These results do not cover remote migrations, hosted Checkout,
issuer/host acceptance, real calls or production deployment. See the integration
record for evidence rather than treating this test count as a release gate.

## 15. Remaining work and implemented defaults

The [release-readiness checklist](../docs/release-readiness.md) owns the current
outstanding work: issuer/host proof, policy and tariffs, browser coverage, hosted
Stripe acceptance, telephony, personal-data deletion, operations and complete
release acceptance. It separates required pilot work from optional integrations
and broader prototype gaps. Detailed test procedures remain in section 14.

### Implemented calling scope awaiting commercial approval

Saved-card calls support only `connect_me` and reserve worst-case usage for all
permitted attempts and both legs. Scheduled tasks default to six attempts with
a 300-second retry delay; Call now requires one attempt. Those choices are
implemented with paid admission disabled. Approve their commercial exposure,
price coverage and operational behavior before enabling paid service. Autonomous
reservation and appointment calls remain outside saved-card scope.

### Implemented defaults and remaining policy choices

USD only; UTC calendar months; one verified human/profile and active saved card;
one shared account allowance narrowed by integration grants; a seven-day schedule
horizon and one first-start budget month per job; no new cross-month retries and
no recording. Pending account/grant limits start at zero. The human setup UI
suggests 1,000 cents monthly and 100 cents per call; explicit consent records
limits. The independent merchant exposure cap cannot exceed 1,000 cents.

Zero usage creates no invoice; positive USD totals below 50 cents are waived with
an audit record. Ordinary setup URLs and polling are implemented, with target-host
acceptance outstanding. Stripe owns collection and configured recovery. Partial
amounts, credits and disputes require review; retry/email/tax configuration,
global merchant exposure and correction procedures remain release checks.
No deposited balance, top-up, threshold collection or wallet is implemented.

## 16. Smallest production-worthy demonstration

Ship a capped **OAuth/MCP-to-billing connect-me MVP** after phases 0–4. An eligible
human starts from their MCP host, signs in or creates an account through the
configured identity provider, and approves the named integration's tool access.
The authenticated agent requests a scheduled call and receives an AgentCaller
billing setup URL that the agent shares as an ordinary link.

The same verified human approves spending limits and future variable charges,
then saves a card in hosted Stripe setup with no payment. Verified server events
activate the matching spending grant. The agent polls readiness and retries its
original call request with the same idempotency key. Several calls reserve
budget atomically, charge confirmed business-answer usage and release unused
holds. USD 10 bounds the account's total unpaid usage plus reservations. One
monthly Stripe invoice collects actual usage; Stripe handles payment recovery.
AgentCaller reconciles the invoice and controls further service. A revoked grant
stays revoked after payment. Existing x402/operator routing and blockers remain.

OAuth, first-time eligible account onboarding, MCP tools, owner-bound billing
setup, polling/reconnect and safe request resumption are all MVP requirements.
API-key REST remains available for existing integrations; it cannot substitute
for the agent onboarding release test. Native elicitation remains optional
future work. Host payment/action approvals still apply.

Exact prices, reservation sizing/retry defaults and first calling-task scope
remain commercial release review items. The supporting code is implemented
with paid admission disabled; no live provider or payment acceptance is implied.
Subscriptions, MPP, crypto custody, prepaid balances, top-ups and AgentCaller
wallet infrastructure are outside the MVP. Link Agent Wallet is a separately
scoped future merchant payment option under the checks below.

## 17. Future payment option: Link Agent Wallet

### Purpose and current evidence

Evaluate accepting Link Agent Wallet as an additional way to pay for AgentCaller
service after saved-card monthly Invoicing ships. AgentCaller acts as the seller;
it does not build a wallet for agents or take custody of user funds. Ordinary
Link checkout availability does not establish Agent Wallet compatibility.

Stripe's checked wallet guide describes customer-approved spend requests that
produce purchase-scoped Link Pay Tokens, shared payment tokens or single-use
virtual cards. It lists US/Canadian buyers and allows sellers outside those
countries. Those documented purchase flows are not evidence of reusable saved
billing credentials or an ongoing monthly allowance.
[Link Agent Wallet spending guide](https://docs.stripe.com/agentic-commerce/agents/link-agent-wallet/use-link-wallet-pay-online).

Link wallet OAuth authorizes an agent to access the buyer's Link wallet. It is
separate from the AgentCaller OAuth connection, human spending grant and Stripe
merchant Customer. Do not pass one issuer's token to another service, merge
identities by email or treat wallet purchase approval as a new AgentCaller grant.
[Link wallet OAuth](https://docs.stripe.com/agentic-commerce/agents/link-agent-wallet/oauth).

### Invoice compatibility gates before implementation

| Check                                  | Required evidence / behavior                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supported merchant acceptance path     | Verify which wallet credential can be used with AgentCaller's exact Stripe account/API version and a one-off invoice. Check whether the hosted invoice page supports the relevant Link Pay Token/WebMCP flow, whether an SPT can pay the invoice through a supported API, or whether the only supported path is an ordinary card payment. Do not infer support from generic Checkout or Link logos.  |
| Same invoice, no duplicate debit       | A wallet payment must discharge the existing account/month invoice and reconcile its amount paid/remaining. If a separate payment object is required, prove Stripe's supported invoice payment-association flow and accounting before choosing it. Never create an independent charge and mark the invoice paid without payment evidence.                                                            |
| Automatic collection ownership         | Decide whether wallet payment is an alternative selected before invoice finalization or a supported recovery option on an existing invoice. Coordinate with Stripe's automatic saved-card attempts; verify already-processing payments before exposing another payment path. A late wallet approval and automatic card retry must never collect twice. No parallel application payment-retry engine. |
| Approval timing and variable amount    | Verify the spend request's approved amount, currency, merchant, expiry and credential lifetime cover the finalized invoice. Do not request a purchase credential during initial setup and assume it remains valid a month later. Test invoice adjustments, credit notes and any required new approval. Unattended wallet budgets are not an assumed capability.                                      |
| Credential reuse and consent           | Never save a single-use virtual card/token as the account's reusable monthly card or use it for another invoice. Paying one invoice does not grant later spending or automatic collection authority. Keep the MVP saved-card/allowance enrollment path intact.                                                                                                                                       |
| Tenant and merchant binding            | Bind a supported payment to its account, invoice, Customer and verified agent connection using server-side references. Wallet credentials cannot select a different account or invoice. Verify seller restrictions, amount/currency and buyer eligibility without exposing the underlying buyer credentials to the model or logs.                                                                    |
| Events, retries and reconciliation     | Test duplicate/late approvals, expired/declined spend requests, SCA, response loss, paid-before-response, partial amounts and repeated invoice events. The invoice remains the collection record; unresolved state does not permit a second payment or release credit exposure prematurely.                                                                                                          |
| Refunds, credit notes and disputes     | Prove refunds/credit notes/disputes remain linked to the original invoice/payment and work after a single-use credential expires. Prevent a refund plus duplicate payment or an overlapping dispute refund. No future wallet credit balance is introduced.                                                                                                                                           |
| Availability, pricing and host support | Confirm current buyer/merchant geography, Stripe access/tier, fees, target agent capabilities and supported test-mode fixtures. Check regional service availability independently of the existing saved-card Stripe integration.                                                                                                                                                                     |

The hosted invoice page and invoice payment-association APIs are investigation
starting points, not proof that every wallet token is accepted.
[Hosted Invoice Page](https://docs.stripe.com/invoicing/hosted-invoice-page),
[Attach a payment to an invoice](https://docs.stripe.com/api/invoices/attach_payment).
Shared-token direct payment is another documented wallet flow; do not introduce
MPP merely to add this future option.
[Wallet machine-payment flows](https://docs.stripe.com/agentic-commerce/agents/link-agent-wallet/machine-payments).

Deliver a small compatibility record with official API evidence and isolated
Stripe test-mode scenarios before proposing implementation. If invoice
compatibility is unproven, retain saved-card collection and label Agent Wallet
support as unavailable. No wallet SDK, credential storage, new funding enum,
schema migration or live wallet transaction is part of the MVP implementation
scope. An invoice payment-channel choice would not require duplicating call
execution or weakening the USD 10 exposure cap.
