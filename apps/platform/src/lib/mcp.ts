import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import {
  createStripeCallSchema,
  callInputJsonSchema,
  quoteStripeCallSchema,
  type AgentPrincipal,
  type AgentOperation,
} from "@agentcaller/contracts";
import { z } from "zod";
import { createBillingSetup, billingSetupStatus } from "./billing-setup";
import {
  getBillingStatus,
  getBillingUsage,
  quoteStripeCall,
  reserveStripeCall,
  BillingSetupRequired,
} from "./billing-usage";
import { getAgentCallStatus } from "./billing-agent";
import { ApiError } from "./auth";

export function createAgentMcpServer(principal: AgentPrincipal) {
  const server = new McpServer({ name: "AgentCaller", version: "0.1.0" });
  function tool(
    name: string,
    operation: AgentOperation,
    description: string,
    schema: z.ZodObject<Record<string, z.ZodType>>,
    readOnly: boolean,
    run: (input: Record<string, unknown>) => Promise<object>,
  ) {
    if (!principal.operations.includes(operation)) return;
    server.registerTool(
      name,
      {
        description,
        inputSchema: {
          "~standard": {
            ...schema["~standard"],
            jsonSchema: {
              input: () => callInputJsonSchema(schema),
              output: () => callInputJsonSchema(schema),
            },
          },
        },
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: false,
          openWorldHint: !readOnly,
        },
      },
      async (input) => {
        try {
          const result = await run(schema.parse(input));
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (error) {
          const detail =
            error instanceof BillingSetupRequired
              ? {
                  error: "billing_setup_required",
                  ...error.setup,
                  instruction:
                    "Ask the human to open setupUrl and approve billing, then retry the unchanged call with its original idempotency key. Opening the link grants no spending authority.",
                }
              : {
                  error:
                    error instanceof ApiError
                      ? error.message
                      : error instanceof z.ZodError
                        ? "Invalid tool input"
                        : "Billing is temporarily unavailable",
                };
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify(detail) }],
            structuredContent: detail,
          };
        }
      },
    );
  }
  tool(
    "setup_billing",
    "billing:setup",
    "Get a private human approval URL or poll an existing request. Share the link with the owner; an agent cannot consent to spending.",
    z
      .object({
        idempotencyKey: z.string().min(1).max(128),
        setupRequestId: z.uuid().optional(),
      })
      .strict(),
    false,
    (input) =>
      input.setupRequestId
        ? billingSetupStatus(principal, z.uuid().parse(input.setupRequestId))
        : createBillingSetup(principal, z.string().parse(input.idempotencyKey)),
  );
  tool(
    "get_billing_status",
    "billing:read",
    "Read this integration's billing readiness and shared account headroom.",
    z.object({}).strict(),
    true,
    () => getBillingStatus(principal),
  );
  tool(
    "quote_call",
    "calls:create",
    "Quote the full worst-case cost of every leg and attempt in integer USD cents. No call or reservation is created.",
    quoteStripeCallSchema,
    true,
    (input) => quoteStripeCall(principal, input),
  );
  tool(
    "schedule_call",
    "calls:create",
    "Reserve the full quoted job and schedule a bounded connect_me call. Keep the same idempotency key and input for retries. May return billing_setup_required.",
    createStripeCallSchema.safeExtend({
      idempotencyKey: z.string().min(1).max(128),
    }),
    false,
    (input) => {
      const { idempotencyKey, ...call } = input;
      return reserveStripeCall(
        principal,
        z.string().parse(idempotencyKey),
        call,
      );
    },
  );
  tool(
    "get_call_status",
    "calls:read",
    "Read a call created by this integration.",
    z.object({ callId: z.uuid() }).strict(),
    true,
    (input) => getAgentCallStatus(principal, z.uuid().parse(input.callId)),
  );
  tool(
    "get_usage",
    "billing:read",
    "List this integration's usage summaries. Card and hosted invoice URLs are private to the human portal.",
    z.object({ before: z.iso.datetime().optional() }).strict(),
    true,
    (input) =>
      getBillingUsage(principal, z.string().optional().parse(input.before)),
  );
  return server;
}

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
