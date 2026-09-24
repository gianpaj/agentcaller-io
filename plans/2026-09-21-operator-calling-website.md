# Operator calling website

## Goal and starting point

Build a mobile-friendly AgentCaller website where Gianfranco can sign in with
email and password, call a business, follow each attempt, cancel, and redial from
history. Use Google Phone's familiar Recents interaction as a reference: readable
rows, clear outcomes, a prominent call action, and details one tap away.

Nothing is deployed to production. No application tables have been created in
Supabase. SQL migrations and database models in the repository are implementation
artifacts, not evidence of a provisioned database or a working deployment.

The active workspace already contains a Next.js platform, Supabase authentication
integration, PostgreSQL schema/migrations, and a bounded `connect_me` worker.
Local website implementation has started but is an unfinished draft. The code,
setup, and verification below must be completed before describing it as usable.

## First-version scope

- One manually provisioned operator account; no public registration or invitations.
- Email/password login, session renewal, and sign-out through Supabase Auth.
- New call, Recents, call details, cancellation, and confirmed manual redial.
- Durable history and per-attempt status logs, accessible across devices.
- Operator-funded calls without x402; provider charges and limits still apply.
- Existing `connect_me` flow: call a Spanish or Italian geographic business,
  reach a person, dial the operator's Spanish mobile privately, require DTMF 1,
  then join the humans and silence the AI.
- Business and callback languages remain independently configurable.

The first screen launches `connect_me`, as confirmed by the user. Agent-only
information/reservation tasks remain outside this website scope.

## Confirmed UI and scheduling decisions

- Support multiple named presets, each with a business number, purpose,
  languages, selected callback number, and call limits. Saved presets are
  separate from individual scheduled jobs and historical attempts.
- Recents is the home screen. Show the upcoming run in a prominent card above
  history, with scheduled time, approval state, and Approve/Cancel actions.
  An active run occupies that prominent position with its current progress.
- Reusing a preset or history entry opens a short review with Call now and
  Schedule options. Each submission creates a fresh run and resets counters
  and timers; it does not reopen a previous attempt.
- Use server-recorded outbound dial initiation as the proposed scheduling
  reference for each attempt. Ringing starts at dialing; waiting, handoff, and
  conversation limits start at their respective stages. Retry delays use the
  previous attempt end time, not its dial-initiation time.
- Each retry group permits three attempts, with a 45-second business ringing
  timeout. After an eligible unsuccessful attempt ends, wait two minutes before
  the next attempt in that group. After the third attempt ends, wait 30 minutes
  before the first attempt of another group; do not add the two-minute interval
  to that group break. Only busy/no-answer triggers automatic retries. Default
  to two groups (six total attempts), with the group limit editable per preset.
  Permitted hours and the run end time always bound further attempts. The
  implementation must define and validate a finite maximum group limit; the
  current six-attempt backend ceiling is not an implemented configurable group
  limit.
- Business opening hours are optional, manually entered or imported. Never
  invent them. Respect stored hours in the business timezone. Show the user's
  local time too when it differs, accounting for daylight-saving transitions.
- A per-run override may authorize calling outside business hours from now or
  a scheduled start until an explicit later time on that same day. It must not
  modify the saved opening hours. Without opening hours, use the authorized
  run interval and attempt/duration limits.
- Add configurable outbound SMS reminders with a link to a dedicated website
  page for the scheduled run. The initial reminder example is ten minutes before
  dialing. The page shows the business, schedule/timezone, callback number, and
  limits, with explicit Approve and Cancel actions.
- Website approval received by the confirmation cutoff gates scheduled dialing.
  SMS sending failure, delivery failure, or missing delivery confirmation does
  not itself pause an approved run. An unapproved run cannot start, even when
  its reminder was successfully delivered. The operator can also reach the
  approval page through Upcoming if the SMS is unavailable.
- Opening an SMS link must be read-only: link previews and security scanners
  cannot approve, cancel, or start a call. Approval and cancellation use explicit
  authenticated mutations, scoped to the run and operator. Preserve the intended
  page across sign-in. SMS links must not contain provider credentials.
- Do not implement incoming SMS commands or STOP-based job cancellation.
  Cancellation happens on the website. Saved presets and history remain intact.
  Approval is available from 30 minutes before the scheduled start until that
  start, independently of reminder timing. One approval covers all retry groups
  in that run, bounded by its attempt limit, permitted hours, and end time.
  Without timely approval, the run expires without dialing. Returning later
  offers explicit Start now or Reschedule actions, never automatic late
  execution. Approval invalidation after edits still needs an explicit rule.
