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
