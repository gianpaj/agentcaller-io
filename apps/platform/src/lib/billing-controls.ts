import { randomUUID } from "node:crypto";
import {
  agentConnections,
  apiKeys,
  billingAccounts,
  billingAuthorizations,
  billingCallUsage,
  billingPeriods,
  billingSetupRequests,
  calls,
} from "@agentcaller/database";
import {
  billingLimitsSchema,
  type BillingLimits,
} from "@agentcaller/contracts";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "./auth";
import { database } from "./database";
import { billingAudit, lockBillingAccount } from "./billing-store";
import { cancelConnect } from "./connect-me";

export async function revokeBillingAccess(
  clientId: string,
  connectionId: string,
  toolAccess: boolean,
  db = database(),
  now = new Date(),
) {
  z.uuid().parse(connectionId);
  const result = await db.transaction(async (tx) => {
    const [mapping] = await tx
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.clientId, clientId));
    const account = mapping
      ? await lockBillingAccount(tx, mapping.id, clientId, false)
      : null;
    const [connection] = await tx
      .select()
      .from(agentConnections)
      .where(
        and(
          eq(agentConnections.id, connectionId),
          eq(agentConnections.clientId, clientId),
        ),
      )
      .for("update");
    if (!connection) return null;
    if (toolAccess)
      await tx
        .update(agentConnections)
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where(eq(agentConnections.id, connection.id));
    await tx
      .update(billingAuthorizations)
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(billingAuthorizations.connectionId, connection.id),
          eq(billingAuthorizations.clientId, clientId),
          inArray(billingAuthorizations.status, ["pending", "active"]),
        ),
      );
    await tx
      .update(billingSetupRequests)
      .set({ status: "revoked", updatedAt: now })
      .where(
        and(
          eq(billingSetupRequests.connectionId, connection.id),
          inArray(billingSetupRequests.status, [
            "pending",
            "consented",
            "creating_checkout",
            "processing",
          ]),
        ),
      );
    if (account)
      await billingAudit(
        tx,
        account,
        `revoke:${connection.id}:${toolAccess ? "tools" : "spend"}`,
        toolAccess ? "connection_revoked" : "spending_revoked",
        "human",
        connection.subject,
        { connectionId },
      );
    return {
      ...connection,
      ...(toolAccess ? { status: "revoked", revokedAt: now } : {}),
    };
  });
  if (result) {
    const rows = await db
      .select({ callId: billingCallUsage.callReference })
      .from(billingCallUsage)
      .innerJoin(calls, eq(calls.id, billingCallUsage.callReference))
      .where(
        and(
          eq(billingCallUsage.clientId, clientId),
          eq(billingCallUsage.connectionId, connectionId),
          isNull(calls.endedAt),
        ),
      );
    for (const row of rows) await cancelConnect(row.callId, clientId, db);
  }
  return result;
}

