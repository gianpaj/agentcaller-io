import { describe, expect, it } from "vitest";
import { issuerRedirect, verifyOAuthAuthorization } from "./oauth-consent";

const user = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const details = {
  user: { id: user },
  authorization_id: id,
  client: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Test integration",
  },
  redirect_uri: "https://host.example/callback",
  scope: "openid",
};

describe("issuer authorization details", () => {
  it("binds the human and request using retrieved details", () => {
    expect(verifyOAuthAuthorization(details, user, id)).toMatchObject(details);
    expect(() => verifyOAuthAuthorization(details, id, id)).toThrow("session");
    expect(() => verifyOAuthAuthorization(details, user, user)).toThrow(
      "session",
    );
  });
  it("accepts only supported redirects and the registered destination", () => {
    expect(
      issuerRedirect(
        "https://host.example/callback?code=synthetic&state=synthetic",
        details.redirect_uri,
      ),
    ).toContain("code=");
    expect(
      issuerRedirect("http://127.0.0.1:3456/callback?code=synthetic"),
    ).toContain("127.0.0.1");
    for (const url of [
      "javascript:alert(1)",
      "http://public.example/callback",
      "https://user:password@host.example/callback",
      "https://attacker.example/callback",
      "https://host.example/other",
    ])
      expect(() => issuerRedirect(url, details.redirect_uri)).toThrow();
  });
});
