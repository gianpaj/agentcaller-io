import { describe, expect, it } from "vitest";
import {
  billingSetupToken,
  billingSetupTokenDigest,
  verifyBillingSetupToken,
} from "./billing-tokens";
const id = "11111111-1111-4111-8111-111111111111";
const secret = "isolated-unit-test-key-material-only";
const expires = new Date("2026-10-19T12:00:00Z");
const now = new Date("2026-10-18T12:00:00Z");
describe("opaque setup continuation", () => {
  it("reproduces a lost response without storing the plaintext token", () => {
    const token = billingSetupToken(id, 1, expires, secret);
    expect(token).toHaveLength(43);
    expect(token).toBe(billingSetupToken(id, 1, expires, secret));
    expect(
      verifyBillingSetupToken(
        token,
        billingSetupTokenDigest(token),
        expires,
        now,
      ),
    ).toBe(true);
  });
  it("binds request, generation, expiry and dedicated key", () => {
    const token = billingSetupToken(id, 1, expires, secret);
    for (const other of [
      billingSetupToken(
        "22222222-2222-4222-8222-222222222222",
        1,
        expires,
        secret,
      ),
      billingSetupToken(id, 2, expires, secret),
      billingSetupToken(id, 1, now, secret),
      billingSetupToken(id, 1, expires, secret + "rotated"),
    ])
      expect(
        verifyBillingSetupToken(
          other,
          billingSetupTokenDigest(token),
          expires,
          now,
        ),
      ).toBe(false);
    expect(
      verifyBillingSetupToken(
        token,
        billingSetupTokenDigest(token),
        expires,
        expires,
      ),
    ).toBe(false);
    expect(
      verifyBillingSetupToken("malformed", "malformed", expires, now),
    ).toBe(false);
  });
});
