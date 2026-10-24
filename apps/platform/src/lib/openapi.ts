import {
  connectMeTaskSchema,
  createCallSchema,
  createStripeCallSchema,
  quoteStripeCallSchema,
} from "@agentcaller/contracts";
import { z } from "zod";

function callInputSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
    override({ zodSchema, jsonSchema }) {
      // The runtime schema validates this custom input before transforming it.
      if (zodSchema === connectMeTaskSchema.shape.callingWindow) {
        jsonSchema.anyOf = [
          { const: "now", type: "string" },
          {
            type: "object",
            required: ["timezone", "weekdays", "start", "end"],
            properties: {
              timezone: {
                type: "string",
                maxLength: 64,
                description: "IANA timezone",
              },
              weekdays: {
                type: "array",
                minItems: 1,
                maxItems: 7,
                items: { type: "integer", minimum: 1, maximum: 7 },
              },
              start: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
              end: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
            },
          },
        ];
      }
    },
  });
}

const callId = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const errors = {
  "401": { description: "A valid credential is required" },
  "500": { description: "Internal server error" },
};
const agentSecurity = [{ apiKey: [] }, { agentToken: [] }];
const billingErrors = {
  "401": {
    description: "A valid API key or resource-bound OAuth token is required",
  },
  "403": {
    description: "Account or integration permission is unavailable or revoked",
  },
  "422": { description: "Invalid billing request" },
  "503": { description: "Billing or configured pricing is unavailable" },
};
const idempotencyKey = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  schema: { type: "string", minLength: 1, maxLength: 128 },
};
const missingCall = {
  "404": { description: "Call not found for this client" },
};

