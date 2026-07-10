import { describe, expect, it } from "vitest";
import { assertPublicWebhookUrl, isPrivateAddress } from "./webhook-url";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "2606:4700::1111"])("treats %s as public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("treats anything that is not an IP as private", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

describe("assertPublicWebhookUrl", () => {
  it("rejects non-HTTPS schemes", async () => {
    await expect(assertPublicWebhookUrl("http://example.com/hook")).rejects.toThrow(/HTTPS/);
  });

  it("rejects embedded credentials", async () => {
    await expect(assertPublicWebhookUrl("https://user:pass@example.com/hook")).rejects.toThrow(/credentials/);
  });

  it("rejects a literal private address without resolving DNS", async () => {
    await expect(assertPublicWebhookUrl("https://169.254.169.254/latest/meta-data")).rejects.toThrow(/private address/);
    await expect(assertPublicWebhookUrl("https://127.0.0.1/hook")).rejects.toThrow(/private address/);
  });

  it("rejects a bracketed private IPv6 literal", async () => {
    await expect(assertPublicWebhookUrl("https://[::1]/hook")).rejects.toThrow(/private address/);
  });

  it("rejects a malformed URL", async () => {
    await expect(assertPublicWebhookUrl("not a url")).rejects.toThrow(/malformed/);
  });
});
