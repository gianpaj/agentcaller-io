import { expect } from "@playwright/test";
import { callTool } from "./agent-client.mjs";
import { drainBillingHttp } from "./billing.mjs";
import { runVoiceScenario } from "./jobs.mjs";

export function callIntent(overrides = {}) {
  return {
    destination: "+34911234567",
    destinationCountry: "ES",
    language: "es",
    maxDurationSeconds: 120,
    maxAmountCents: 100,
    ...overrides,
    task: {
      type: "connect_me",
      callbackNumber: "+34612345678",
      callbackLanguage: "es",
      purpose: "Connect the test caller",
      maxAttempts: 1,
      callingWindow: "now",
      expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
      ringingSeconds: 10,
      waitingSeconds: 20,
      handoffSeconds: 20,
      callbackRingingSeconds: 10,
      acceptanceSeconds: 5,
      conversationSeconds: 30,
      maxIvrDigits: 0,
      ...overrides.task,
    },
  };
}
export async function reserveCall(token, key, overrides = {}) {
  const intent = callIntent(overrides);
  const quote = await callTool(token, "quote_call", intent);
  expect(quote.isError).toBeUndefined();
  const input = { ...intent, quoteVersion: quote.quoteVersion };
  const call = await callTool(token, "schedule_call", {
    ...input,
    idempotencyKey: key,
  });
  return { call, input, quote };
}
export async function drainConnectHttp() {
  const response = await fetch(
    process.env.NEXT_PUBLIC_APP_URL + "/api/internal/connect/drain",
    {
      method: "POST",
      headers: { authorization: "Bearer " + process.env.CRON_SECRET },
    },
  );
  expect(response.status).toBe(200);
  return response.json();
}
export async function runFundedCall(
  token,
  { key = "first-call", scenario = {}, input = {} } = {},
) {
  const reserved = await reserveCall(token, key, input);
  expect(reserved.call.isError).toBeUndefined();
  await drainConnectHttp();
  const response = await fetch(process.env.E2E_CONTROL_URL + "/control/state", {
    headers: { "x-e2e-token": process.env.E2E_CONTROL_TOKEN },
  });
  expect(response.status).toBe(200);
  const dispatch = (await response.json()).dispatches.find(
    (candidate) => JSON.parse(candidate.metadata).callId === reserved.call.id,
  );
  expect(dispatch).toBeTruthy();
  await runVoiceScenario({ dispatch, ...scenario });
  await drainConnectHttp();
  await drainBillingHttp();
  const status = await callTool(token, "get_call_status", {
    callId: reserved.call.id,
  });
  return { ...reserved, dispatch, status };
}
