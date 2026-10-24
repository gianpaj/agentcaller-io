import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  control,
  installBrowserGuards,
} from "./support/fixtures.mjs";
import {
  agentRequest,
  agentResponse,
  callTool,
} from "./support/agent-client.mjs";
import {
  connectAgent,
  exchangeAgentCode,
} from "./support/identity-helpers.mjs";

const identityCommand = (action, input = {}) =>
  control("command", { target: "identity", action, ...input });
async function refreshAgent(agent) {
  return fetch(process.env.E2E_CONTROL_URL + "/auth/v1/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: agent.clientId,
      refresh_token: agent.refreshToken,
    }),
  });
}

test("discovery and fresh tool consent create one non-operator profile without spending", async ({
  page,
  db,
  request,
}) => {
  expect((await db`select count(*)::int as n from client_profiles`)[0].n).toBe(
    0,
  );
  const metadata = await request.get(
    "/.well-known/oauth-protected-resource/mcp",
  );
  expect(metadata.status()).toBe(200);
  expect((await metadata.json()).resource).toBe(
    process.env.NEXT_PUBLIC_APP_URL + "/mcp",
  );
  expect((await agentResponse(undefined, "tools/list")).status).toBe(401);
  expect((await db`select count(*)::int as n from client_profiles`)[0].n).toBe(
    0,
  );

  const agent = await connectAgent(page);
  expect(
    await db`select supabase_user_id, is_operator from client_profiles`,
  ).toEqual([{ supabase_user_id: agent.userId, is_operator: false }]);
  expect(
    await db`select subject, oauth_client_id, status from agent_connections`,
  ).toEqual([
    {
      subject: agent.userId,
      oauth_client_id: agent.clientId,
      status: "active",
    },
  ]);
  const listed = await agentRequest(agent.token, "tools/list");
  expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
    "get_billing_status",
    "get_call_status",
    "get_usage",
    "quote_call",
    "schedule_call",
    "setup_billing",
  ]);
  expect(await callTool(agent.token, "get_billing_status")).toMatchObject({
    status: "setup_required",
    reason: "no_billing_account",
  });
  expect((await db`select count(*)::int as n from billing_accounts`)[0].n).toBe(
    0,
  );
  expect((await db`select count(*)::int as n from calls`)[0].n).toBe(0);
});

test("denied human consent issues no agent credential or application profile", async ({
  page,
  db,
}) => {
  const { identity } = await control("state");
  await page.goto(identity.consentUrl);
  await page.getByText("Other sign-in options").click();
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect E2E agent" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Agent connection denied" }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("error")).toBe("access_denied");
  expect(
    (await exchangeAgentCode("unissued-code", identity.clientId)).status,
  ).toBe(400);
  expect((await control("state")).identity.approved).toBe(false);
  expect((await db`select count(*)::int as n from client_profiles`)[0].n).toBe(
    0,
  );
  expect(
    (await db`select count(*)::int as n from agent_connections`)[0].n,
  ).toBe(0);
});

test("reconnect preserves the same owner and OAuth client without duplicate records", async ({
  page,
  db,
}) => {
  const first = await connectAgent(page);
  expect((await exchangeAgentCode(first.code, first.clientId)).status).toBe(
    400,
  );
  const prepared = await identityCommand("prepare", {
    userId: first.userId,
    clientId: first.clientId,
  });
  expect(prepared.authorizationId).not.toBe(first.authorizationId);
  const reconnected = await connectAgent(page, { fresh: false });
  const refreshed = await refreshAgent(reconnected);
  expect(refreshed.status).toBe(200);
  expect(
    await callTool((await refreshed.json()).access_token, "get_billing_status"),
  ).toMatchObject({ status: "setup_required" });
  expect((await db`select count(*)::int as n from client_profiles`)[0].n).toBe(
    1,
  );
  expect(
    (await db`select count(*)::int as n from agent_connections`)[0].n,
  ).toBe(1);
  expect(await callTool(first.token, "get_billing_status")).toMatchObject({
    status: "setup_required",
  });
});

test("signed tokens still need the MCP audience, issuer, role and consented client", async ({
  page,
}) => {
  const agent = await connectAgent(page);
  for (const claims of [
    { aud: "authenticated" },
    { iss: "https://foreign-issuer.example/auth/v1" },
    { role: "service_role" },
  ]) {
    const { access_token } = await identityCommand("token", {
      authorizationId: agent.authorizationId,
      claims,
    });
    expect((await agentResponse(access_token, "tools/list")).status).toBe(401);
  }
  const parts = agent.token.split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  expect((await agentResponse(parts.join("."), "tools/list")).status).toBe(401);
  const { access_token } = await identityCommand("token", {
    authorizationId: agent.authorizationId,
    claims: { client_id: randomUUID() },
  });
  expect((await agentResponse(access_token, "tools/list")).status).toBe(403);
});

