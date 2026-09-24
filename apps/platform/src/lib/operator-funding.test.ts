import { expect, it } from "vitest";
import { createCallSchema } from "@agentcaller/contracts";
import { authorizeOperatorInput } from "./operator-funding";
import { settleCallOnce } from "./settlement";
import type { calls } from "@agentcaller/database";
const input = createCallSchema.parse({
  destination: "+34911234567",
  destinationCountry: "ES",
  language: "es",
  maxDurationSeconds: 900,
  maxAmountUsd: 5,
  task: {
    type: "connect_me",
    callbackNumber: "+34612345678",
    callbackLanguage: "es",
    purpose: "Owned number test",
    callingWindow: {
      timezone: "Europe/Madrid",
      weekdays: [1, 2, 3, 4, 5],
      start: "09:00",
      end: "17:00",
    },
    expiresAt: "2030-01-01T00:00:00Z",
  },
});
const env = {
  CONNECT_OPERATOR_CALLS_ENABLED: "true",
  CONNECT_OPERATOR_DESTINATIONS: "+34911234567,+34612345678",
};
const admin = { isOperator: true, enabled: true };
it("allows explicitly enabled operator funding for both allowlisted destinations", () => {
  expect(() => authorizeOperatorInput(admin, input, env)).not.toThrow();
});
it.each([{}, { isOperator: false }, { isOperator: true, enabled: false }])(
  "denies unprivileged or disabled profiles %j",
  (profile) => {
    expect(() => authorizeOperatorInput(profile, input, env)).toThrow(
      "operator profile",
    );
  },
);
it("defaults off and fails closed on malformed settings", () => {
  expect(() => authorizeOperatorInput(admin, input, {})).toThrow("disabled");
  expect(() =>
    authorizeOperatorInput(admin, input, {
      ...env,
      CONNECT_OPERATOR_MAX_USD: "unlimited",
    }),
  ).toThrow("misconfigured");
});
it("requires both destinations, not just the business, in the allowlist", () => {
  for (const list of ["", input.destination, "+34612345678"])
    expect(() =>
      authorizeOperatorInput(admin, input, {
        ...env,
        CONNECT_OPERATOR_DESTINATIONS: list,
      }),
    ).toThrow("Both destinations");
});
it("enforces the operator job cap", () => {
  expect(() =>
    authorizeOperatorInput(admin, { ...input, maxAmountUsd: 6 }, env),
  ).toThrow("operator job cap");
});
it("does not exempt existing task types from x402", () => {
  expect(() =>
    authorizeOperatorInput(
      admin,
      { ...input, task: { type: "information", questions: ["Hours?"] } },
      env,
    ),
  ).toThrow("connect_me only");
});
it("never sends operator jobs to settlement, even when called repeatedly", async () => {
  const call = { fundingSource: "operator" } as typeof calls.$inferSelect;
  expect(await settleCallOnce(call, 60)).toBe(false);
  expect(await settleCallOnce(call, undefined)).toBe(false);
});