- Cancelling an unjoined run stops active business/callback legs immediately
  and cancels remaining retries. If the operator has already been patched into
  the business call, preserve that conversation and cancel only remaining
  scheduled activity. Keep the worker/session ownership needed to supervise
  the joined conversation and its duration limits. Treat cancellation racing
  with handoff as a serialized lifecycle transition: preserve an established
  bridge, prevent an uncompleted handoff from joining after cancellation.
  Proposed UI labels: Cancel call before joining, Stop retries after joining,
  and a separate explicit End call action for ending a joined conversation.
- No user-configured spend cap. Existing backend admission currently requires
  monetary caps: reconcile that implementation with this requirement explicitly,
  rather than silently removing checks or pretending the UI change is sufficient.
  Attempts, deadlines, and per-leg durations remain bounded.

Exclude public onboarding, contact syncing, browser audio, call recording, and
billing administration. Retain the existing API. Outbound SMS reminders and website approval extend the implementation scope.
Persist reminder attempts and per-run approval separately. Avoid an inbound SMS
command service; serialize website approval/cancellation with scheduled dispatch.

## 1. Bootstrap an empty Supabase database

1. Verify every migration against an isolated empty database. Apply the files in
   `supabase/migrations` in timestamp order, including hardening and connect-me
   migrations. Commit the payment enum migration before the following funding
   migration uses `not_required`.
2. Check schema/model alignment, foreign keys, indexes, idempotency constraints,
   and RLS. Use additional migrations for fixes; do not create tables by hand in
   the dashboard or use the legacy root Drizzle configuration.
3. Enable Supabase email/password authentication. Disable public signups and
   anonymous sign-in. Manually create and confirm the sole operator account.
4. Provide a repeatable provisioning command or parameterized SQL to **insert**
   its `client_profiles` row, linked by verified `auth.users.id`. Set
   `is_operator=true`, `enabled=true`, and `max_concurrent_calls=1`. Provisioning
   must not assume a profile exists, accept a browser-selected role, or embed
   the password in source, SQL, or logs.
5. Configure the platform's server-side database connection and Supabase keys.
   Keep table access behind authenticated platform code; browser users must not
   be able to read other profiles, API-key data, payment data, or call logs.
6. Seed only verified destination rate cards when preparing live calling. Keep
   demo calls and synthetic rates confined to disposable test databases.

Use the existing tables rather than add a second history store:

| Table                 | Website use                                                     |
| --------------------- | --------------------------------------------------------------- |
| Supabase `auth.users` | Managed identity and password authentication                    |
| `client_profiles`     | Operator entitlement, tenant ownership, concurrency limits      |
| `calls`               | One durable job, destination, purpose, limits, outcome, funding |
| `connect_jobs`        | Retry scheduling, attempt count, reserved quoted spend          |
| `call_attempts`       | Separate immutable-terminal attempts and their outcomes         |
| `call_legs`           | Business/callback connection and end timestamps, measured costs |
| `call_events`         | Timestamped status transitions associated with attempts         |
| `connect_receipts`    | Lifecycle-event deduplication                                   |

Keep existing API/payment/webhook tables required by the platform. No x402
settlement is created for an operator-funded job.

## 2. Authentication and deployment configuration

- Replace automatic OAuth redirection at `/login` with email/password fields.
  Preserve GitHub as an optional existing sign-in method, not a requirement.
- Verify the Supabase identity on every protected page and server action. Resolve
  the enabled profile from its immutable UID; never trust submitted tenant IDs.
- Refresh session cookies using the supported Next.js/Supabase server pattern.
  Sign-out must clear the actual session. Show useful expired-session states.
- Use generic login errors and Supabase's authentication rate limits. Password
  recovery for the initial single account can be operator-managed in Supabase.
- Separate portal configuration from telephony/payment/storage requirements so
  login and history can run before provider accounts are ready. Missing calling
  configuration must disable admission, not break the entire website.

## 3. Mobile-first website

Use the existing `apps/platform` application, with touch targets of at least
44 pixels, accessible labels, visible focus states, and no horizontal scrolling.

- **Recents (`/app`):** newest first, grouped by date, business label/number,
  readable state and outcome, timestamp, detail link, and redial action.
  Paginate with a stable timestamp-plus-ID cursor; do not truncate history to
  the latest 12 calls. Clearly distinguish active jobs from ended calls.
- **New call (`/app/calls/new`):** business number/country, optional business
  label, purpose, business language, callback mobile/language, explicit run
  start/end/timezone, optional business hours and per-run override, retry groups, and separate
  ringing/waiting/handoff/conversation limits. Start with one attempt for testing.
  No inferred business schedule or required monetary field. Use a mobile-friendly deadline input with an
  explicit timezone and server-side conversion/validation.
- **Details (`/app/calls/[id]`):** current job state, next retry eligibility,
  attempts in order, each leg's status/timing, outcome, spend reservation,
  measured cost or unknown, status timeline, and cancellation/redial actions.
