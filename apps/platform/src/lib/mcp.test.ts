import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import type { AgentPrincipal } from "@agentcaller/contracts";
import { createAgentMcpHandler } from "./mcp";

vi.mock("./billing-usage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./billing-usage")>();
  return {
    ...actual,
    getBillingStatus: vi.fn(async () => ({
      status: "disabled",
      reason: "paid_calling_disabled",
    })),
    getBillingUsage: vi.fn(async () => ({ data: [], nextCursor: null })),
  };
});

const principal: AgentPrincipal = {
  clientId: "test-account",
  connectionId: "test-connection",
  credentialId: "test-client",
  credentialKind: "oauth",
  operations: ["billing:read"],
};

async function request(
  method: string,
  params: Record<string, unknown>,
  era: "modern" | "legacy",
  owner = principal,
) {
  const handler = createAgentMcpHandler(owner);
  const meta =
    era === "modern"
      ? {
          [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
          [CLIENT_INFO_META_KEY]: { name: "offline-test", version: "1" },
          [CLIENT_CAPABILITIES_META_KEY]: {},
        }
      : undefined;
  const response = await handler.fetch(
    new Request("https://agentcaller.example/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(era === "modern"
          ? {
              "MCP-Protocol-Version": "2026-07-28",
              "MCP-Method": method,
              ...(typeof params.name === "string"
                ? { "Mcp-Name": params.name }
                : {}),
            }
          : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: { ...params, ...(meta ? { _meta: meta } : {}) },
      }),
    }),
  );
  const text = await response.text();
  await handler.close();
  const data = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? text
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : text;
  return { response, result: JSON.parse(data ?? "null") };
}

describe("stateless MCP protocol compatibility", () => {
  it.each(["modern", "legacy"] as const)(
    "serves billing readiness over %s transport",
    async (era) => {
      const { result } = await request(
        "tools/call",
        { name: "get_billing_status", arguments: {} },
        era,
      );
      expect(result.error).toBeUndefined();
      expect(result.result.structuredContent).toMatchObject({
        status: "disabled",
        reason: "paid_calling_disabled",
      });
    },
  );
  it("advertises tools according to the verified operation grant", async () => {
    const { result } = await request("tools/list", {}, "modern");
    expect(
      result.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(["get_billing_status", "get_usage"]);
  });
  it("does not retain one request's principal or permissions in another", async () => {
    const { result } = await request("tools/list", {}, "modern", {
      ...principal,
      clientId: "another-account",
      operations: [],
    });
    expect(result.error).toMatchObject({ code: -32601 });
  });
  it("validates tool input and cannot start an unavailable call", async () => {
    const { result } = await request(
      "tools/call",
      { name: "get_billing_status", arguments: { clientId: "someone-else" } },
      "modern",
    );
    expect(result.result?.isError || result.error).toBeTruthy();
    const missing = await request(
      "tools/call",
      { name: "schedule_call", arguments: {} },
      "modern",
    );
    expect(missing.result.result?.isError || missing.result.error).toBeTruthy();
  });
});
