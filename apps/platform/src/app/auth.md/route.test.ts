import { expect, it } from "vitest";
import { GET } from "./route";

it("publishes self-contained API-key discovery without OAuth claims", async () => {
  const response = GET();
  const markdown = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(
    "text/markdown; charset=utf-8",
  );
  expect(markdown).toMatch(/^# .*auth\.md$/m);
  expect(markdown).toContain("AI agents and applications");
  expect(markdown).toContain("manual provisioning");
  expect(markdown).toContain(
    "no public registration or API-key issuance endpoint",
  );
  expect(markdown).toContain("Authorization: Bearer");
  expect(markdown).toContain("https://agentcaller.io/api/v1/calls");
  expect(markdown).toContain("does not implement OAuth access tokens");
});
