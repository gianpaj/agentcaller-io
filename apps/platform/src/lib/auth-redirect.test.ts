import { describe, expect, it } from "vitest";
import {
  getAuthCallbackUrl,
  getPasswordRecoveryCallbackUrl,
  getSafeAuthRedirect,
} from "./auth-redirect";

describe("getAuthCallbackUrl", () => {
  it("uses the configured production URL before deployment URLs", () => {
    expect(
      getAuthCallbackUrl({
        NEXT_PUBLIC_APP_URL: "https://agentcaller.io",
        NEXT_PUBLIC_VERCEL_URL: "agentcaller-git-pr-42.vercel.app",
      }),
    ).toBe("https://agentcaller.io/auth/callback");
  });

  it("uses the generated Vercel preview URL when no production URL is configured", () => {
    expect(
      getAuthCallbackUrl({
        NEXT_PUBLIC_VERCEL_URL: "agentcaller-git-pr-42.vercel.app",
      }),
    ).toBe("https://agentcaller-git-pr-42.vercel.app/auth/callback");
  });

  it("uses the stable branch URL before the changing deployment URL", () => {
    expect(
      getAuthCallbackUrl({
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "agentcaller-git-pr-42.vercel.app",
        VERCEL_URL: "agentcaller-a1b2c3.vercel.app",
      }),
    ).toBe("https://agentcaller-git-pr-42.vercel.app/auth/callback");
  });

  it("uses the stable project URL for a production deployment", () => {
    expect(
      getAuthCallbackUrl({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "agentcaller.io",
        VERCEL_BRANCH_URL: "agentcaller-git-main.vercel.app",
      }),
    ).toBe("https://agentcaller.io/auth/callback");
  });

  it("uses VERCEL_URL when the framework-prefixed variable is unavailable", () => {
    expect(
      getAuthCallbackUrl({ VERCEL_URL: "agentcaller-abc123.vercel.app" }),
    ).toBe("https://agentcaller-abc123.vercel.app/auth/callback");
  });

  it("uses localhost during local development", () => {
    expect(getAuthCallbackUrl({})).toBe("http://localhost:3000/auth/callback");
  });

  it("routes password recovery through the callback", () => {
    expect(
      getPasswordRecoveryCallbackUrl({
        NEXT_PUBLIC_APP_URL: "https://agentcaller.io",
      }),
    ).toBe("https://agentcaller.io/auth/callback?next=%2Freset-password");
  });
});

describe("getSafeAuthRedirect", () => {
  const consent =
    "/oauth/consent?authorization_id=11111111-1111-4111-8111-111111111111";
  it.each([consent, "/billing/connect"])(
    "preserves a constrained onboarding continuation",
    (path) => {
      expect(getSafeAuthRedirect(path)).toBe(path);
    },
  );

  it.each([
    "/oauth/consent?authorization_id=not-a-request",
    `${consent}&next=https://example.com`,
    `${consent}&authorization_id=22222222-2222-4222-8222-222222222222`,
    `${consent}#fragment`,
    "/oauth/consent/../login?authorization_id=11111111-1111-4111-8111-111111111111",
    "/billing/connect?request=secret",
    "/billing/connect?next=https://example.com",
    "/\\example.com",
    "/%2fexample.com",
  ])("rejects an unconstrained continuation: %s", (path) => {
    expect(getSafeAuthRedirect(path)).toBe("/app");
  });
  it.each(["/app", "/reset-password"])("allows %s", (path) => {
    expect(getSafeAuthRedirect(path)).toBe(path);
  });

  it.each([null, "", "https://example.com", "//example.com", "/admin"])(
    "sends an untrusted destination to the app",
    (path) => {
      expect(getSafeAuthRedirect(path)).toBe("/app");
    },
  );
});
