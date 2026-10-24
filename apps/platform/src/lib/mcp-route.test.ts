import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
const state = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("./mcp-auth", () => ({ authenticateMcpPrincipal: state.authenticate }));
vi.mock("./billing-usage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./billing-usage")>();
  return {
    ...actual,
    getBillingStatus: vi.fn(async () => ({
      status: "disabled",
      reason: "paid_calling_disabled",
    })),
  };
});
import { ApiError } from "./auth";
import { POST, GET, OPTIONS } from "../app/mcp/route";
import { GET as metadata } from "../app/.well-known/oauth-protected-resource/mcp/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
function configure() {
  vi.stubEnv("MCP_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agentcaller.example");
  vi.stubEnv("SUPABASE_URL", "https://issuer.example");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-publishable");
}
describe("MCP HTTP boundary", () => {
  it("supports exact-origin browser discovery and bearer preflight without granting tool access", async () => {
    configure();
    vi.stubEnv("MCP_ALLOWED_ORIGINS", "https://host.example");
    const headers = {
      origin: "https://host.example",
      "access-control-request-headers":
        "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Name",
    };
    const response = await OPTIONS(
      new Request("https://agentcaller.example/mcp", {
        method: "OPTIONS",
        headers,
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://host.example",
    );
    expect(state.authenticate).not.toHaveBeenCalled();
    state.authenticate.mockRejectedValue(new ApiError(401, "OAuth required"));
    const challenge = await POST(
      new Request("https://agentcaller.example/mcp", {
        method: "POST",
        headers: { origin: headers.origin },
      }),
    );
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("access-control-expose-headers")).toContain(
      "WWW-Authenticate",
    );
    expect(
      (
        await OPTIONS(
          new Request("https://agentcaller.example/mcp", {
            method: "OPTIONS",
            headers: { ...headers, "access-control-request-headers": "Cookie" },
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("returns a complete tool result after the handler is closed", async () => {
    configure();
    state.authenticate.mockResolvedValue({
      clientId: "test-account",
      connectionId: "test-connection",
      credentialId: "test-client",
      credentialKind: "oauth",
      operations: ["billing:read"],
    });
    const response = await POST(
      new Request("https://agentcaller.example/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2026-07-28",
          "MCP-Method": "tools/call",
          "Mcp-Name": "get_billing_status",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "get_billing_status",
            arguments: {},
            _meta: {
              [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
              [CLIENT_INFO_META_KEY]: { name: "offline-test", version: "1" },
              [CLIENT_CAPABILITIES_META_KEY]: {},
            },
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).result.structuredContent).toMatchObject({
      reason: "paid_calling_disabled",
    });
  });
  it("stays disabled without feature configuration", async () => {
    vi.stubEnv("MCP_ENABLED", "false");
    expect(
      (await POST(new Request("https://agentcaller.example/mcp"))).status,
    ).toBe(503);
    expect(metadata().status).toBe(503);
    expect(state.authenticate).not.toHaveBeenCalled();
  });
  it("challenges unauthenticated requests with matching discovery", async () => {
    configure();
    state.authenticate.mockRejectedValue(new ApiError(401, "OAuth required"));
    const response = await POST(
      new Request("https://agentcaller.example/mcp", { method: "POST" }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://agentcaller.example/.well-known/oauth-protected-resource/mcp"',
    );
    expect(await metadata().json()).toMatchObject({
      resource: "https://agentcaller.example/mcp",
      authorization_servers: ["https://issuer.example/auth/v1"],
    });
  });
  it("rejects foreign origins before authenticating", async () => {
    configure();
    const response = await POST(
      new Request("https://agentcaller.example/mcp", {
        headers: { origin: "https://attacker.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect(state.authenticate).not.toHaveBeenCalled();
  });
  it("does not issue an authentication loop for revoked consent", async () => {
    configure();
    state.authenticate.mockRejectedValue(
      new ApiError(403, "Integration revoked"),
    );
    const response = await POST(new Request("https://agentcaller.example/mcp"));
    expect(response.status).toBe(403);
    expect(response.headers.has("www-authenticate")).toBe(false);
  });
  it("has no session stream or token details in provider errors", async () => {
    configure();
    state.authenticate.mockResolvedValue({ operations: [] });
    expect(
      (await GET(new Request("https://agentcaller.example/mcp"))).status,
    ).toBe(405);
    state.authenticate.mockRejectedValue(new Error("secret-provider-payload"));
    const response = await POST(new Request("https://agentcaller.example/mcp"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-provider-payload");
  });
});
