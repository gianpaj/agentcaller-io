# Platform agent discovery

Date: 2026-10-23

## Evidence

The public site serves `apps/platform`. The root waitlist assets and OpenAPI
document do not describe or configure that deployment. The October 23 public scan
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
- Auth.md documents operator-provisioned `ac_` bearer credentials and optional
  MCP OAuth onboarding. Human sign-in and tool consent can create a first client
  profile; an agent cannot grant itself access.
- `MCP_ENABLED` defaults to `false`. When enabled and configured, the dynamic
  `/.well-known/oauth-protected-resource/mcp` route advertises the `/mcp`
  resource and configured Supabase issuer. OAuth bearer credentials authorize
  the integration's granted billing and paid call operations. Paid Stripe
  calling retains separate release gates and stays disabled by default.
- Publishing discovery must not imply production calling readiness. Metadata
  describes the implemented authentication paths without inventing an
  independent authorization server or automatic account registration service.
- Keep discovery in the platform rather than duplicating legacy assets or
  introducing a Cloudflare rule or a separate discovery service.

## October 23 discovery-only verification

The discovery-only implementation passed platform typecheck, lint, and 250
tests; 46 database integration tests were skipped. Platform and documentation
production builds passed. Production-mode local HTTP checks passed for status,
media types, sitemap XML, catalog links, OpenAPI, Auth.md, and homepage headers.
Changed files passed formatting checks. Lint reported the existing unresolved
shadcn UI alias warning. These results do not validate the merged billing and
MCP implementation.

## October 23 external limits

The advertised `docs.agentcaller.io` host failed DNS resolution during the
discovery-only verification. The catalog uses the documentation app's configured
URL; deployment validation must verify that host separately.

## October 23 public verification

Vercel production deployment `dpl_2Tt7PxymCy7fKGFakEA1qXxgGyHV` served the
discovery-only implementation at `https://agentcaller.io`. Direct public HTTP
checks passed for all discovery responses and homepage Link relations. This
deployment evidence does not establish that the merged billing and MCP code is
deployed.

The public scan at `2026-10-23T21:22:53.245Z` passed robots, sitemap, Link headers,
and API catalog. Auth.md returned HTTP 200 Markdown, but the scanner reported
`registrationMissing` for that deployment's manual provisioning method. The
discovery-only deployment exposed no callable registration or OAuth issuance
endpoint. The [protocol guide](https://workos.com/auth-md/docs/apps) requires
live registration and OAuth endpoints. [Issue 16](https://github.com/workos/auth.md/issues/16)
reports the same scanner outcome for self-contained documents without
registration endpoints.

## October 24 billing and MCP integration

The discovery documentation follows the merged billing and MCP implementation.
Auth.md and OpenAPI must distinguish operator provisioning from human-approved
OAuth onboarding and retain the paid-calling gates. The October 23 scanner
result is evidence for the discovery-only deployment, not an assessment of
these merged authentication paths.

OpenAPI describes the billing setup, readiness, usage and quote endpoints, both
call input formats, funding-specific responses and supported OAuth credentials.
Robots excludes billing and OAuth pages. Billing privacy headers and homepage
Link headers share one Next configuration.

Workspace typecheck, lint, tests and build pass. Platform tests pass 373 assertions;
75 database tests are skipped there and pass separately in disposable PostgreSQL:
29 billing and 46 connection tests. Production-mode HTTP checks pass for the
static discovery resources, homepage Link headers, billing privacy headers, and
HTTP 503 from disabled MCP transport and metadata routes.

Checkout parameter validation shares the injected request clock with expiry
creation. Without that propagation, the dated billing fixtures fail against wall
clock time; the unchanged billing branch reproduces those failures. The fix
passes all 29 billing database tests.

Changed files pass formatting checks. Repository formatting still flags 50
files, each byte-identical to the billing branch. The merged implementation has
not been deployed or checked with the public scanner.

## October 24 documentation host

`docs.agentcaller.io` now resolves and serves the documentation app from the
`agentcaller-docs` Vercel project. Pages moved to the site root, so discovery
links point to `https://docs.agentcaller.io` and old `/docs/*` paths redirect.
The OpenAPI server URL is relative, so a preview or self-hosted copy targets its
own host. The API catalog sends its `api-catalog` Link header on GET and HEAD.

## Open questions

- Should OpenAPI responses gain schemas for the call object, call and payment
  states, `nextCursor` and the error body? Agents currently get only text
  descriptions of results.
- Will the Auth.md scanner accept manual operator provisioning, or does the
  protocol require a live registration endpoint? See the October 23 public
  verification.
- The merged billing, MCP and discovery implementation has not yet been checked
  with the public scanner after deployment.