export const openapi = {
  openapi: "3.1.1",
  info: {
    title: "AgentCaller API",
    version: "0.1.0",
    description:
      "Pre-production call platform. Saved-card connect_me billing requires separate human spending approval, a saved card, current integration authority, and enabled paid calling. x402 connect_me remains blocked; operator-funded testing requires an enabled operator profile. Recording creation and retention are incomplete.",
  },
  servers: [{ url: "https://agentcaller.io" }],
  externalDocs: { url: "https://docs.agentcaller.io" },
  security: [{ apiKey: [] }],
  components: {
    securitySchemes: {
      apiKey: {
        type: "http",
        scheme: "bearer",
        description:
          "AgentCaller API key starting with ac_; see /auth.md for provisioning",
      },
      agentToken: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Resource-bound OAuth token with active integration consent. Discover the configured resource and authorization server at /.well-known/oauth-protected-resource/mcp; see /auth.md. Supported only by billing, quote, saved-card creation, and integration-scoped call read/cancel operations.",
      },
    },
    schemas: {
      CreateCall: callInputSchema(createCallSchema),
      CreateStripeCall: callInputSchema(createStripeCallSchema),
      QuoteStripeCall: callInputSchema(quoteStripeCallSchema),
    },
  },
  paths: {
    "/api/health": {
      get: {
        operationId: "getHealth",
        summary: "Check platform HTTP availability",
        description:
          "Does not check database, worker, payment, or provider readiness.",
        security: [],
        responses: {
          "200": { description: "Platform HTTP handler is responding" },
        },
      },
    },
    "/api/v1/calls": {
      get: {
        operationId: "listCalls",
        summary: "List this client's calls",
        parameters: [
          {
            name: "before",
            in: "query",
            schema: { type: "string", format: "date-time" },
            description:
              "Return calls created before this timestamp, up to 50 per page",
          },
        ],
        responses: {
          "200": {
            description: "Call summaries in data and a nullable nextCursor",
          },
          "400": { description: "Invalid pagination timestamp" },
          ...errors,
        },
      },
      post: {
        operationId: "createCall",
        summary: "Submit a bounded call task",
        security: agentSecurity,
        description:
          "X-AgentCaller-Funding: stripe_postpaid selects CreateStripeCall with integer maxAmountCents and a current quoteVersion; API keys must have linked billing authority, and OAuth tokens require calls:create permission. Saved-card requests cannot include PAYMENT-SIGNATURE or X-Payment. Other funding uses CreateCall with maxAmountUsd and requires an API key; x402 connect_me returns 503. Funding authorization and call state commit before dispatch. Destination policy, cross-field limits, schedules, expiry, voices, and client limits are validated by the server.",
        parameters: [
          idempotencyKey,
          {
            name: "X-AgentCaller-Funding",
            in: "header",
            schema: { type: "string", enum: ["operator", "stripe_postpaid"] },
            description:
              "Select saved-card billing or enabled operator-funded connect_me testing; omit for x402",
          },
          {
            name: "PAYMENT-SIGNATURE",
            in: "header",
            schema: { type: "string" },
            description:
              "Base64-encoded x402 payment payload; paid calling remains a prototype",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                anyOf: [
                  { $ref: "#/components/schemas/CreateCall" },
                  { $ref: "#/components/schemas/CreateStripeCall" },
                ],
              },
            },
          },
        },
        responses: {
          "201": {
            description:
              "Saved-card call reservation in data, including an idempotent replay",
          },
          "202": {
            description:
              "Accepted x402 or operator-funded call in data, including an idempotent replay",
          },
          "400": { description: "Missing or invalid Idempotency-Key" },
          "402": {
            description:
              "Payment required; requirements in the PAYMENT-REQUIRED header",
          },
          "403": {
            description:
              "Funding or integration spending authority is unavailable",
          },
          "409": {
            description:
              "Billing setup required (includes a human setup continuation), stale quote, conflicting idempotency key, or unavailable billing period/headroom",
          },
          "422": {
            description:
              "Request schema, destination, funding, or policy validation failed",
          },
          "429": {
            description: "Client call rate or concurrency limit reached",
          },
          "503": {
            description: "Funding mode or destination rate is unavailable",
          },
          ...errors,
        },
      },
    },
    "/api/v1/calls/{id}": {
      parameters: [callId],
      get: {
        operationId: "getCall",
        summary: "Get this client's call details",
        security: agentSecurity,
        description:
          "API keys receive client call details; OAuth returns only its integration's saved-card call status and requires calls:read permission.",
        responses: {
          "200": {
            description:
              "Call in data, with settlement and any connection job details",
          },
          ...missingCall,
          ...errors,
          ...billingErrors,
        },
      },
      delete: {
        operationId: "deleteCall",
        summary: "Delete this client's call",
        description:
          "connect_me deletion is blocked pending provider cleanup and payment reconciliation.",
        responses: {
          "204": { description: "Call deleted" },
          "409": { description: "Connection job deletion is blocked" },
          ...missingCall,
          ...errors,
        },
      },
    },
    "/api/v1/calls/{id}/cancel": {
      parameters: [callId],
      post: {
        operationId: "cancelCall",
        summary: "Cancel this client's call",
        security: agentSecurity,
        description:
          "OAuth cancellation is restricted to its integration's saved-card calls and requires calls:create and calls:read permissions.",
        responses: {
          "200": {
            description:
              "Cancelled call or connection job in data. Cancelling an ended connect_me job returns its existing state.",
          },
          "409": {
            description: "A call other than connect_me is already terminal",
          },
          ...missingCall,
          ...errors,
          ...billingErrors,
        },
      },
    },
    "/api/v1/calls/{id}/transcript": {
      parameters: [callId],
      get: {
        operationId: "getCallTranscript",
        summary: "Get an available transcript for this client's call",
        responses: {
          "200": { description: "Transcript in data" },
          "404": { description: "Call or transcript is unavailable" },
          ...errors,
        },
      },
    },
    "/api/v1/calls/{id}/recording": {
      parameters: [callId],
      get: {
        operationId: "getCallRecording",
        summary: "Get an available recording URL for this client's call",
        description:
          "Recording creation and consent capture are incomplete; this endpoint does not enable recording.",
        responses: {
          "200": {
            description: "Signed URL and expiresInSeconds (300) in data",
          },
          "404": {
            description: "Recording is unavailable, not consented, or expired",
          },
          ...errors,
        },
      },
    },
    "/api/v1/calls/quote": {
      post: {
        operationId: "quoteStripeCall",
        summary: "Quote a saved-card connection task",
        security: agentSecurity,
        description:
          "Requires calls:create permission and a consented integration. A quote does not authorize spending or reserve a call; it expires at the next five-minute UTC boundary.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/QuoteStripeCall" },
            },
          },
        },
        responses: {
          "200": {
            description:
              "USD maximumCents, quoteVersion, pricingVersion, scheduledFor, billing-period bounds, and expiresAt",
          },
          ...billingErrors,
        },
      },
    },
    "/api/v1/billing/setup": {
      post: {
        operationId: "setupBilling",
        summary: "Create or reuse a human billing setup link",
        security: agentSecurity,
        description:
          "Requires billing:setup permission. The returned setupUrl lets the human approve spending and save a card; calling this endpoint does not provide that consent.",
        parameters: [idempotencyKey],
        responses: {
          "200": {
            description:
              "status, setupRequestId, expiresAt, and human setupUrl",
          },
          "429": { description: "Too many billing setup requests" },
          ...billingErrors,
        },
      },
    },
    "/api/v1/billing/setup/{id}": {
      parameters: [{ ...callId, description: "Billing setup request ID" }],
      get: {
        operationId: "getBillingSetup",
        summary: "Get this integration's billing setup status",
        security: agentSecurity,
        description: "Requires billing:read permission.",
        responses: {
          "200": { description: "setupRequestId, status, and expiresAt" },
          "404": {
            description: "Setup request not found for this integration",
          },
          ...billingErrors,
        },
      },
    },
    "/api/v1/billing/status": {
      get: {
        operationId: "getBillingStatus",
        summary: "Read billing readiness and available spending headroom",
        security: agentSecurity,
        description:
          "Requires billing:read permission. Reports setup_required, blocked, disabled, or ready; tool consent and billing consent are separate.",
        responses: {
          "200": {
            description:
              "Billing status and available USD-cent limits and totals",
          },
          ...billingErrors,
        },
      },
    },
    "/api/v1/billing/usage": {
      get: {
        operationId: "getBillingUsage",
        summary: "List this integration's call usage",
        security: agentSecurity,
        description: "Requires billing:read permission.",
        parameters: [
          {
            name: "before",
            in: "query",
            schema: { type: "string", format: "date-time" },
            description:
              "Return usage created before this timestamp, up to 50 rows per page",
          },
        ],
        responses: {
          "200": {
            description: "Usage rows in data and a nullable nextCursor",
          },
          ...billingErrors,
        },
      },
    },
  },
};
