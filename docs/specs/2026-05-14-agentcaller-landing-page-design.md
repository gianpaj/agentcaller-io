# AgentCaller.io Landing Page — Design Spec

**Date:** 2026-05-14
**Status:** Approved
**Goal:** A waitlist landing page for marketing / product validation, deployed to Vercel.

## Product

AgentCaller.io is an agentic tool and API service. It lets a user's AI agent (e.g.
OpenClaw) place real phone calls to businesses on the user's behalf — booking a
restaurant, checking availability, completing phone-only transactions — for businesses
that only operate by phone. It supports English and Spanish. Payments are made
per-call via x402 (USDC on Base), with no human in the loop.

## Decisions

- **Audience:** Both, user-leaning. Outcome-focused hero for end users; a secondary
  "For developers" section/CTA.
- **Form backend:** Custom Vercel serverless function writing to a Neon Postgres DB.
- **Visual style:** Dark, techy, terminal-UI aesthetic with a neon-green accent.
- **Language:** English only. (Spanish deferred.)
- **CTA type:** Waitlist.
- **Approach:** Static HTML/CSS/JS page + a single serverless function. No framework,
  no build step. Plus cheap robustness wins: server-side email validation and a
  `UNIQUE` constraint for duplicate-safe inserts.

## File Structure

```
agentcaller-io/
├── index.html          # the page
├── styles.css          # terminal-aesthetic styles, no framework
├── script.js           # form submit handling
├── data.json           # all copy, easy to edit
├── api/waitlist.js      # Vercel serverless fn → Neon
├── db/schema.sql        # waitlist table
├── vercel.json
├── package.json         # @neondatabase/serverless
├── .env.example         # DATABASE_URL
├── assets/              # favicon, og-image
└── README.md            # deploy + DB setup steps
```

## Page Sections & Copy Direction

1. **Nav** — logo, anchor links, "Join waitlist" button.
2. **Hero** (outcome-focused) —
   - Headline: "Your AI agent, on the phone."
   - Subheadline: "AgentCaller lets your agent call any business — book a table,
     check availability, get things done — even when the only way in is a phone
     number."
   - CTA: "Join the waitlist"
   - Visual: a faux terminal window showing a live call transcript.
3. **Features** (4 cards) — Calls real businesses · English & Spanish ·
   Agent-native payments (x402 / USDC on Base) · Simple API.
4. **How it works** (3 steps) — Agent sends a task → AgentCaller places the call →
   Structured result back, pay per completed call.
5. **For developers** (secondary section) — short pitch + a code snippet showing an
   x402 API call; "Read the docs" placeholder link.
6. **FAQ** (5–6 questions) — what it is, which businesses it can call, how payment
   works, supported languages, whether there is an API, launch timing.
7. **Final CTA** — waitlist form repeated.
8. **Footer** — copyright, minimal links.

## Form → API → DB

### `db/schema.sql`

`waitlist` table:

| column      | type                                   | notes              |
|-------------|----------------------------------------|--------------------|
| id          | BIGINT GENERATED ALWAYS AS IDENTITY PK |                    |
| email       | TEXT NOT NULL UNIQUE                   | duplicate-safe key |
| persona     | TEXT                                   | nullable; reserved for future use, no UI sets it yet |
| referrer    | TEXT                                   | from request       |
| user_agent  | TEXT                                   | from request       |
| created_at  | TIMESTAMPTZ NOT NULL DEFAULT now()     |                    |

### `api/waitlist.js`

- POST only; other methods return 405.
- Accepts JSON body `{ email }`. (`persona` column stays null for now.)
- Server-side email validation (format + length). Invalid → 400.
- Insert with `ON CONFLICT (email) DO NOTHING` — duplicate-safe; returns success
  either way so the endpoint does not leak who has signed up.
- Captures `referer` and `user-agent` from request headers.
- Returns `{ ok: true }` 200 on success, 400 bad email, 405 wrong method, 500 DB error.
- Uses `@neondatabase/serverless`, reads `DATABASE_URL` from env.

### `script.js`

- Intercepts form submit, POSTs JSON to `/api/waitlist`.
- Client-side email sanity check before submit.
- Button shows a loading state during the request.
- On success: hide the form, show a confirmation message.
- On error: show an inline error message; re-enable the form.

## Visual Design — Terminal Aesthetic

- Near-black background (`#0a0e0a`).
- Neon-green accent: pure neon (`#39ff14`) reserved for non-text glow, borders, and
  large headings; a slightly brighter / contrast-safe green for body-adjacent text so
  it meets WCAG AA 4.5:1.
- Monospace for headings and code; system sans-serif for body text.
- Motifs: `>` prompt prefixes, a blinking cursor, a faux terminal window in the hero,
  a subtle grid background, thin green card borders that glow on hover.
- Responsive and accessible (semantic HTML, heading hierarchy, focus states, form
  labels, skip link).

## Analytics

Plausible snippet in `<head>` with `data-domain="agentcaller.io"`, commented out until
ready to activate.

## Deployment

- `vercel.json` configures static assets + the `api/` function and security headers.
- Neon `DATABASE_URL` set as a Vercel environment variable.
- `README.md` documents: create Neon DB, run `db/schema.sql`, set `DATABASE_URL`,
  `vercel --prod`.

## Out of Scope (YAGNI)

- Rate limiting on the waitlist endpoint.
- Confirmation / double opt-in emails.
- Spanish translation of the page.
- A real documentation site.
- Authentication or a user dashboard.
