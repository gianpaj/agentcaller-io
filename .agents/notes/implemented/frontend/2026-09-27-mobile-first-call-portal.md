# Mobile-first call portal

## Decision

The `/app` shell, Recents, and New call use Tailwind utilities and the existing
color variables. The user selected a mobile-first web app, not a desktop
dashboard reduced to fit a phone.

`apps/platform/src/app/app/layout.tsx` bounds content to `max-w-2xl`, provides
keyboard focus styles, and reserves space for bottom navigation and the device
safe area. `call-navigation.tsx` identifies the active destination with
`usePathname` and `aria-current`. Desktop keeps the same navigation model; a
sidebar and separate desktop navigation were rejected to keep one flow.

Recents has one primary action when empty. Populated rows prioritize destination,
outcome, and time. New call remains a single-page form with Business, Your
callback, When can we call?, and Call limits groups. Advanced duration controls
stay inside native `details`; a wizard would add state without reducing the
required information.

## Constraints

Calling-disabled status appears before the fields. The disabled fieldset,
explicit authorization, funding checks, idempotency, validation, limits, and
redial restrictions remain in place. UI testing must not enable or submit calls.
Settings and call-detail content are outside this styling pass; both inherit the
shared shell, and call detail also uses the shared refresh toolbar.

## Form recovery and scheduling

`CallForm` dispatches its action from `onSubmit` inside a transition rather than
using a form `action`, which resets uncontrolled inputs even when the server
returns an error. Validation, server, and transport failures keep the current
draft and idempotency key. Transport failures direct users to check Recents
before retrying; Next.js redirects propagate normally. Drafts live only in the
open page, not browser storage.

`portalCallInput` validates on the client and server. `portalCallError` maps
contract errors to readable field messages. The form focuses the first invalid
control and expands advanced limits when needed; general failures focus the
error summary. Client validation does not replace server authorization.

New calls default to the [Call now mode](2026-09-28-call-now-mode.md).
Choosing calling hours shows the schedule controls and retry limits.
The schedule uses a location selector, explicit calling days with Mon–Fri and
Every day shortcuts, native time controls, and a local date-time deadline.
No opening hours are inferred. The selected business timezone governs both the
window and deadline. Deadline conversion rejects daylight-saving gaps and
repeated times rather than guessing an instant. Existing explicit-offset
inputs remain accepted by the parser. Redial requires a fresh deadline.

## Verification

- Browser inspection of the shell covered 320px, 390px, 768px, and desktop,
  navigation, keyboard focus, expanded limits, and submit clearance above the nav.
- Form recovery checks at 320px, 390px, and 1440px found no horizontal overflow;
  day controls measured at least 48px high and inputs used at least 16px text.
- Invalid destination and empty-day validation preserved all entries and focused
  the destination. Intercepted transport failure preserved the same draft,
  authorization, and idempotency key and allowed retry. Requests were blocked
  before reaching the server; no calls were dispatched.
- Schedule screenshot capture timed out; visual screenshot review is incomplete.
- Fifteen UI tests cover navigation, history, pagination, redial links, form
  controls, defaults, bounds, authorization, schedule choices, and error markup.
- Parser and action tests cover timezone conversion, DST ambiguity, deadline
  bounds, field errors, funding restrictions, failures, and idempotent retry.
- Platform typecheck, production build, and 186 tests passed; 30 database
  integration tests were skipped. Changed files passed Prettier and diff checks.
