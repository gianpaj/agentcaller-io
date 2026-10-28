import {
  test,
  expect,
  connectFreshAgent,
  control,
  installBrowserGuards,
} from "./support/fixtures.mjs";
import { callTool } from "./support/agent-client.mjs";
import { callIntent, reserveCall, drainConnectHttp } from "./support/calls.mjs";
import {
  enrollBilling,
  stripeState,
  deliverStripeEvent,
  drainBillingHttp,
} from "./support/billing.mjs";

async function quoteWithSetupTime(token, intent) {
  let quote = await callTool(token, "quote_call", intent);
  expect(quote.isError).toBeUndefined();
  const remaining = Date.parse(quote.expiresAt) - Date.now();
  if (remaining < 20_000) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, remaining) + 100),
    );
    quote = await callTool(token, "quote_call", intent);
    expect(quote.isError).toBeUndefined();
  }
  expect(Date.parse(quote.expiresAt) - Date.now()).toBeGreaterThan(20_000);
  return quote;
}

test("setup-required creates no call or hold and the unchanged request succeeds after enrollment", async ({
  page,
  db,
}) => {
  const agent = await connectFreshAgent(page);
  const intent = callIntent();
  const quote = await quoteWithSetupTime(agent.token, intent);
  const request = {
    ...intent,
    quoteVersion: quote.quoteVersion,
    idempotencyKey: "enrollment-retry",
  };
  const pending = await callTool(agent.token, "schedule_call", request);
  expect(pending).toMatchObject({
    isError: true,
    error: "billing_setup_required",
  });
  expect(pending.setupRequestId).toBeTruthy();
  expect((await db`select count(*)::int as n from calls`)[0].n).toBe(0);
  expect(
    (await db`select count(*)::int as n from billing_call_usage`)[0].n,
  ).toBe(0);
  expect((await control("state")).dispatches).toEqual([]);

  const enrolled = await enrollBilling(page, agent.token);
  expect(enrolled.setupRequestId).toBe(pending.setupRequestId);
  const accepted = await callTool(agent.token, "schedule_call", request);
  expect(accepted.isError).toBeUndefined();
  expect(accepted).toMatchObject({
    state: "queued",
    usageState: "reserved",
    reservedCents: 80,
  });
  const replay = await callTool(agent.token, "schedule_call", request);
  expect(replay.id).toBe(accepted.id);
  expect((await db`select count(*)::int as n from calls`)[0].n).toBe(1);
  expect(
    (await db`select count(*)::int as n from billing_call_usage`)[0].n,
  ).toBe(1);
  expect(
    (await db`select reserved_cents,spent_cents from billing_periods`)[0],
  ).toEqual({ reserved_cents: 80, spent_cents: 0 });
  expect((await control("state")).dispatches).toEqual([]);
});

test("a browser integration limit reduction blocks the full worst-case reservation", async ({
  page,
  db,
}) => {
  const agent = await connectFreshAgent(page);
  await enrollBilling(page, agent.token);
  await page.goto("/app/billing");
  const grant = page
    .getByRole("article")
    .filter({ hasText: "E2E agent: active" });
  await expect(
    grant.getByLabel("Per-call limit (USD cents)", { exact: true }),
  ).toHaveValue("100");
  await grant
    .getByLabel("Per-call limit (USD cents)", { exact: true })
    .fill("50");
  await grant.getByRole("button", { name: "Save limits", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await db`select per_call_limit_cents from billing_authorizations`)[0]
          .per_call_limit_cents,
    )
    .toBe(50);
  await page.reload();
  await expect(
    grant.getByLabel("Per-call limit (USD cents)", { exact: true }),
  ).toHaveValue("50");

  const { call, quote } = await reserveCall(
    agent.token,
    "over-integration-ceiling",
  );
  expect(quote.maximumCents).toBe(80);
  expect(call.isError).toBe(true);
  expect(call.error).toContain("per-call ceiling");
  await drainConnectHttp();
  expect((await db`select count(*)::int as n from calls`)[0].n).toBe(0);
  expect(
    (await db`select count(*)::int as n from billing_call_usage`)[0].n,
  ).toBe(0);
  expect(
    (
      await db`select coalesce(sum(reserved_cents),0)::int as reserved from billing_periods`
    )[0].reserved,
  ).toBe(0);
  expect(
    (
      await db`select monthly_limit_cents,per_call_limit_cents from billing_accounts`
    )[0],
  ).toEqual({ monthly_limit_cents: 1000, per_call_limit_cents: 100 });
  expect(
    (
      await db`select monthly_limit_cents,per_call_limit_cents,status from billing_authorizations`
    )[0],
  ).toEqual({
    monthly_limit_cents: 1000,
    per_call_limit_cents: 50,
    status: "active",
  });
  expect((await control("state")).dispatches).toEqual([]);
});

