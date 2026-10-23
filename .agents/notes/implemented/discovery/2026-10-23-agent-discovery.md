# Platform agent discovery

Date: 2026-10-23

## Evidence

The public site serves `apps/platform`. The root waitlist assets and OpenAPI
document do not describe or configure that deployment. The initial public scan
failed robots, sitemap, API catalog, homepage Link headers, and Auth.md checks.
Only the homepage is an indexable public platform page.

## Decisions

- Native Next metadata routes publish robots and the canonical homepage sitemap.
  Authentication, portal, and API paths are excluded from crawling.
- Static route handlers publish the RFC 9727 catalog, active OpenAPI description,
  and Auth.md. Next response headers advertise all four discovery relations.
- OpenAPI request fields come from the shared Zod contract. Its custom calling
  window needs an explicit JSON Schema override; server admission still enforces
  cross-field and policy constraints that JSON Schema does not express.
- Auth.md documents manual operator provisioning and bearer credentials. OAuth
  metadata and automatic registration are omitted because those services do not
  exist. Publishing discovery must not imply production calling readiness.
- Keep discovery in the platform rather than duplicating legacy assets or
  introducing a Cloudflare rule or a separate discovery service.

## Verification

Platform typecheck, lint, and 250 tests pass; 46 database integration tests are
skipped. Platform and documentation production builds pass. Production-mode
local HTTP checks pass for status, media types, sitemap XML, catalog links,
OpenAPI, Auth.md, and homepage headers. Changed files pass formatting checks.
Lint reports the existing unresolved shadcn UI alias warning.

## External limits

The advertised `docs.agentcaller.io` host fails DNS resolution. The catalog keeps
the documentation app's configured URL; DNS repair is outside this change.

## Public verification

Vercel production deployment `dpl_2Tt7PxymCy7fKGFakEA1qXxgGyHV` serves the
platform at `https://agentcaller.io`. Direct public HTTP checks pass for all
discovery responses and homepage Link relations.

The public scan at `2026-10-23T21:22:53.245Z` passes robots, sitemap, Link headers,
and API catalog. Auth.md returns HTTP 200 Markdown, but the scanner reports
`registrationMissing` for the documented manual provisioning method. No callable
registration or OAuth issuance endpoint exists. The
[current protocol guide](https://workos.com/auth-md/docs/apps) requires live
registration and OAuth endpoints; adding those is a separate authentication
change. [Issue 16](https://github.com/workos/auth.md/issues/16) reports the same
scanner outcome for self-contained documents without registration endpoints.
