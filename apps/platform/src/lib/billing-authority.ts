import {
  agentConnections,
  apiKeys,
  billingAuthorizations,
  billingCallUsage,
  billingPeriods,
  clientProfiles,
  calls,
  callAttempts,
} from "@agentcaller/database";
import { and, eq, isNull } from "drizzle-orm";
import { isStripeBillingEnabled } from "./env";
import { lockCallBillingAccount, type BillingTX } from "./billing-store";
import { database } from "./database";
import { ApiError } from "./auth";
import { authorizeOperatorCall } from "./operator-funding";

/** Caller holds the account lock before locking the call. Recheck before every permission. */
export async function stripeCallAuthority(
  tx: BillingTX,
  call: typeof calls.$inferSelect,
  now: Date,
  ongoing?: {
    createdAt: Date;
    cleanupUntil: Date;
    workerId: string | null;
    endedAt: Date | null;
  },
) {
  if (call.fundingSource !== "stripe_postpaid") return null;
  const account = await lockCallBillingAccount(tx, call.id);
  const [usage] = await tx
    .select()
    .from(billingCallUsage)
    .where(eq(billingCallUsage.callReference, call.id));
  if (!account || !usage) return { allowed: false, endsAt: now };
  const [grant] = await tx
    .select()
    .from(billingAuthorizations)
    .where(eq(billingAuthorizations.id, usage.authorizationId));
  const [connection] = await tx
    .select()
    .from(agentConnections)
    .where(eq(agentConnections.id, usage.connectionId));
  const [period] = await tx
    .select()
    .from(billingPeriods)
    .where(eq(billingPeriods.id, usage.periodId));
  const [owner] = await tx
    .select()
    .from(clientProfiles)
    .where(eq(clientProfiles.id, call.clientId));
  const [key] =
    connection && usage.credentialId !== connection.oauthClientId
      ? await tx
          .select()
          .from(apiKeys)
          .where(
            and(
              eq(apiKeys.id, usage.credentialId),
              eq(apiKeys.clientId, call.clientId),
              eq(apiKeys.connectionId, connection.id),
              isNull(apiKeys.revokedAt),
            ),
          )
      : [];
  return {
    endsAt: period?.endsAt ?? now,
    allowed:
      isStripeBillingEnabled() &&
      !!owner?.enabled &&
      account.status === "active" &&
      account.collectionConsent &&
      !!account.paymentMethodId &&
      call.paymentState === "accruing" &&
      usage.state === "reserved" &&
      !!grant &&
      grant.status === "active" &&
      !grant.revokedAt &&
      grant.version === usage.authorizationVersion &&
      !!grant.effectiveAt &&
      grant.effectiveAt <= now &&
      (!grant.expiresAt || grant.expiresAt > now) &&
      !!connection &&
      connection.status === "active" &&
      !connection.revokedAt &&
      connection.version === usage.connectionVersion &&
      connection.operations.includes("calls:create") &&
      (usage.credentialId === connection.oauthClientId || !!key) &&
      !!period &&
      now >= period.startsAt &&
      ((period.status === "open" && now < period.endsAt) ||
        (!!ongoing?.workerId &&
          !ongoing.endedAt &&
          ongoing.createdAt < period.endsAt &&
          now < ongoing.cleanupUntil &&
          ["open", "closing"].includes(period.status))) &&
      usage.reservedCents <=
        Math.min(grant.perCallLimitCents, account.perCallLimitCents),
  };
}

export async function authorizeConnectFunding(
  callId: string,
  db = database(),
  attemptId?: string,
) {
  const [call] = await db.select().from(calls).where(eq(calls.id, callId));
  if (call?.fundingSource === "operator") return authorizeOperatorCall(callId);
  if (call?.fundingSource !== "stripe_postpaid")
    throw new ApiError(403, "No supported connect authorization");
  await db.transaction(async (tx) => {
    await lockCallBillingAccount(tx, callId);
    const [current] = await tx
      .select()
      .from(calls)
      .where(eq(calls.id, callId))
      .for("update");
    const [ongoing] = attemptId
      ? await tx
          .select()
          .from(callAttempts)
          .where(
            and(
              eq(callAttempts.id, attemptId),
              eq(callAttempts.callId, callId),
            ),
          )
      : [];
    if (
      !current ||
      current.endedAt ||
      !(await stripeCallAuthority(tx, current, new Date(), ongoing))?.allowed
    )
      throw new ApiError(403, "Spending authority is unavailable");
  });
}
