import { describe, expect, it } from "vitest";
import { normalizeDatabaseUrl } from "./index";

describe("normalizeDatabaseUrl", () => {
  it("uses libpq semantics for sslmode=require", () => {
    const result = new URL(
      normalizeDatabaseUrl(
        "postgresql://postgres:password@pooler.example.test:6543/postgres?sslmode=require",
      ),
    );

    expect(result.searchParams.get("sslmode")).toBe("require");
    expect(result.searchParams.get("uselibpqcompat")).toBe("true");
  });

  it("preserves an explicit compatibility choice", () => {
    const result = new URL(
      normalizeDatabaseUrl(
        "postgresql://postgres:password@pooler.example.test/postgres?sslmode=require&uselibpqcompat=false",
      ),
    );

    expect(result.searchParams.get("uselibpqcompat")).toBe("false");
  });

  it("does not weaken certificate-verifying modes", () => {
    const result = new URL(
      normalizeDatabaseUrl(
        "postgresql://postgres:password@pooler.example.test/postgres?sslmode=verify-full",
      ),
    );

    expect(result.searchParams.has("uselibpqcompat")).toBe(false);
  });
});
