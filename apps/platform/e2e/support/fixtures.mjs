import { test as base, expect } from "@playwright/test";
import { openTestDatabase, resetTestDatabase } from "./database.mjs";
import { handleStripePage } from "./stripe-browser.mjs";

export async function control(path, input) {
  const response = await fetch(
    process.env.E2E_CONTROL_URL + "/control/" + path,
    {
      method: input === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "x-e2e-token": process.env.E2E_CONTROL_TOKEN,
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    },
  );
  if (!response.ok)
    throw new Error(
      "Fixture operation failed: " + path + " (" + response.status + ")",
    );
  return response.json();
}
export const test = base.extend({
  db: async ({ baseURL: _baseURL }, use) => {
    const sql = openTestDatabase(process.env.DATABASE_URL);
    try {
      await use(sql);
    } finally {
      await sql.end({ timeout: 1 });
    }
  },
  _isolation: [
    async ({ context, db }, use) => {
      await resetTestDatabase(db);
      await control("reset", {});
      await installBrowserGuards(context);
      try {
        await use();
      } finally {
        const state = await control("state");
        expect(state.violations).toEqual([]);
        expect(state.stripe.unsupported ?? []).toEqual([]);
      }
    },
    { auto: true },
  ],
});

export async function installBrowserGuards(context) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      [process.env.NEXT_PUBLIC_APP_URL, process.env.E2E_CONTROL_URL].includes(
        url.origin,
      )
    )
      return route.continue();
    if (await handleStripePage(route)) return;
    await control("violation", { origin: url.origin });
    return route.abort();
  });
  await context.routeWebSocket("**/*", async (socket) => {
    const url = new URL(socket.url());
    const origin = url.origin.replace(/^ws/, "http");
    if (origin === process.env.NEXT_PUBLIC_APP_URL)
      return socket.connectToServer();
    await control("violation", { origin: url.origin });
    socket.close();
  });
}
export { expect };

export async function connectFreshAgent(page) {
  const { identity } = await control("state");
  await page.goto(identity.consentUrl);
  await expect(
    page.getByRole("heading", { name: "Your calling assistant" }),
  ).toBeVisible();
  await page.getByText("Other sign-in options").click();
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect E2E agent" }),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Allow tool access" }).click();
  await expect(
    page.getByRole("heading", { name: "Agent connected" }),
  ).toBeVisible();
  const code = new URL(page.url()).searchParams.get("code");
  const response = await fetch(
    process.env.E2E_CONTROL_URL + "/auth/v1/oauth/token",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        client_id: identity.clientId,
        grant_type: "authorization_code",
      }),
    },
  );
  expect(response.status).toBe(200);
  return { ...identity, token: (await response.json()).access_token };
}