test("two humans and agents cannot consume another owner's consent or billing setup", async ({
  page,
  browser,
  db,
}) => {
  const first = await connectAgent(page);
  const firstSetup = await callTool(first.token, "setup_billing", {
    idempotencyKey: "first-human",
  });
  const secondIdentity = await identityCommand("new-human");
  await page.goto(secondIdentity.consentUrl);
  await expect(
    page.getByRole("heading", { name: "Connection expired" }),
  ).toBeVisible();
  expect((await db`select count(*)::int as n from client_profiles`)[0].n).toBe(
    1,
  );

  const context = await browser.newContext();
  await installBrowserGuards(context);
  try {
    const otherPage = await context.newPage();
    const second = await connectAgent(otherPage);
    const secondSetup = await callTool(second.token, "setup_billing", {
      idempotencyKey: "second-human",
    });
    expect(secondSetup.setupRequestId).not.toBe(firstSetup.setupRequestId);
    const foreignPoll = await callTool(second.token, "setup_billing", {
      idempotencyKey: "foreign-poll",
      setupRequestId: firstSetup.setupRequestId,
    });
    expect(foreignPoll.isError).toBe(true);
    expect(JSON.stringify(foreignPoll)).not.toContain(firstSetup.setupUrl);
    const foreignPage = await otherPage.goto(firstSetup.setupUrl);
    expect(foreignPage.status()).toBeGreaterThanOrEqual(400);
    await expect(
      otherPage.getByRole("heading", { name: "Authorize monthly billing" }),
    ).not.toBeVisible();
    expect(
      (
        await db`select status, consented_at from billing_setup_requests where id=${firstSetup.setupRequestId}`
      )[0],
    ).toMatchObject({ status: "pending", consented_at: null });
    const pair =
      await db`select p.supabase_user_id, c.subject, c.oauth_client_id from agent_connections c join client_profiles p on p.id=c.client_id order by p.supabase_user_id`;
    expect(pair).toHaveLength(2);
    for (const row of pair) expect(row.subject).toBe(row.supabase_user_id);
    expect(new Set(pair.map((row) => row.oauth_client_id)).size).toBe(2);
    expect(await callTool(first.token, "get_billing_status")).toMatchObject({
      status: "setup_required",
    });
  } finally {
    await context.close();
  }
});

test("disconnect revokes tool access and refresh without reviving the connection", async ({
  page,
  db,
}) => {
  const agent = await connectAgent(page);
  await page.goto("/app/connections");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();
  expect((await db`select status from agent_connections`)[0].status).toBe(
    "revoked",
  );
  expect((await agentResponse(agent.token, "tools/list")).status).toBe(403);
  expect((await refreshAgent(agent)).status).toBe(400);
  expect((await control("state")).identity.revokedGrants).toContain(
    agent.userId + ":" + agent.clientId,
  );
});

test("a delegated agent token cannot act as the human in the billing browser", async ({
  page,
  browser,
  db,
}) => {
  const agent = await connectAgent(page);
  const setup = await callTool(agent.token, "setup_billing", {
    idempotencyKey: "human-session-boundary",
  });
  const cookies = await page.context().cookies();
  const firstCookie = cookies.find((cookie) =>
    /^sb-.+-auth-token(?:\.0)?$/.test(cookie.name),
  );
  expect(firstCookie).toBeDefined();
  const baseName = firstCookie.name.replace(/\.0$/, "");
  const sessionCookies = cookies
    .filter(
      (cookie) =>
        cookie.name === baseName || cookie.name.startsWith(baseName + "."),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const encoded = sessionCookies.map((cookie) => cookie.value).join("");
  expect(encoded.startsWith("base64-")).toBe(true);
  const session = JSON.parse(
    Buffer.from(encoded.slice(7), "base64url").toString(),
  );
  session.access_token = agent.token;
  const context = await browser.newContext();
  await installBrowserGuards(context);
  try {
    await context.addCookies([
      {
        ...firstCookie,
        name: baseName,
        value:
          "base64-" +
          Buffer.from(JSON.stringify(session)).toString("base64url"),
      },
    ]);
    const delegatedPage = await context.newPage();
    const response = await delegatedPage.goto(setup.setupUrl);
    expect(response.status()).toBeGreaterThanOrEqual(400);
    await expect(
      delegatedPage.getByRole("heading", { name: "Authorize monthly billing" }),
    ).not.toBeVisible();
    expect(
      (
        await db`select status, consented_at from billing_setup_requests where id=${setup.setupRequestId}`
      )[0],
    ).toMatchObject({ status: "pending", consented_at: null });
    expect(
      (
        await db`select count(*)::int as n from billing_authorizations where status='active'`
      )[0].n,
    ).toBe(0);
    expect(await callTool(agent.token, "get_billing_status")).toMatchObject({
      status: "setup_required",
    });
  } finally {
    await context.close();
  }
});
