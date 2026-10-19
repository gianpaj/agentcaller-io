import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import type { AgentPrincipal } from "@agentcaller/contracts";
import { z } from "zod";

export function createAgentMcpServer(principal: AgentPrincipal) {
  const server = new McpServer({ name: "AgentCaller", version: "0.1.0" });
  if (principal.operations.includes("billing:read"))
    server.registerTool(
      "get_billing_status",
      {
        description:
          "Check whether this integration is ready to request paid calls.",
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      () => {
        const status = {
          status: "unavailable",
          reason: "billing_not_enabled",
          currency: "USD",
        };
        return {
          content: [
            {
              type: "text",
              text: "Billing enrollment is not enabled. Paid calls are unavailable.",
            },
          ],
          structuredContent: status,
        };
      },
    );
  return server;
}

/** One authenticated principal and server instance per request; no session registry. */
export function createAgentMcpHandler(principal: AgentPrincipal) {
  return createMcpHandler(() => createAgentMcpServer(principal), {
    legacy: "stateless",
    // The route closes the handler as soon as it returns; an SSE body would be aborted.
    responseMode: "json",
    maxRequestBodySize: 65536,
    maxSubscriptions: 0,
    keepAliveMs: 0,
  });
}
