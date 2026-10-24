import { expect, control } from "./fixtures.mjs";

export async function exchangeAgentCode(code, clientId) {
  return fetch(process.env.E2E_CONTROL_URL + "/auth/v1/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
    }),
  });
}

/** Login is optional only for reconnecting an already verified browser session. */
export async function connectAgent(page, { fresh = true } = {}) {
  const { identity } = await control("state");
  await page.goto(identity.consentUrl);
  if (fresh) {
    await expect(
      page.getByRole("heading", { name: "Your calling assistant" }),
    ).toBeVisible();
    await page.getByText("Other sign-in options").click();
    await page.getByRole("button", { name: "Continue with GitHub" }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Connect E2E agent" }),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Allow tool access" }).click();
  await expect(
    page.getByRole("heading", { name: "Agent connected" }),
  ).toBeVisible();
  const code = new URL(page.url()).searchParams.get("code");
  const response = await exchangeAgentCode(code, identity.clientId);
  expect(response.status).toBe(200);
  const session = await response.json();
  return {
    ...identity,
    code,
    token: session.access_token,
    refreshToken: session.refresh_token,
  };
}
