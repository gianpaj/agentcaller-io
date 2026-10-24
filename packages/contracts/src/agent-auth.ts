import { z } from "zod";

export const agentOperations = [
  "calls:read",
  "calls:create",
  "billing:setup",
  "billing:read",
] as const;
export const agentOperationSchema = z.enum(agentOperations);
export type AgentOperation = z.infer<typeof agentOperationSchema>;

export type AgentPrincipal = {
  clientId: string;
  connectionId: string | null;
  credentialId: string;
  credentialKind: "api_key" | "oauth";
  operations: AgentOperation[];
};

export const oauthConsentVersion = "agent-tool-access-v1";
export const authorizationIdSchema = z.uuid();