export async function updateBillingLimits(
  clientId: string,
  userId: string,
  limits: BillingLimits,
  authorizationId?: string,
  db = database(),
  now = new Date(),
) {
  billingLimitsSchema.parse(limits);
  if (authorizationId) z.uuid().parse(authorizationId);
  const [mapping] = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.clientId, clientId));
  if (!mapping) throw new ApiError(404, "Billing account not found");
  await db.transaction(async (tx) => {
    const account = await lockBillingAccount(tx, mapping.id, clientId);
    if (account.consentedBy !== userId)
      throw new ApiError(403, "Billing owner mismatch");
    const periods = await tx
      .select()
      .from(billingPeriods)
      .where(
        and(
          eq(billingPeriods.billingAccountId, account.id),
          eq(billingPeriods.status, "open"),
        ),
      )
      .orderBy(billingPeriods.startsAt)
      .for("update");
    const held = await tx
      .select()
      .from(billingCallUsage)
      .where(
        and(
          eq(billingCallUsage.billingAccountId, account.id),
          inArray(billingCallUsage.state, ["reserved", "metering_pending"]),
        ),
      );
    if (
      held.some(
        (usage) =>
          (!authorizationId || usage.authorizationId === authorizationId) &&
          usage.reservedCents > limits.perCallLimitCents,
      )
    )
      throw new ApiError(
        409,
        "Per-call limit is below an existing reservation",
      );
    if (authorizationId) {
      const [grant] = await tx
        .select()
        .from(billingAuthorizations)
        .where(
          and(
            eq(billingAuthorizations.id, authorizationId),
            eq(billingAuthorizations.billingAccountId, account.id),
          ),
        )
        .for("update");
      if (!grant || grant.status !== "active")
        throw new ApiError(404, "Active spending grant not found");
      if (
        limits.monthlyLimitCents > account.monthlyLimitCents ||
        limits.perCallLimitCents > account.perCallLimitCents
      )
        throw new ApiError(409, "Integration limits exceed the account limits");
      const usage = await tx
        .select()
        .from(billingCallUsage)
        .where(eq(billingCallUsage.authorizationId, grant.id));
      if (
        periods.some(
          (period) =>
            usage
              .filter((row) => row.periodId === period.id)
              .reduce(
                (sum, row) => sum + (row.finalCents ?? row.reservedCents),
                0,
              ) > limits.monthlyLimitCents,
        )
      )
        throw new ApiError(
          409,
          "Monthly limit is below committed usage and reservations",
        );
      await tx
        .update(billingAuthorizations)
        .set({ ...limits, updatedAt: now })
        .where(eq(billingAuthorizations.id, grant.id));
    } else {
      if (
        periods.some(
          (period) =>
            period.spentCents + period.reservedCents > limits.monthlyLimitCents,
        )
      )
        throw new ApiError(
          409,
          "Monthly limit is below committed usage and reservations",
        );
      await tx
        .update(billingAccounts)
        .set({ ...limits, updatedAt: now })
        .where(eq(billingAccounts.id, account.id));
      for (const period of periods)
        await tx
          .update(billingPeriods)
          .set({ limitCents: limits.monthlyLimitCents, updatedAt: now })
          .where(eq(billingPeriods.id, period.id));
    }
    await billingAudit(
      tx,
      account,
      `limits:${randomUUID()}`,
      "limits_changed",
      "human",
      userId,
      { authorizationId: authorizationId ?? null, ...limits },
    );
  });
}

export async function withdrawCollectionConsent(
  clientId: string,
  userId: string,
  db = database(),
  now = new Date(),
) {
  const [mapping] = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.clientId, clientId));
  if (!mapping) throw new ApiError(404, "Billing account not found");
  await db.transaction(async (tx) => {
    const account = await lockBillingAccount(tx, mapping.id, clientId);
    if (account.consentedBy !== userId)
      throw new ApiError(403, "Billing owner mismatch");
    await tx
      .update(billingAccounts)
      .set({
        collectionConsent: false,
        status:
          account.status === "suspended" || account.status === "revoked"
            ? account.status
            : "past_due",
        blockReason:
          account.status === "suspended" || account.status === "revoked"
            ? account.blockReason
            : "collection_withdrawn",
        updatedAt: now,
      })
      .where(eq(billingAccounts.id, account.id));
    await billingAudit(
      tx,
      account,
      `collection-withdrawn:${randomUUID()}`,
      "collection_consent_withdrawn",
      "human",
      userId,
    );
  });
}

export async function linkBillingApiKey(
  clientId: string,
  keyId: string,
  connectionId: string,
  db = database(),
) {
  z.uuid().parse(keyId);
  z.uuid().parse(connectionId);
  await db.transaction(async (tx) => {
    const [mapping] = await tx
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.clientId, clientId));
    if (mapping) await lockBillingAccount(tx, mapping.id, clientId);
    const [connection] = await tx
      .select()
      .from(agentConnections)
      .where(
        and(
          eq(agentConnections.id, connectionId),
          eq(agentConnections.clientId, clientId),
          eq(agentConnections.status, "active"),
        ),
      )
      .for("update");
    if (!connection)
      throw new ApiError(
        403,
        "Choose an active integration owned by this account",
      );
    const [key] = await tx
      .update(apiKeys)
      .set({ connectionId })
      .where(
        and(
          eq(apiKeys.id, keyId),
          eq(apiKeys.clientId, clientId),
          isNull(apiKeys.revokedAt),
          isNull(apiKeys.connectionId),
        ),
      )
      .returning({ id: apiKeys.id });
    if (!key) throw new ApiError(409, "Choose an unlinked active API key");
  });
}