test("a fresh browser login resumes the same hosted setup without granting authority early", async ({
  page,
  browser,
  db,
}) => {
  const agent = await connectFreshAgent(page);
  const pending = await enrollBilling(page, agent.token, { complete: false });
  await page.context().close();
  expect((await callTool(agent.token, "get_billing_status")).status).not.toBe(
    "ready",
  );

  const context = await browser.newContext();
  await installBrowserGuards(context);
  try {
    expect(await context.cookies()).toEqual([]);
    const resumed = await context.newPage();
    await resumed.goto(pending.setupUrl);
    await expect(
      resumed.getByRole("heading", { name: "Your calling assistant" }),
    ).toBeVisible();
    await resumed.getByText("Other sign-in options").click();
    await resumed.getByRole("button", { name: "Continue with GitHub" }).click();
    await expect(
      resumed.getByRole("heading", { name: "Authorize monthly billing" }),
    ).toBeVisible();
    await resumed.waitForLoadState("load");
    await resumed
      .getByLabel("Name to use when introducing your call")
      .fill("Test Caller");
    await resumed
      .getByLabel("Monthly integration limit (USD cents)")
      .fill("1000");
    await resumed.getByLabel("Per-call limit (USD cents)").fill("100");
    expect(
      (await db`select payment_method_id from billing_accounts`)[0]
        .payment_method_id,
    ).toBeNull();
    expect(
      (await db`select status from billing_authorizations`)[0].status,
    ).toBe("pending");
    await resumed.getByRole("checkbox").check();
    await resumed
      .getByRole("button", { name: "Agree and save a card with Stripe" })
      .click();
    await expect(
      resumed.getByRole("heading", { name: "Simulated Stripe Checkout" }),
    ).toBeVisible();
    const state = await stripeState();
    expect(
      state.objects
        .filter((object) => object.object === "checkout.session")
        .map((object) => object.id),
    ).toEqual([pending.sessionId]);
    expect(
      state.requests.filter(
        (request) =>
          request.method === "POST" && request.path === "/v1/checkout/sessions",
      ),
    ).toHaveLength(1);
    expect((await callTool(agent.token, "get_billing_status")).status).not.toBe(
      "ready",
    );

    await resumed
      .getByRole("button", { name: "Complete simulated card setup" })
      .click();
    await expect(
      resumed.getByRole("heading", { name: "Checking your card" }),
    ).toBeVisible();
    expect(
      (await db`select payment_method_id from billing_accounts`)[0]
        .payment_method_id,
    ).toBeNull();
    expect(
      (
        await deliverStripeEvent(
          "checkout.session.completed",
          pending.sessionId,
        )
      ).status,
    ).toBe(200);
    await drainBillingHttp();
    expect((await callTool(agent.token, "get_billing_status")).status).toBe(
      "ready",
    );
    expect(
      (
        await db`select status,stripe_session_id from billing_setup_requests`
      )[0],
    ).toEqual({ status: "ready", stripe_session_id: pending.sessionId });
    expect(
      (await db`select count(*)::int as n from client_profiles`)[0].n,
    ).toBe(1);
    expect(
      (await db`select count(*)::int as n from agent_connections`)[0].n,
    ).toBe(1);
    expect((await db`select count(*)::int as n from calls`)[0].n).toBe(0);
  } finally {
    await context.close();
  }
});
