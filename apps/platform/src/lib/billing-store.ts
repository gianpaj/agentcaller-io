import {
  apiKeys,
  agentConnections,
  billingAccounts,
  billingAuditEvents,
  clientProfiles,
  calls,
} from "@agentcaller/database";
import type { AgentOperation, AgentPrincipal } from "@agentcaller/contracts";
import { and, eq, isNull } from "drizzle-orm";
import { ApiError } from "./auth";
import { database } from "./database";

export type BillingDB = ReturnType<typeof database>;
export type BillingTX = Parameters<Parameters<BillingDB["transaction"]>[0]>[0];

export async function lockBillingAccount(
  tx: BillingTX,
  id: string,
  clientId?: string,
) {
  const [account] = await tx
    .select()
    .from(billingAccounts)
    .where(
      and(
        eq(billingAccounts.id, id),
        clientId ? eq(billingAccounts.clientId, clientId) : undefined,
      ),
    )
    .for("update");
  if (!account) throw new ApiError(404, "Billing account not found");
  const [owner] = await tx
    .select()
    .from(clientProfiles)
    .where(eq(clientProfiles.id, account.clientId));
  if (!owner?.enabled) throw new ApiError(403, "Account is disabled");
  return account;
}

export async function lockAgentConnection(
  tx: BillingTX,
  principal: AgentPrincipal,
  operation: AgentOperation,
) {
  if (!principal.connectionId || !principal.operations.includes(operation))
    throw new ApiError(403, "A consented integration is required");
  const [connection] = await tx
    .select()
    .from(agentConnections)
    .where(
      and(
        eq(agentConnections.id, principal.connectionId),
        eq(agentConnections.clientId, principal.clientId),
      ),
    )
    .for("update");
  if (
    !connection ||
    connection.status !== "active" ||
    connection.revokedAt ||
    !connection.operations.includes(operation)
  )
    throw new ApiError(403, "Integration access is revoked");
  if (
    principal.credentialKind === "oauth" &&
    connection.oauthClientId !== principal.credentialId
  )
    throw new ApiError(403, "OAuth client mismatch");
  if (principal.credentialKind === "api_key") {
    const [key] = await tx
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.id, principal.credentialId),
          eq(apiKeys.clientId, principal.clientId),
          eq(apiKeys.connectionId, connection.id),
          isNull(apiKeys.revokedAt),
        ),
      );
    if (!key)
      throw new ApiError(403, "API key has no linked billing authority");
  }
  return connection;
}

export async function lockCallBillingAccount(tx: BillingTX, callId: string) {
  const [call] = await tx
    .select({ accountId: calls.stripeBillingAccountId })
    .from(calls)
    .where(eq(calls.id, callId));
  if (!call?.accountId) return null;
  return lockBillingAccount(tx, call.accountId);
}

export async function billingAudit(
  tx: BillingTX,
  account: { id: string; clientId: string },
  operationKey: string,
  kind: string,
  actorType: "human" | "agent" | "system" | "stripe" | "operator",
  actorId: string,
  detail: Record<string, unknown> = {},
) {
  await tx
    .insert(billingAuditEvents)
    .values({
      billingAccountId: account.id,
      clientId: account.clientId,
      operationKey,
      kind,
      actorType,
      actorId,
      detail,
    })
    .onConflictDoNothing();
}
