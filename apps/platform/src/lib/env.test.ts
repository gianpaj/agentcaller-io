import { afterEach, describe, expect, it, vi } from "vitest";
import { getDatabaseEnv, getLiveKitEnv, getR2Env, getSupabaseEnv } from "./env";

afterEach(() => vi.unstubAllEnvs());

describe("scoped server environment", () => {
  it("loads the dashboard core without provider configuration", () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:password@db.example.test/postgres",
    );
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("LIVEKIT_URL", "");
    vi.stubEnv("R2_ACCOUNT_ID", "");

    expect(getDatabaseEnv()).toEqual({
      DATABASE_URL: "postgresql://postgres:password@db.example.test/postgres",
    });
    expect(getSupabaseEnv()).toEqual({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    });
  });

  it("accepts the Vercel Supabase integration variable names", () => {
    expect(
      getDatabaseEnv({
        POSTGRES_URL:
          "postgresql://postgres:password@pooler.example.test/postgres",
      }),
    ).toEqual({
      DATABASE_URL:
        "postgresql://postgres:password@pooler.example.test/postgres",
    });
    expect(
      getSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      }),
    ).toEqual({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    });
  });

  it("prefers explicitly configured application variables", () => {
    expect(
      getDatabaseEnv({
        DATABASE_URL: "postgresql://explicit.example.test/postgres",
        POSTGRES_URL: "postgresql://integration.example.test/postgres",
      }),
    ).toEqual({
      DATABASE_URL: "postgresql://explicit.example.test/postgres",
    });
    expect(
      getSupabaseEnv({
        SUPABASE_URL: "https://explicit.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "explicit-key",
        NEXT_PUBLIC_SUPABASE_URL: "https://integration.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "integration-key",
      }),
    ).toEqual({
      SUPABASE_URL: "https://explicit.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "explicit-key",
    });
  });

  it("fails when an unconfigured integration is actually requested", () => {
    for (const name of [
      "LIVEKIT_URL",
      "LIVEKIT_API_KEY",
      "LIVEKIT_API_SECRET",
      "LIVEKIT_AGENT_EU",
      "LIVEKIT_AGENT_US",
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
    ])
      vi.stubEnv(name, "");

    expect(() => getLiveKitEnv()).toThrow();
    expect(() => getR2Env()).toThrow();
  });
});
