# Human card setup and web-app paid calls

Status: proposed, 2026-10-23. Revised after product decisions the same day.

## Problem

A signed-in human cannot save or replace a card, or place a paid call, without
an agent connection.

- `createBillingSetup` locks an OAuth `agent_connections` row and creates that
  connection's `billing_authorizations` grant before any card exists
  (`apps/platform/src/lib/billing-setup.ts:60`).
- `billing_setup_requests`, `billing_authorizations` and `billing_call_usage`
  all require a `connection_id`. Checkout metadata binds each card to one.
- Connections are OAuth-only. Tokens resolve them by
  `(issuer, subject, oauth_client_id)` with the Supabase issuer
  (`apps/platform/src/lib/mcp-auth.ts:75`).
- `/app/billing` shows only "Ask your connected agent to run setup_billing"
  with no account, and hides card replacement with no active integration.
- `/app/calls/new` places only operator-funded `connect_me` calls
  (`apps/platform/src/app/app/calls/new/actions.ts:23`).
- Profiles are created only by OAuth consent or manual linking. Any other
  signed-in human sees "Access pending".

## Decisions

1. A human who adds a card in the web app can then place calls there with no
   further approval. Clicking "Call" after seeing the maximum cost is the
   confirmation.
2. When an agent places a call, the human confirms it in the agent's host app
   (for example, Claude Code's tool approval). The human approves the
   integration's spending once on the web; later calls need no web approval.
3. Any signed-in human gets a profile, so they can link a card or see what
   their agents did.
4. Spending limits can be set during first consent and edited afterwards.

Model, unchanged: one user → one profile → one billing account → one card.
Many integrations share that card. Each integration has its own grant and
limits, and all of them draw from one account-wide allowance.

## Non-goals

- Organisations, shared cards or several cards per account.
- Card changes through the Stripe customer portal. It stays invoice-only.
- Paid task types other than `connect_me`. The `calls` funding constraint
  already limits `stripe_postpaid` to `connect_me`.
- API key creation in the portal.
- Changing `STRIPE_BILLING_ENABLED`. It still gates every paid reservation.

## Design

### A. Self-serve profiles

- Add `SELF_SERVE_SIGNUP_ENABLED` (default `false`).
- When enabled, call `ensureClientProfileForUser` once after a verified human
  sign-in: in `/auth/callback` after `exchangeCodeForSession`, and in the
  password `signIn` action. Reject anonymous users and OAuth-client sessions,
  as `requireHumanSession` does.
- Pages and actions stay lookup-only (`findClientProfileForUser`). Viewing a
  page never provisions an account. Disabled profiles stay disabled.
- New profiles are `isOperator = false`, so the operator calling path is not
  exposed.

### B. The web app is a first-party integration

Model the web app as one more connection under the profile, so grants,
reservations, usage, limits and revocation reuse the existing code and
constraints.

Migration (append-only), e.g. `20261023120000_web_app_connection.sql`:

1. `ALTER TABLE agent_connections ADD COLUMN kind TEXT NOT NULL DEFAULT 'oauth'`
   with `CHECK (kind IN ('oauth','web'))`.
2. Partial unique index: one `kind = 'web'` connection per `client_id`.
3. `CHECK (kind <> 'web' OR (issuer = 'agentcaller:web' AND oauth_client_id =
'agentcaller-web'))`, so a web row can never match a Supabase-issued token.

Update `packages/database/src/schema.ts` to match.

Code:

- `ensureWebConnection(profile, userId)` creates or returns the profile's web
  connection, with `subject = userId`. The existing `(client_id, subject)` FK
  ties it to the profile owner. Operations: `calls:create`, `calls:read`,
  `billing:read`, `billing:setup`.
- `mcp-auth.ts` also filters `kind = 'oauth'`, as defence in depth.
- Contracts: `AgentPrincipal.credentialKind` gains `"human"`. Change
  `packages/contracts` first.
- `webPrincipal()` builds a principal from `requireHumanSession` plus the
  profile and its web connection. It is server-only and never accepted from
  request input.
- `lockAgentConnection`: for `"human"`, require `kind = 'web'` and
  `connection.subject` equal to the session UID.
- `/app/connections` lists only `kind = 'oauth'`. Disconnect never targets the
  web connection, and never calls the issuer's `revokeGrant` for it.

### C. Card setup from the web app

- `/app/billing` with no account shows "Add a card". Its server action calls
  `createBillingSetup(webPrincipal, key, "enroll")` and redirects to the
  setup URL. The existing consent page, Checkout and webhook reconciliation run
  unchanged.
- The consent page shows account limits (first enrollment) and web-app
  limits, which default to the account limits. Approval sets the account
  consent, collection consent and web grant in one step. Checkout completion
  activates the web grant, as it does for any integration.
- "Replace card or renew collection consent" always uses the web connection
  with `purpose = "replace_card"`. The integration select is removed. This
  fixes the no-active-integration gap, and stops card replacement through an
  agent's grant.
- The web grant is not revocable from the UI. Limits can be lowered, and
  withdrawing collection consent blocks all paid calls. A revoked grant is
  terminal by design and would lock the human out of web calls.

### D. Paid calls from the web app

- `/app/calls/new` is enabled when the web grant is active and
  `isStripeBillingEnabled()`. Operators keep the operator path.
- The form requests a quote (`quoteStripeCall`) and shows the maximum cost and
  remaining headroom before the "Call" button.
- The server action re-derives `webPrincipal()` and calls `reserveStripeCall`
  with the shown `quoteVersion` and the form's idempotency key. A changed quote
  returns "accept a fresh quote" (`billing-usage.ts:313`) and the form shows the
  new maximum. There is no other approval step.
- Errors map to the existing form state: setup required, blocked, limit
  exceeded or disabled.

### E. Agent grants without a second Checkout

When an agent runs `setup_billing` and the account already has a usable card:

- In `approveBillingSetup`, if the account is `active`, has
  `collectionConsent` and a `paymentMethodId`, and the request's
  `cardGeneration` is current, activate the grant and mark the request `ready`
  in the same transaction. The audit records `spending_consent` without a
  Checkout.
- Otherwise use Checkout, as today.
- The human still approves each integration's limits once on the web.

### F. Per-call confirmation in the agent app

- `schedule_call` gets `destructiveHint: true`, so hosts that respect
  annotations prompt the human before each call. `quote_call` stays read-only.
- `schedule_call` keeps requiring the quoted `maxAmountCents` and
  `quoteVersion`. Its description tells the agent to show the destination, task
  and maximum cost to the human before calling it.
- This is a host-side UX step and the server cannot verify it. The authority
  boundary stays the human-approved grant, its limits and the shared account
  allowance. Document this in `apps/docs`.
- Optional later: MCP elicitation for the confirmation where the client
  supports it. It is still client-reported.

### G. See what agents did

- Recents and call detail show who placed a call: an integration name or "Web
  app" for `stripe_postpaid` calls (`billing_authorization_id` →
  `connection_id` → `name`), "API" for x402 and "Operator" for operator calls.
  The join stays scoped by `client_id`.
