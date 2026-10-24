import { expect, it } from "vitest";
import { GET } from "./route";

it("publishes the API-key and conditional OAuth credential workflows", async () => {
  const response = GET();
  const markdown = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(
    "text/markdown; charset=utf-8",
  );
  expect(markdown).toMatch(/^# .*auth\.md$/m);
  expect(markdown).toContain("AI agents and applications");
  expect(markdown).toContain("manual provisioning");
  expect(markdown).toContain("no public API-key issuance endpoint");
  expect(markdown).toContain("Authorization: Bearer");
  expect(markdown).toContain("https://agentcaller.io/api/v1/calls");
  expect(markdown).toContain("HTTP 503");
  expect(markdown).toContain(
    "https://agentcaller.io/.well-known/oauth-protected-resource/mcp",
  );
  expect(markdown).toContain("without an operator-created profile");
  expect(markdown).toContain("exact MCP resource audience");
  expect(markdown).toContain("does not approve spending");
  expect(markdown).toContain("does not offer autonomous agent registration");
  expect(markdown).toContain("https://docs.agentcaller.io/mcp");
  expect(markdown).toContain("https://docs.agentcaller.io/billing");
});
