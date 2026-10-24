import {
  test,
  expect,
  connectFreshAgent,
  control,
} from "./support/fixtures.mjs";
import { callTool } from "./support/agent-client.mjs";

test("fresh human consent and the real Stripe SDK reach only fake providers", async ({
  page,
  db,
}) => {
  expect((await db`select count(*)::int as n from client_profiles`)[0].n).toBe(
    0,
  );
  const agent = await connectFreshAgent(page);
  const profiles =
    await db`select supabase_user_id, is_operator from client_profiles`;
  expect(profiles).toEqual([
    { supabase_user_id: agent.userId, is_operator: false },
  ]);
  expect(
    (await db`select count(*)::int as n from agent_connections`)[0].n,
  ).toBe(1);
  expect(
    (
      await db`select count(*)::int as n from billing_authorizations where status='active'`
    )[0].n,
  ).toBe(0);
  const setup = await callTool(agent.token, "setup_billing", {
    idempotencyKey: "boundary-setup",
  });
  expect(setup.isError).toBeUndefined();
  await page.goto(setup.setupUrl);
  await expect(
    page.getByRole("heading", { name: "Authorize monthly billing" }),
  ).toBeVisible();
  await page
    .getByLabel("Name to use when introducing your call")
    .fill("Test Caller");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Agree and save a card with Stripe" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Simulated Stripe Checkout" }),
  ).toBeVisible();
  const state = await control("state");
  expect(state.stripe.requests.map((r) => r.path)).toContain(
    "/v1/checkout/sessions",
  );
  expect(
    state.stripe.objects.filter((o) => o.object === "customer"),
  ).toHaveLength(1);
  expect((await db`select count(*)::int as n from calls`)[0].n).toBe(0);
});
