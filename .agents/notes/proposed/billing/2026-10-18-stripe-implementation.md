# Agent billing implementation

Date: 2026-10-18. Branch: `codex/stripe-agent-billing`.
Base: `feat/landing-page-refresh` at `fe01da0`.

## Decisions

Implement the [approved plan](../../../../plans/2026-10-18-stripe-agent-authorized-billing.md)
in tested commits. OAuth tool consent and spending consent remain separate.
Customer paid calling stays disabled until approved tariffs, issuer resource
binding, provider limits and the full MVP acceptance flow are verified.
Saved-card monthly Invoicing is the MVP; Link Agent Wallet stays future scope.

## Evidence

The base platform typecheck passes; 224 offline tests pass and 45 database tests
are skipped without a disposable database. Supabase Auth JS 2.110.1 exposes the
authorization-details, approval and denial APIs needed for consent. Its official
[token example](https://supabase.com/docs/guides/auth/oauth-server/token-security)
uses `aud: authenticated`; this does not meet the MCP resource requirement.

## Progress

- Isolated worktree created; original uncommitted planning files preserved.
- Dependencies installed with the pinned package manager and frozen lockfile.
- OAuth/MCP foundation: resource metadata, strict asymmetric JWT validation,
  separate tool consent, verified first-time profile creation, durable connection
  uniqueness and human revocation. API keys retain a distinct principal.
- The v2 server package includes stateless legacy compatibility; no deprecated
  legacy package or Express dependency is needed. Current requests require
  matching protocol, method and tool-name headers and the per-request envelope.
- Only billing readiness is exposed until the billing application functions exist.
- Platform typecheck and 273 offline tests pass. Disposable PostgreSQL passes
  6 onboarding/ownership/RLS tests and all 45 existing connect regression tests.

## Open release checks

- Confirm resource-bound Supabase issuance and target MCP host behavior.
- Approve customer tariff, rounding, tax, reservation/retry and calling scope.
- Verify carrier bounds, metering, multi-customer prompts and Stripe settings.
- Complete card setup, atomic reservations, usage and monthly invoice acceptance.
