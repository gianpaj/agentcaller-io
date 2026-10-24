import {
  test,
  expect,
  connectFreshAgent,
  control,
} from "./support/fixtures.mjs";
import { callTool, agentResponse } from "./support/agent-client.mjs";
import { enrollBilling, drainBillingHttp } from "./support/billing.mjs";
import {
  reserveCall,
  runFundedCall,
  drainConnectHttp,
} from "./support/calls.mjs";
import { runVoiceScenario } from "./support/jobs.mjs";

async function enrolledAgent(page) {
  const agent = await connectFreshAgent(page);
  await enrollBilling(page, agent.token);
  return agent;
}

test("busy and no-answer attempts charge only one connection fee without redialing", async ({
  page,
  db,
}) => {
  const agent = await enrolledAgent(page);
  for (const outcome of ["busy", "no_answer"]) {
    const result = await runFundedCall(agent.token, {
      key: outcome,
      scenario: { outcome },
    });
    expect(result.status).toMatchObject({
      state: "failed",
      usageState: "finalized",
      finalCents: 10,
    });
    const attempts =
      await db`select id, reason, rooms_cleaned_at from call_attempts where call_id=${result.call.id}`;
    expect(attempts).toHaveLength(1);
    expect(attempts[0].reason).toBe(outcome);
    expect(attempts[0].rooms_cleaned_at).not.toBeNull();
    expect(
      await db`select kind, connected_at from call_legs where attempt_id=${attempts[0].id}`,
    ).toEqual([{ kind: "business", connected_at: null }]);
  }
  expect((await control("state")).dispatches).toHaveLength(2);
  expect(
    (await db`select spent_cents,reserved_cents from billing_periods`)[0],
  ).toEqual({ spent_cents: 20, reserved_cents: 0 });
});

test("callback refusal and an intruder's DTMF cannot bridge answered legs", async ({
  page,
  db,
}) => {
  const agent = await enrolledAgent(page);
  for (const outcome of ["callback_declined", "callback_timeout"]) {
    const result = await runFundedCall(agent.token, {
      key: outcome,
      scenario: { outcome },
    });
    expect(result.status).toMatchObject({
      state: "failed",
      usageState: "finalized",
      finalCents: 60,
    });
    expect(result.status.outcome.reason).toBe(outcome);
    expect(
      (
        await db`select count(*)::int as n from call_events where call_id=${result.call.id} and type in ('connect.accept','connect.bridged')`
      )[0].n,
    ).toBe(0);
    const legs =
      await db`select kind,connected_at,ended_at,sip_call_id from call_legs where attempt_id in (select id from call_attempts where call_id=${result.call.id})`;
    expect(legs).toHaveLength(2);
    expect(
      legs.every((leg) => leg.connected_at && leg.ended_at && leg.sip_call_id),
    ).toBe(true);
  }
  expect(
    (await db`select spent_cents,reserved_cents from billing_periods`)[0],
  ).toEqual({ spent_cents: 120, reserved_cents: 0 });
});

test("a lost committed dial response retries its receipt without dialing twice", async ({
  page,
  db,
}) => {
  const agent = await enrolledAgent(page);
  const result = await runFundedCall(agent.token, {
    key: "lost-dial-response",
    scenario: { outcome: "connected", dropResponseFor: "dial" },
  });
  expect(result.status).toMatchObject({
    state: "completed",
    usageState: "finalized",
    finalCents: 60,
  });
  expect(
    (
      await db`select count(*)::int as n from call_attempts where call_id=${result.call.id}`
    )[0].n,
  ).toBe(1);
  expect(
    (
      await db`select count(*)::int as n from call_legs where attempt_id in (select id from call_attempts where call_id=${result.call.id})`
    )[0].n,
  ).toBe(2);
  expect(
    (
      await db`select count(*)::int as n from call_events where call_id=${result.call.id} and type='connect.dial'`
    )[0].n,
  ).toBe(2);
  expect(
    (
      await db`select count(*)::int as n from connect_receipts where attempt_id in (select id from call_attempts where call_id=${result.call.id}) and response->>'allowed'='true'`
    )[0].n,
  ).toBeGreaterThan(2);
});

test("cancelling a queued call releases its reservation without dispatch or usage", async ({
  page,
  db,
}) => {
  const agent = await enrolledAgent(page);
  const { call } = await reserveCall(agent.token, "cancel-before-dispatch");
  expect(call.isError).toBeUndefined();
  const endpoint =
    process.env.NEXT_PUBLIC_APP_URL + "/api/v1/calls/" + call.id + "/cancel";
  const headers = { authorization: "Bearer " + agent.token };
  expect((await fetch(endpoint, { method: "POST", headers })).status).toBe(200);
  expect((await fetch(endpoint, { method: "POST", headers })).status).toBe(200);
  await drainConnectHttp();
  await drainBillingHttp();
  expect(
    await callTool(agent.token, "get_call_status", { callId: call.id }),
  ).toMatchObject({
    state: "cancelled",
    usageState: "released",
    finalCents: 0,
  });
  expect((await control("state")).dispatches).toEqual([]);
  expect((await db`select count(*)::int as n from call_attempts`)[0].n).toBe(0);
  expect(
    (await db`select spent_cents,reserved_cents from billing_periods`)[0],
  ).toEqual({ spent_cents: 0, reserved_cents: 0 });
});

test("human disconnect before callback acceptance prevents the handoff", async ({
  page,
  db,
}) => {
  const agent = await enrolledAgent(page);
  const { call, input, quote } = await reserveCall(
    agent.token,
    "revoke-before-accept",
    {
      task: { acceptanceSeconds: 30, handoffSeconds: 40 },
    },
  );
  expect(quote.maximumCents).toBeLessThanOrEqual(input.maxAmountCents);
  expect(call.isError).toBeUndefined();
  await drainConnectHttp();
  const dispatch = (await control("state")).dispatches.find(
    (entry) => JSON.parse(entry.metadata).callId === call.id,
  );
  expect(dispatch).toBeTruthy();
  await page.goto("/app/connections");
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeVisible();
  const completion = runVoiceScenario({
    dispatch,
    outcome: "connected",
    holdCallbackPrompt: true,
    expectedReason: "cancelled",
    finishAllowed: false,
  });
  void completion.catch(() => {});
  const attemptId = JSON.parse(dispatch.metadata).attemptId;
  const releasePrompt = () =>
    control("command", {
      target: "livekit",
      action: "release-callback-prompt",
      attemptId,
    });
  try {
    await expect
      .poll(async () => (await control("state")).callbackPrompts[attemptId])
      .toBe("held");
    await expect
      .poll(
        async () =>
          (
            await db`select count(*)::int as n from call_legs where kind='callback' and connected_at is not null`
          )[0].n,
        { intervals: [25, 50, 100] },
      )
      .toBe(1);
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();
    await releasePrompt();
    await completion;
  } finally {
    await releasePrompt();
    await completion.catch(() => {});
  }
  await drainConnectHttp();
  await drainBillingHttp();
  expect((await db`select state from calls where id=${call.id}`)[0].state).toBe(
    "cancelled",
  );
  expect((await db`select status from agent_connections`)[0].status).toBe(
    "revoked",
  );
  expect((await db`select status from billing_authorizations`)[0].status).toBe(
    "revoked",
  );
  expect(
    (
      await db`select count(*)::int as n from call_events where call_id=${call.id} and type in ('connect.accept','connect.bridged')`
    )[0].n,
  ).toBe(0);
  expect((await agentResponse(agent.token, "tools/list")).status).toBe(403);
});
