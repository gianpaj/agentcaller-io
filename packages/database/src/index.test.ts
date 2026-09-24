import { describe, expect, it } from "vitest";
import { normalizeDatabaseUrl } from "./index";

describe("normalizeDatabaseUrl", () => {
  it("drops the node-postgres compatibility flag", () => {
    const result = new URL(
      normalizeDatabaseUrl(
        "postgresql://postgres:password@pooler.example.test:6543/postgres?sslmode=require&uselibpqcompat=true",
      ),
    );

    expect(result.searchParams.get("sslmode")).toBe("require");
    expect(result.searchParams.has("uselibpqcompat")).toBe(false);
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
