# Stripe postpaid billing investigation

Date: 2026-10-18. Proposed; no implementation authorized.

## Evidence

The platform has API keys, Supabase profiles, x402 and operator connect funding.
Stripe, MCP and agent spending grants are absent. Paid x402 connect admission
is blocked. Generic settlement bills a minimum with missing duration and
cancellation uses request elapsed time. Connect metering preserves unknown
cost, but operational terminal checks can reject late usage observations.

## Proposed decisions

Use hosted Stripe card setup, explicit human spending grants, account-wide
transactional reservations and one monthly Stripe invoice without a subscription.
MVP onboarding includes OAuth, first-time eligible human/profile creation and
MCP setup/status tools with URL elicitation or an ordinary setup-link fallback.
Tool access and spending consent are separate; original requests resume safely.
Stripe owns collection, retries, emails and hosted payment/SCA recovery.
AgentCaller owns usage, allowances, idempotent invoice
issuance, reconciliation and service access. Keep x402 and operator funding
separate. Require measured usage and verified Stripe/provider settings before
enabling bounded connect calls for customers.

Business answer is the confirmed charging trigger, including failed handoff.
Unpaid usage plus reservations is capped at USD 10 per account across months.
Cancellation/revocation stops calls while consumed usage remains payable.
Evaluate Link Agent Wallet after the MVP, gated on invoice payment compatibility
and prevention of duplicate saved-card/wallet collection; no wallet is built.

The canonical evidence, schema proposal, tradeoffs, edge cases and verification
gates are in the [billing plan](../../../../plans/2026-10-18-stripe-agent-authorized-billing.md).
No source, migrations, configuration, dependencies or provider resources changed.

## Open decisions

Approve tariffs, reservation/retry defaults, initial calling scope, merchant/tax
rules and Invoicing settings. Verify metering, provider limits and customer
prompts. OAuth resource binding and target-host onboarding gate the MVP release.
