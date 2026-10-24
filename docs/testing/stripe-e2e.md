# Mocked Stripe journey tests

Run from the repository root after installing dependencies:

```bash
pnpm --filter @agentcaller/platform exec playwright install chromium
pnpm test:stripe-e2e
pnpm test:stripe-e2e --grep "fresh human"
```

Docker must be running. The launcher owns PostgreSQL, a loopback provider
coordinator and a Next development server. It applies all migrations, supplies
synthetic credentials and cleans up its processes, container and temporary browser
diagnostics. It never reuses the application's database or a running developer
server. Runtime provider access is blocked; Next's development version lookup
receives a fixed local response.

The shared runtime proves fresh login/tool consent, an actual Stripe SDK setup
request, accounting with injected month-end time, the actual worker's rejected-claim
HTTP path and Node HTTP/fetch egress blocking. The full successful voice and
collection journey is being implemented in the separate test lanes.

## Shared fixture contract

All provider state lives in `apps/platform/e2e/support/coordinator.mjs`.
`control(path, input)` in `fixtures.mjs` authenticates fixture operations.
These endpoints are served by the test coordinator, never by the product.

- `state`: identity IDs, Stripe objects/request summaries, dispatches, deleted rooms
  and unexpected outbound origins. Do not upload raw object snapshots as reports.
- `reset`: reset fake provider state. The browser fixture also resets its owned
  database and seeds the explicit ES tariff.
- `command`: a provider's narrow scenario operation, with `target` (`identity`
  or `stripe`), `action` and operation-specific arguments.
- `stripe`: server interception forwards the real SDK's method, path, headers and
  body to `createStripeFake().request()`.
- `violation`: record blocked traffic. Unexpected traffic fails browser teardown.

`createIdentityFake(appUrl, origin)` and `createStripeFake()` provide
`reset()`, `snapshot()` and `control(action, input)`; their request handlers
return standard `Response` objects. Extend only the scenarios exercised by tests.

The platform sends real SDK dispatch/room-deletion requests to the coordinator.
The voice bridge consumes those dispatch records and calls the actual platform's
authenticated endpoints. It must never write call success or leg timestamps to SQL.

`runAccounting(at)` invokes the real billing pipeline with optional ISO billing
time in a separate Vitest process. It does not move the app, JWT or webhook clock.
`runVoiceScenario(scenario)` launches the voice Vitest bridge, passing
`E2E_VOICE_SCENARIO`. The proof scenario uses `{ proof: true }`; successful
scenarios supply actual dispatch metadata and simulated outcomes.

Use the existing focused suites for races and long-duration boundaries. These
tests prove application behavior under fake provider responses. Hosted OAuth,
Stripe/SCA, real telephony and actual provider expense verification remain in
[release readiness](../release-readiness.md).