- `/app/billing` already lists per-integration grants. Add per-integration
  spend for the current period from `billing_call_usage`.

### Docs

Update `apps/docs/content/docs/billing.mdx` (enrollment, web calls, host
confirmation and what it does not guarantee), the README billing status and
`.env.example` (`SELF_SERVE_SIGNUP_ENABLED`).

## Delivery order

Each step ships with its tests.

1. A: self-serve profiles behind the flag.
2. B and C: web connection and card setup. This fixes card replacement.
3. D: web paid calls.
4. E: agent grants without a second Checkout.
5. F and G: agent confirmation hints and attribution.

## Tests

### A. Profiles

- Callback and password sign-in provision exactly one profile when the flag is
  on, and none when it is off.
- Anonymous users and OAuth-client sessions never provision a profile.
- A disabled profile is not re-enabled by signing in.
- Billing and connections pages still never provision (existing tests).
- Integration: concurrent first sign-ins create one profile (existing test,
  extended to the callback path).

### B and C. Web connection and card setup

- SQL rejects a second web connection per client, and a web row with a
  Supabase issuer or another OAuth client ID.
- An OAuth token whose `sub` matches the user never resolves the web
  connection (`mcp-auth` unit test and integration test).
- `lockAgentConnection` rejects `"human"` for an OAuth connection, a web
  connection owned by another user, or a non-human principal on the web
  connection.
- The connections page hides the web connection, and disconnect refuses it.
- Add-card action: lookup-only profile, creates the web connection once and
  redirects to the setup URL. The same idempotency key returns the same
  request.
- Integration: web enrollment creates account, card, consent and an active web
  grant. Other integrations' grants are unchanged.
- Integration: replace card with zero OAuth connections succeeds, and existing
  agent grants keep working with the new card.
- Integration: replayed `checkout.session.completed` and return reconcile
  apply once. A stale Checkout cannot overwrite a newer card. Another user's
  session cannot approve.

### D. Web paid calls

- The form is disabled without an active web grant or with
  `STRIPE_BILLING_ENABLED=false`, and shows the quoted maximum when enabled.
- The action never trusts a submitted client, connection or grant ID.
- Integration: one reservation per idempotency key under concurrent submits. A
  changed quote is rejected. Per-call, web-grant and account limits are
  enforced. Withdrawn collection consent blocks the call.
- Operators still get the operator path. Non-operators never do.

### E. Agent grants

- Integration: with a current card and consent, approval activates the grant
  with no Checkout and records one audit event.
- With a stale `cardGeneration`, an unavailable card, withdrawn consent or a
  suspended account, approval requires Checkout.
- A revoked grant still cannot be reactivated.

### F and G. Agent confirmation and attribution

- MCP tool listing: `schedule_call` has `destructiveHint: true`, and
  `quote_call` has `readOnlyHint: true`.
- `schedule_call` without a matching `quoteVersion` is rejected (existing
  behaviour, asserted through MCP).
- Recents shows the integration name, "Web app", "API" or "Operator" and never
  reads another tenant's connection.
- Billing page per-integration spend matches `billing_call_usage` for the
  period.

## Open questions

1. Name and default of the sign-up flag, and whether self-serve accounts need a
   verified email before adding a card.
2. Should the web grant be able to pause without becoming terminal, for
   example by setting its monthly limit to zero?
3. Is MCP elicitation worth adding for clients that ignore tool annotations?
