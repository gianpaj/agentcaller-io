import { connectMeTaskSchema, createCallSchema } from "@agentcaller/contracts";
import { z } from "zod";

const createCall = z.toJSONSchema(createCallSchema, {
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

const callId = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const errors = {
  "401": { description: "API key is missing, unknown, revoked, or disabled" },
  "500": { description: "Internal server error" },
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
      "Pre-production call platform. Unattended production calling and billing are not ready. Paid connect_me requests are blocked; operator-funded connect_me requires an enabled operator profile. Recording creation and retention are incomplete.",
  },
  servers: [{ url: "https://agentcaller.io" }],
  externalDocs: { url: "https://docs.agentcaller.io/docs" },
  security: [{ apiKey: [] }],
  components: {
    securitySchemes: {
      apiKey: {
        type: "http",
        scheme: "bearer",
        description:
          "AgentCaller API key starting with ac_; see /auth.md for provisioning",
      },
    },
    schemas: { CreateCall: createCall },
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
        description:
          "Requires committed funding authorization before dispatch. The server also validates destination policy, cross-field limits, calling windows, expiry, enabled voices, and client limits. Italy and Italian are restricted to connect_me; Call now requires maxAttempts 1 and an expiry within 30 minutes. Paid connect_me returns 503.",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string", minLength: 1, maxLength: 128 },
          },
          {
            name: "X-AgentCaller-Funding",
            in: "header",
            schema: { type: "string", enum: ["operator"] },
            description:
              "Operator-funded connect_me testing for enabled operator profiles",
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
              schema: { $ref: "#/components/schemas/CreateCall" },
            },
          },
        },
        responses: {
          "202": {
            description:
              "Accepted call in data, including an idempotent replay",
          },
          "400": { description: "Missing or invalid Idempotency-Key" },
          "402": {
            description:
              "Payment required; requirements in the PAYMENT-REQUIRED header",
          },
          "403": { description: "Operator funding is not enabled" },
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
        responses: {
          "200": {
            description:
              "Call in data, with settlement and any connection job details",
          },
          ...missingCall,
          ...errors,
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
        responses: {
          "200": { description: "Cancelled call or connection job in data" },
          "409": { description: "Call is already terminal" },
          ...missingCall,
          ...errors,
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
  },
};
