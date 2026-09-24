# Operator Calling Website Design

## Goal

Build a mobile-first AgentCaller operator website (`apps/platform`) where a single operator (Gianfranco) can authenticate with email and password, launch and follow bounded `connect_me` calls, manage presets, approve scheduled runs with SMS reminder notifications, track live telephony progress, cancel safely, and redial from history.

The website integrates with the existing Next.js platform, Supabase PostgreSQL database, and bounded `connect_me` LiveKit/Telnyx worker.

## Architecture and UI Structure

The platform is implemented within `apps/platform` using Next.js App Router, Supabase Auth, and Tailwind CSS. Touch targets are at least 44 pixels across all mobile views, with visible focus states and no horizontal scrolling.

### 1. Recents Home Screen (`/app`)
- **Upcoming / Active Banner:** Pinned at top of the feed. Displays current scheduled run time, approval status badge, and compact `Approve` / `Cancel` actions. Transitions to active progress when a run is live.
- **History Feed:** Calls grouped by date (Today, Yesterday, Older), ordered newest first.
- **Expandable Row Trays:** Tapping a call row expands an inline action tray with:
  - `Call again`: Prefills the 3-step wizard with the destination, callback, and limits.
  - `Details`: Navigates to `/app/calls/[id]`.
  - `Delete`: Prompts for confirmation and deletes the single call record and its associated events.
- **History Retention:** Call metadata and event logs remain stored indefinitely until manually deleted by the operator.

### 2. Dedicated Run Approval Screen (`/app/runs/[id]/approval`)
- Dedicated page linked from the 10-minute outbound SMS reminder and the Recents banner.
- **Read-Only Gate:** Opening the URL via browser or link scanners is strictly read-only; mutations require authenticated submission.
- **Adaptive Timezone Display:**
  - When operator and business share the same timezone, displays a single timestamp with an explicit `Same timezone` badge (e.g. `Today, 10:30 AM (CEST)`).
  - When timezones differ, displays business local time and operator local time side-by-side.
- **Opening-Hours Override:** Checkbox toggles an override that reveals a 30-minute slot dropdown to select the attempt cutoff deadline for today. Dialing and retries are permitted outside opening hours only until this cutoff.
- **Actions:** Authenticated `✓ Save & Approve` (arms the run for automated dispatch) and `Cancel Run`.

### 3. Call Details & Telephony Progress (`/app/calls/[id]`)
- **4-Stage Stepper:** Visual indicator displaying progress:
  `1. Dial Business → 2. Human Detected → 3. Operator Callback → 4. Bridge Connected`.
- **Collapsible Attempt Cards:** Details each attempt within the run (attempt number, group, start time, ringing duration, carrier outcome, and measured cost).
- **Lifecycle Events Timeline:** Timestamped diagnostic milestones (SIP status, voice activity detection, DTMF 1 received, bridge established).
- **Contextual Cancellation:**
  - Before bridge: "Cancel call before joining" terminates both legs immediately and cancels future retries.
  - After bridge: "Stop retries after joining" preserves the active conversation while cancelling remaining retries; separate "End call" action terminates the active bridge.

### 4. New Call & Preset Review Flow (`/app/calls/new`)
- 3-step mobile wizard:
  - **Step 1 (Target):** Preset chip selector or manual number entry (E.164, ES/IT), business label, and purpose.
  - **Step 2 (Callback):** Operator mobile callback number and language selection (ES/IT).
  - **Step 3 (Timing & Limits):** Toggle between `Call now` and `Schedule`.
    - In `Call now` mode, submitting counts as immediate approval and dispatches attempt 1 immediately.
    - In `Schedule` mode, sets start time, timezone, and SMS reminder lead time.

## Scheduling, Lifecycle & State Transitions

### State Machine
- Job states: `scheduled` → `approved` → `dispatching` → `active` → `completed` | `failed` | `cancelled` | `expired`.
- **Approval Cutoff Window:** Scheduled runs open for approval 30 minutes before the scheduled start. If approval is not recorded by the scheduled start, the run transitions to `expired` without dialing. Expired runs offer explicit `Start now` or `Reschedule` actions; they never execute automatically.
- **Approval Invalidation:** Modifying any parameter (destination, callback, schedule, override, or retry limits) on an already-approved run immediately resets its state to `scheduled` (unapproved), requiring re-approval.
- **Retry Schedule:** 3 attempts per retry group with a 45-second ringing timeout.
  - 2-minute delay following an eligible busy or unanswered attempt within a group.
  - 30-minute delay between groups.
  - Default 2 groups (6 total attempts ceiling).
  - Dialing is strictly bounded by business opening hours unless the per-run override cutoff is active.

## Data, Admission & Safety Safeguards

### Database Integration
Uses existing Supabase PostgreSQL tables:
- `auth.users` & `client_profiles`: Single operator profile (`is_operator=true`, `max_concurrent_calls=1`).
- `calls` & `connect_jobs`: Job definitions, presets, scheduling, and approval states.
- `call_attempts`, `call_legs`, and `call_events`: Immutable attempt records, leg timings, and deduplicated event logs.

### Safety Rules
- **Server Safety Ceiling:** User-facing spend cap inputs are removed in favor of a server-enforced deployment safety ceiling on duration and provider charges.
- **Admission Serialization:** Web requests and scheduled dispatch serialize admissions per operator profile with idempotency keys to prevent duplicate dialing on concurrent clicks.
- **Telephony Reconciliation:** Indeterminate attempts or worker connection losses flag the run as ambiguous, locking that destination from rapid automated redialing until the operator reviews the outcome.

## Verification Plan

1. **Database & Auth:** Verify migrations on an isolated Supabase database; verify single-operator profile provisioning, RLS policies, and session cookie refresh.
2. **UI & Accessibility:** Verify all views render on a mobile viewport (375px) with $\ge 44\text{px}$ touch targets, visible focus, and no horizontal scroll.
3. **Scheduler & Lifecycle:** Test approval window, cutoff auto-expiration, edit-invalidation rule, retry delays (2m attempt, 30m group), and opening-hours override cutoffs with simulated clocks.
4. **Handoff & Cancellation:** Test cancellation races before and after DTMF 1 bridge using telephony mocks.
5. **Controlled Live Calling:** Execute pre-authorized test calls to owned Spanish and Italian destinations to verify live Telnyx dialing, human detection, operator callback, DTMF 1 bridge, and AI silencing.
