import { describe, expect, it } from "vitest";
import { validateNewPassword } from "./password-recovery";

describe("validateNewPassword", () => {
  it("accepts matching passwords within the supported length", () => {
    expect(validateNewPassword("new-password", "new-password")).toBeNull();
  });

  it("rejects short and oversized passwords", () => {
    expect(validateNewPassword("short", "short")).toMatch(/8 characters/);
    expect(validateNewPassword("x".repeat(1025), "x".repeat(1025))).toMatch(
      /1024/,
    );
  });

  it("rejects a mismatched confirmation", () => {
    expect(validateNewPassword("new-password", "different-password")).toBe(
      "Passwords do not match.",
    );
  });
});