- **Settings:** retain existing client controls without mixing them into Recents.
  Do not expose infrastructure secrets in the normal call flow.
- Poll active progress approximately every four seconds while visible, pause
  when hidden, resume on return, and offer manual refresh. Show stale/offline
  states honestly. Polling does not dial or advance the scheduler.

## 4. Admission, redial, and lifecycle logging

- Extract shared admission logic so API requests and authenticated website
  actions use the same validation, durable authorization, and scheduler path.
  The browser needs neither an AgentCaller API key nor a payment signature.
- Check operator entitlement, exact business/callback allowlists, deployment
  switch, rate coverage, window, expiry, and retry/duration limits on the server.
  Resolve the monetary-cap policy noted above before changing admission.
- Commit the job and authorization before dispatch. Serialize admission per
  profile; repeated submissions with one idempotency key return the same job.
  Preserve that key across a failed/uncertain submission retry.
- Redial opens a prefilled form and requires confirmation plus a fresh deadline.
  Each confirmed redial creates a new job; it never reopens a terminal attempt.
  Persist the source-call relationship if needed for reliable history navigation.
- An active job must be monitored or cancelled before another website call.
  Refusal/request-to-stop has no quick-redial action. Unknown dial results,
  worker loss, and unconfirmed cleanup require reconciliation before allowing
  another call to that destination, including from the New call form.
- Define a durable, operator-visible reconciliation path for ambiguous outcomes;
  avoid permanent unexplained lockouts or treating elapsed time as proof of hangup.
- Add durable preset and scheduled-start/reminder state, with schema contracts
  and migrations aligned. The scheduler must gate scheduled dialing on timely website
  approval, independently of reminder delivery. Approval, manual cancellation,
  edits, and dispatch must serialize against the same durable run state.
- Record accepted lifecycle changes as timestamped, attempt-linked events in the
  same transaction as state changes. Deduplicated/rejected events and heartbeats
  must not generate duplicate timeline entries. Store status metadata, not
  credentials, raw provider payloads, recordings, or transcripts.
- Distinguish SIP answer from detected human, callback acceptance, and bridged
  conversation. Display detection uncertainty and unknown costs honestly.

## 5. Verification before deployment

- Apply all migrations to an empty disposable database; provision the operator
  from scratch and verify RLS as anonymous and authenticated non-owner users.
- Test login failure/success, disabled or unlinked users, session refresh and
  sign-out, and access to another tenant's details, cancellation, and redial.
- Test call-input validation, disabled operator funding, destination allowlists,
  admission serialization, duplicate submissions, and unchanged API behavior.
- Test redial as a distinct job; reject active/refused/ambiguous source calls and
  attempts to bypass reconciliation by entering the same number in New call.
- Test lifecycle-log deduplication and ordering, retries/exhaustion, cancellation
  races, callback acceptance/decline, and provider failures with mocks.
- Test pagination, progress refresh/offline states, and phone-sized layouts with
  fixture data. Verify keyboard navigation, error messages, and pending buttons.
- Run package checks while iterating, then `pnpm typecheck`, `pnpm test`,
  `pnpm test:connect-db`, `pnpm format:check`, and `pnpm build`. Report existing
  failures separately; do not describe mock tests as PSTN verification.

## 6. Deployment and controlled live validation

1. Deploy the website with the provisioned database and sole operator account.
   Keep `CONNECT_OPERATOR_CALLS_ENABLED=false` and the allowlist empty initially.
   Login/history must work without placing a call.
2. Complete verified rates, Telnyx outbound permissions and caller IDs, authenticated
   LiveKit trunks, worker deployment, and the existing authenticated scheduler.
   Keep cleanup running independently of the browser.
3. Document exact environment variables, migration/provisioning commands, hosting
   requirements, and recovery procedures in existing setup documentation.
4. After offline validation, obtain owned test destinations and explicit live-test
   authorization. Enable only those exact numbers, one attempt, and a small cap.
5. Verify busy/no-answer, voicemail/IVR uncertainty, accepted and declined callback,
   hangup/cancel during handoff, joined-human audio/AI silence, worker loss, and
   duration limits. Compare persisted timings with provider records.
6. Test the post office only after those scenarios and separate authorization.
   The workflow remains a pre-production prototype until live evidence supports
   stronger claims.

## Completion criteria

From a fresh setup, the sole operator can sign in on a phone, submit an authorized
bounded job without x402, follow its durable attempts, cancel it, and deliberately
redial eligible history entries. Refreshes and concurrent clicks cannot create
accidental duplicate calls. A second user cannot access those records. Setup and
limitations are documented; no live test occurs without explicit authorization.
