# Deploy `apps/docs` to docs.agentcaller.io

## Goal

Serve the Fumadocs app in `apps/docs` at `https://docs.agentcaller.io`.
Leave the `agentcaller` platform project (`agentcaller.io`) unchanged.

## Facts checked on 2026-10-24

- The `agentcaller` Vercel project (`prj_Bx9aPFBjf8xNycSmDhBvfL5CLJ5b`,
  team `team_SuI94EEo83gF2b7wF99lXwEi`) serves `apps/platform`. It owns
  the crons and Stripe and auth callbacks, so it stays as it is.
- `docs.agentcaller.io` has no DNS record. The `agentcaller.io` DNS is on
  Cloudflare.
- The platform already links to `https://docs.agentcaller.io` from
  `apps/platform/src/app/page.tsx` and `app/settings/page.tsx`. Those
  links are broken today.
- `apps/docs` has no workspace dependencies and no env vars. Every route
  is static. `pnpm --filter @agentcaller/docs build` passes locally.
- `/` redirects to `/docs`, and pages live under `/docs/<slug>`.
- `apps/docs` is on `main`. The billing page exists only on
  `codex/stripe-agent-billing`, so production shows it after that branch
  merges.
- The `sexyvoice-docs` project already uses the same pattern: a separate
  Next.js docs project with SSO on preview deployments only.

## Decision

Create a second Vercel project, `agentcaller-docs`, from the same GitHub
repo. Vercel Services and Microfrontends were rejected. Services would
move the production billing app into a Beta deployment model, and the
docs don't confirm cron support there. Microfrontends still need a
second project.

## Steps

### 1. Create the project (Vercel dashboard, import Git repository)

| Setting           | Value                                      |
| ----------------- | ------------------------------------------ |
| Repository        | `gianpaj/agentcaller-io`                   |
| Project name      | `agentcaller-docs`                         |
| Root Directory    | `apps/docs`                                |
| Framework preset  | Next.js (auto-detected)                    |
| Install / Build   | defaults (pnpm from root `packageManager`) |
| Node.js           | 24.x                                       |
| Production branch | `main`                                     |
| Env vars          | none                                       |

Keep "Include files outside the root directory" enabled (the default) so
that the root `pnpm-lock.yaml` and `pnpm-workspace.yaml` settings apply,
including `minimumReleaseAge`.

### 2. Skip builds for commits that don't touch docs

Settings → Git → Ignored Build Step:

```bash
npx turbo-ignore --fallback=HEAD^1
```

Platform-only pushes then skip the docs build, and the reverse holds
too. The `agentcaller` project is unchanged unless we also want this
there. That would be a separate decision.

### 3. Deployment protection

Use Vercel Authentication on previews only (`all_except_custom_domains`),
which matches the other projects. The production custom domain stays
public.

### 4. Verify the first production deployment

Before adding the domain, open `agentcaller-docs.vercel.app` and
check every page in the sidebar.

### 5. Add the domain

1. Vercel → `agentcaller-docs` → Domains → add `docs.agentcaller.io`.
2. Cloudflare → `agentcaller.io` DNS → add
   `CNAME docs cname.vercel-dns.com`, Proxy status **DNS only** (grey
   cloud). An orange-cloud proxy breaks Vercel certificate issuance.
3. Wait until Vercel shows the domain as Valid Configuration and the
   certificate has been issued.

### 6. Verify

```bash
curl -sI https://docs.agentcaller.io                # 200
curl -sI https://docs.agentcaller.io/dispatch       # 200
curl -sI https://docs.agentcaller.io/docs/dispatch  # 308 → /dispatch
```

Then click the Docs links on `agentcaller.io` and in the portal settings
page.

## Follow-ups (done 2026-10-24)

- The Fumadocs `baseUrl` is now `/`, so pages are served at the site root, for
  example `docs.agentcaller.io/dispatch`. Old `/docs/*` URLs return a permanent
  redirect.
- The README documents the docs deployment.
- The setup used Vercel's built-in skipping of unaffected projects instead of
  `turbo-ignore`, which is deprecated. The CNAME target is the
  project-specific value Vercel recommended.

## Rollback

Remove the domain from the project and delete the Cloudflare CNAME.
Nothing in the platform project changes, so it needs no rollback.
