# Operator calling website

## Evidence

There is no production deployment and no application schema provisioned in
Supabase. The repository contains migrations, a call ledger, bounded connect-me
logic, and a basic portal. Website implementation is a local, unfinished draft.

## Proposed decisions

Extend the active Next.js platform with email/password login, mobile Recents,
call submission, attempt details, cancellation, and confirmed redial. Bootstrap
Supabase from migrations and manually provision one operator account linked by
its immutable auth UID. Reuse the existing job/attempt/leg/event tables.

Use operator funding for connect-me; retain its authorization, destination and
spend controls. Reject a separate website/backend/history database because it
would duplicate admission and state ownership. Unknown provider outcomes require
reconciliation before redial, rather than assuming failure.

## Open scope and verification

The first call screen assumes connect-me. Agent-only task completion needs
separate worker and funding work. Fresh-database bootstrap, session lifecycle,
mobile UI, admission/logging tests, and controlled PSTN tests remain to verify.

The implementation and setup sequence is in the
[website plan](../../../../plans/2026-09-21-operator-calling-website.md).
