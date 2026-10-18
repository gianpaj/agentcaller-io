import { createHash, randomUUID } from "node:crypto";
import {
  billingAccounts,
  billingAuthorizations,
  billingCallUsage,
  billingPeriods,
  calls,
  callAttempts,
  callLegs,
  clientProfiles,
  connectJobs,
  callEvents,
  webhookDeliveries,
  rateCards,
} from "@agentcaller/database";
import {
  createStripeCallSchema,
  quoteStripeCallSchema,
  type AgentPrincipal,
  type CreateStripeCallInput,
  type UsdRate,
} from "@agentcaller/contracts";
import { and, eq, inArray, isNull, gte, sql, lt } from "drizzle-orm";
import { ApiError } from "./auth";
import { database } from "./database";
import { isStripeBillingEnabled } from "./env";
import { billingPolicy } from "./billing-policy";
import {
  assessCallUsage,
  billingHeadroom,
  quoteConnectCents,
  type LegUsageEvidence,
} from "./billing-money";
import {
  stripeCallSchedule,
  stripeRequestFingerprint,
  utcBillingPeriod,
} from "./billing-period";
import { createBillingSetup } from "./billing-setup";
import {
  billingAudit,
  lockAgentConnection,
  lockBillingAccount,
  type BillingDB,
  type BillingTX,
} from "./billing-store";

type Reader = BillingDB | BillingTX;
const heldStates = ["reserved", "metering_pending"];
const zeroId = "00000000-0000-0000-0000-000000000000";

export class BillingSetupRequired extends ApiError {
  constructor(readonly setup: Awaited<ReturnType<typeof createBillingSetup>>) {
    super(409, "billing_setup_required");
  }
}

async function prices(db: Reader, input: CreateStripeCallInput, now: Date) {
  const policy = billingPolicy();
  const rows = await db
    .select()
    .from(rateCards)
    .where(
      and(
        eq(rateCards.active, true),
        eq(rateCards.currency, "USD"),
        eq(rateCards.stripePricingVersion, policy.pricingVersion),
      ),
    );
  const business = rows.find((row) => row.country === input.destinationCountry),
    callback = rows.find((row) => row.country === "ES");
  if (!business || !callback)
    throw new ApiError(
      503,
      "Approved USD tariffs are unavailable for these legs",
    );
  const snapshot = (row: typeof business): UsdRate => ({
    currency: "USD",
    pricingVersion: policy.pricingVersion,
    connectionFeeMicros: row.connectionFeeMicros,
    startedMinuteFeeMicros: row.startedMinuteFeeMicros,
  });
  const quoteVersion = createHash("sha256")
    .update(
      JSON.stringify([
        Math.floor(now.getTime() / 300_000),
        policy.pricingVersion,
        business.version,
        business.connectionFeeMicros,
        business.startedMinuteFeeMicros,
        callback.version,
        callback.connectionFeeMicros,
        callback.startedMinuteFeeMicros,
      ]),
    )
    .digest("hex");
  let schedule;
  try {
    schedule = stripeCallSchedule(input, now);
  } catch {
    throw new ApiError(
      422,
      "No permissible schedule within the expiry and seven-day horizon",
    );
  }
  return {
    quoteVersion,
    pricingVersion: policy.pricingVersion,
    maximumCents: quoteConnectCents(
      input.task,
      snapshot(business),
      snapshot(callback),
    ),
    businessRate: snapshot(business),
    callbackRate: snapshot(callback),
    ...schedule,
  };
}

export async function quoteStripeCall(
  principal: AgentPrincipal,
  value: unknown,
  db = database(),
  now = new Date(),
) {
  const input = {
    ...quoteStripeCallSchema.parse(value),
    quoteVersion: "estimate",
  };
  await db.transaction((tx) =>
    lockAgentConnection(tx, principal, "calls:create"),
  );
  const quote = await prices(db, input, now);
  return {
    currency: "USD",
    maximumCents: quote.maximumCents,
    quoteVersion: quote.quoteVersion,
    pricingVersion: quote.pricingVersion,
    scheduledFor: quote.scheduledFor.toISOString(),
    periodStartsAt: quote.startsAt.toISOString(),
    periodEndsAt: quote.endsAt.toISOString(),
    expiresAt: new Date(
      (Math.floor(now.getTime() / 300_000) + 1) * 300_000,
    ).toISOString(),
  };
}

async function currentTotals(
  tx: Reader,
  accountId: string,
  periodId: string,
  grantId: string,
) {
  const periods = await tx
    .select()
    .from(billingPeriods)
    .where(eq(billingPeriods.billingAccountId, accountId));
  const usage = await tx
    .select()
    .from(billingCallUsage)
    .where(
      and(
        eq(billingCallUsage.authorizationId, grantId),
        eq(billingCallUsage.periodId, periodId),
      ),
    );
  return {
    unpaidCents: periods.reduce(
      (sum, period) =>
        sum + period.spentCents - period.collectedCents - period.waivedCents,
      0,
    ),
    allReservedCents: periods.reduce(
      (sum, period) => sum + period.reservedCents,
      0,
    ),
    grantSpentCents: usage.reduce((sum, row) => sum + (row.finalCents ?? 0), 0),
    grantReservedCents: usage
      .filter((row) => heldStates.includes(row.state))
      .reduce((sum, row) => sum + row.reservedCents, 0),
  };
}

function accepted(
  call: typeof calls.$inferSelect,
  usage: typeof billingCallUsage.$inferSelect,
) {
  return {
    id: call.id,
    state: call.state,
    paymentState: call.paymentState,
    fundingSource: call.fundingSource,
    usageState: usage.state,
    reservedCents: heldStates.includes(usage.state) ? usage.reservedCents : 0,
    finalCents: usage.finalCents,
    scheduledFor: call.scheduledFor?.toISOString(),
  };
}

async function replay(
  principal: AgentPrincipal,
  key: string,
  fingerprint: string,
  db: Reader,
) {
  const [call] = await db
    .select()
    .from(calls)
    .where(
      and(
        eq(calls.clientId, principal.clientId),
        eq(calls.idempotencyKey, key),
      ),
    );
  if (!call) return null;
  const [usage] = await db
    .select()
    .from(billingCallUsage)
    .where(eq(billingCallUsage.callReference, call.id));
  if (
    call.fundingSource !== "stripe_postpaid" ||
    call.requestFingerprint !== fingerprint ||
    !usage ||
    usage.connectionId !== principal.connectionId
  )
    throw new ApiError(
      409,
      "Idempotency key belongs to a different call intent or integration",
    );
  return accepted(call, usage);
}

/** Commit the full job reservation with the call and connect job. No network or dispatch here. */
export async function reserveStripeCall(
  principal: AgentPrincipal,
  key: string,
  value: unknown,
  db = database(),
  now = new Date(),
) {
  if (!key.trim() || key.length > 128)
    throw new ApiError(400, "Idempotency-Key is required");
  const input = createStripeCallSchema.parse(value),
    fingerprint = stripeRequestFingerprint(input);
  const previous = await replay(principal, key, fingerprint, db);
  if (previous) return previous;
  const [mapping] = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.clientId, principal.clientId));
  const setupRequired = async () =>
    new BillingSetupRequired(
      await createBillingSetup(
        principal,
        `call:${key}`.slice(0, 128),
        "enroll",
        db,
        now,
      ),
    );
  if (!mapping) throw await setupRequired();
  const result = await db.transaction(async (tx) => {
    const account = await lockBillingAccount(
      tx,
      mapping.id,
      principal.clientId,
    );
    // Serialize existing per-client throttles with operator admission as well.
    const [client] = await tx
      .select()
      .from(clientProfiles)
      .where(eq(clientProfiles.id, principal.clientId))
      .for("update");
    const connection = await lockAgentConnection(tx, principal, "calls:create");
    const existing = await replay(principal, key, fingerprint, tx);
    if (existing) return existing;
    const [grant] = await tx
      .select()
      .from(billingAuthorizations)
      .where(
        and(
          eq(billingAuthorizations.billingAccountId, account.id),
          eq(billingAuthorizations.connectionId, connection.id),
        ),
      )
      .for("update");
    if (!grant || grant.status === "pending" || !account.paymentMethodId)
      return null;
    if (!isStripeBillingEnabled())
      throw new ApiError(503, "Paid calling is disabled");
    if (
      account.status !== "active" ||
      !account.collectionConsent ||
      grant.status !== "active" ||
      grant.revokedAt ||
      (grant.expiresAt && grant.expiresAt <= now) ||
      (grant.effectiveAt && grant.effectiveAt > now)
    )
      throw new ApiError(403, "No current spending authority");
    const quote = await prices(tx, input, now);
    if (
      quote.quoteVersion !== input.quoteVersion ||
      grant.pricingVersion !== quote.pricingVersion ||
      account.pricingVersion !== quote.pricingVersion
    )
      throw new ApiError(
        409,
        "Quote changed; accept a fresh quote before submitting",
      );
    if (
      quote.maximumCents > input.maxAmountCents ||
      quote.maximumCents > account.perCallLimitCents ||
      quote.maximumCents > grant.perCallLimitCents
    )
      throw new ApiError(
        409,
        "Worst-case job exceeds a per-call ceiling; reduce duration or attempts",
      );
    if (input.voiceId && !client?.allowedVoiceIds.includes(input.voiceId))
      throw new ApiError(422, "Voice is not enabled for this account");
    await tx
      .insert(billingPeriods)
      .values({
        billingAccountId: account.id,
        clientId: account.clientId,
        startsAt: quote.startsAt,
        endsAt: quote.endsAt,
        limitCents: account.monthlyLimitCents,
      })
      .onConflictDoNothing();
    const [period] = await tx
      .select()
      .from(billingPeriods)
      .where(
        and(
          eq(billingPeriods.billingAccountId, account.id),
          eq(billingPeriods.startsAt, quote.startsAt),
        ),
      )
      .for("update");
    if (!period || period.status !== "open")
      throw new ApiError(409, "Billing period is closing");
    const totals = await currentTotals(tx, account.id, period.id, grant.id);
    const headroom = billingHeadroom({
      ...totals,
      accountLimitCents: period.limitCents,
      accountSpentCents: period.spentCents,
      accountReservedCents: period.reservedCents,
      grantLimitCents: grant.monthlyLimitCents,
    });
    if (
      quote.maximumCents > headroom.availableCents ||
      totals.unpaidCents + totals.allReservedCents + quote.maximumCents >
        account.creditLimitCents
    )
      throw new ApiError(
        409,
        "Monthly allowance or shared unpaid-exposure limit exceeded",
      );
    const recent = await tx
      .select({ id: calls.id, state: calls.state })
      .from(calls)
      .where(
        and(
          eq(calls.clientId, account.clientId),
          gte(calls.createdAt, new Date(now.getTime() - 60_000)),
        ),
      );
    const active = await tx
      .select({ id: calls.id })
      .from(calls)
      .where(
        and(
          eq(calls.clientId, account.clientId),
          inArray(calls.state, ["queued", "dialing", "in_progress"]),
          isNull(calls.endedAt),
        ),
      );
    if (
      recent.length >= (client?.callsPerMinute ?? 0) ||
      active.length >= (client?.maxConcurrentCalls ?? 0)
    )
      throw new ApiError(429, "Call rate or outstanding-call limit reached");
    const id = randomUUID();
    const [call] = await tx
      .insert(calls)
      .values({
        id,
        clientId: account.clientId,
        idempotencyKey: key,
        fundingSource: "stripe_postpaid",
        stripeBillingAccountId: account.id,
        billingAuthorizationId: grant.id,
        requestFingerprint: fingerprint,
        scheduledFor: quote.scheduledFor,
        destination: input.destination,
        destinationCountry: input.destinationCountry,
        language: input.language,
        voiceId: input.voiceId,
        clientReference: input.clientReference,
        task: input.task,
        maxDurationSeconds: input.maxDurationSeconds,
        maxAmountMicros: input.maxAmountCents * 10000,
        paymentState: "accruing",
        rateCardVersion: quote.quoteVersion,
      })
      .returning();
    const [usage] = await tx
      .insert(billingCallUsage)
      .values({
        billingAccountId: account.id,
        clientId: account.clientId,
        connectionId: connection.id,
        authorizationId: grant.id,
        periodId: period.id,
        callId: id,
        callReference: id,
        credentialId: principal.credentialId,
        authorizationVersion: grant.version,
        connectionVersion: connection.version,
        requestFingerprint: fingerprint,
        pricingVersion: quote.pricingVersion,
        businessRate: quote.businessRate,
        callbackRate: quote.callbackRate,
        reservedCents: quote.maximumCents,
      })
      .returning();
    await tx.insert(connectJobs).values({
      callId: id,
      nextAttemptAt: quote.scheduledFor,
      businessRate: quote.businessRate,
      callbackRate: quote.callbackRate,
    });
    await tx.insert(callEvents).values({
      callId: id,
      type: "call.queued",
      payload: { fundingSource: "stripe_postpaid" },
    });
    await tx.insert(webhookDeliveries).values({
      callId: id,
      eventType: "call.queued",
      payload: { callId: id, state: "queued" },
    });
    await tx
      .update(billingPeriods)
      .set({
        reservedCents: period.reservedCents + quote.maximumCents,
        updatedAt: now,
      })
      .where(eq(billingPeriods.id, period.id));
    await billingAudit(
      tx,
      account,
      `usage:${id}:reserved`,
      "call_reserved",
      "agent",
      principal.credentialId,
      {
        callReference: id,
        reservedCents: quote.maximumCents,
        periodId: period.id,
        authorizationId: grant.id,
      },
    );
    return accepted(call!, usage!);
  });
  if (!result) throw await setupRequired();
  return result;
}

export async function getBillingStatus(
  principal: AgentPrincipal,
  db = database(),
  now = new Date(),
) {
  if (!principal.operations.includes("billing:read"))
    throw new ApiError(403, "Billing read permission is required");
  const [account] = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.clientId, principal.clientId));
  if (!account) {
    await db.transaction((tx) =>
      lockAgentConnection(tx, principal, "billing:read"),
    );
    return {
      status: "setup_required",
      currency: "USD",
      reason: "no_billing_account",
    };
  }
  return db.transaction(async (tx) => {
    const locked = await lockBillingAccount(tx, account.id, principal.clientId);
    await lockAgentConnection(tx, principal, "billing:read");
    const [grant] = await tx
      .select()
      .from(billingAuthorizations)
      .where(
        and(
          eq(billingAuthorizations.billingAccountId, account.id),
          eq(
            billingAuthorizations.connectionId,
            principal.connectionId ?? zeroId,
          ),
        ),
      );
    const periodBounds = utcBillingPeriod(now);
    const [period] = await tx
      .select()
      .from(billingPeriods)
      .where(
        and(
          eq(billingPeriods.billingAccountId, account.id),
          eq(billingPeriods.startsAt, periodBounds.startsAt),
        ),
      );
    const totals = await currentTotals(
      tx,
      account.id,
      period?.id ?? zeroId,
      grant?.id ?? zeroId,
    );
    const headroom = billingHeadroom({
      ...totals,
      accountLimitCents: period?.limitCents ?? locked.monthlyLimitCents,
      accountSpentCents: period?.spentCents ?? 0,
      accountReservedCents: period?.reservedCents ?? 0,
      grantLimitCents: grant?.monthlyLimitCents ?? 0,
    });
    const authorized =
      locked.status === "active" &&
      locked.collectionConsent &&
      grant?.status === "active" &&
      !grant.revokedAt &&
      (!grant.expiresAt || grant.expiresAt > now) &&
      !!grant.effectiveAt &&
      grant.effectiveAt <= now &&
      !!locked.paymentMethodId;
    return {
      status:
        !grant || grant.status === "pending"
          ? "setup_required"
          : !authorized
            ? "blocked"
            : !isStripeBillingEnabled()
              ? "disabled"
              : "ready",
      reason: !isStripeBillingEnabled()
        ? "paid_calling_disabled"
        : locked.blockReason,
      currency: "USD",
      periodStartsAt: periodBounds.startsAt.toISOString(),
      periodEndsAt: periodBounds.endsAt.toISOString(),
      monthlyLimitCents: locked.monthlyLimitCents,
      perCallLimitCents: Math.min(
        locked.perCallLimitCents,
        grant?.perCallLimitCents ?? 0,
      ),
      spentCents: period?.spentCents ?? 0,
      reservedCents: period?.reservedCents ?? 0,
      ...totals,
      availableCents: headroom.availableCents,
      collectedCents: period?.collectedCents ?? 0,
    };
  });
}

export async function getBillingUsage(
  principal: AgentPrincipal,
  before?: string,
  db = database(),
) {
  await db.transaction((tx) =>
    lockAgentConnection(tx, principal, "billing:read"),
  );
  if (!principal.connectionId || !principal.operations.includes("billing:read"))
    throw new ApiError(403, "Integration billing access is required");
  const cursor = before ? new Date(before) : null;
  if (cursor && !Number.isFinite(cursor.getTime()))
    throw new ApiError(422, "Invalid usage cursor");
  const rows = await db
    .select({
      callId: billingCallUsage.callReference,
      createdAt: billingCallUsage.createdAt,
      state: billingCallUsage.state,
      reservedCents: billingCallUsage.reservedCents,
      finalCents: billingCallUsage.finalCents,
      periodId: billingCallUsage.periodId,
    })
    .from(billingCallUsage)
    .where(
      and(
        eq(billingCallUsage.clientId, principal.clientId),
        eq(billingCallUsage.connectionId, principal.connectionId),
        cursor ? lt(billingCallUsage.createdAt, cursor) : undefined,
      ),
    )
    .orderBy(sql`${billingCallUsage.createdAt} desc`)
    .limit(50);
  return {
    data: rows,
    nextCursor:
      rows.length === 50 ? rows.at(-1)!.createdAt.toISOString() : null,
  };
}

/** Called only after terminal state and confirmed cleanup. Unknown leg evidence retains the hold. */
export async function finalizeStripeUsage(
  callId: string,
  db = database(),
  now = new Date(),
) {
  const [locator] = await db
    .select()
    .from(billingCallUsage)
    .where(eq(billingCallUsage.callReference, callId));
  if (!locator) return;
  return db.transaction(async (tx) => {
    const account = await lockBillingAccount(
      tx,
      locator.billingAccountId,
      locator.clientId,
      false,
    );
    const [period] = await tx
      .select()
      .from(billingPeriods)
      .where(eq(billingPeriods.id, locator.periodId))
      .for("update");
    const [usage] = await tx
      .select()
      .from(billingCallUsage)
      .where(eq(billingCallUsage.id, locator.id))
      .for("update");
    const [call] = await tx
      .select()
      .from(calls)
      .where(eq(calls.id, callId))
      .for("update");
    if (
      !period ||
      !usage ||
      !heldStates.includes(usage.state) ||
      !call?.endedAt ||
      period.status === "closed"
    )
      return;
    const attempts = await tx
      .select()
      .from(callAttempts)
      .where(eq(callAttempts.callId, callId));
    const legs = attempts.length
      ? await tx
          .select()
          .from(callLegs)
          .where(
            inArray(
              callLegs.attemptId,
              attempts.map((attempt) => attempt.id),
            ),
          )
      : [];
    const cleaned = attempts.every(
      (attempt) => !!attempt.endedAt && !!attempt.roomsCleanedAt,
    );
    const evidence: LegUsageEvidence[] = legs.map((leg) => {
      if (leg.connectedAt && leg.endedAt && leg.endedAt >= leg.connectedAt)
        return {
          state: "connected",
          connectedAt: leg.connectedAt,
          endedAt: leg.endedAt,
          rate:
            leg.kind === "business" ? usage.businessRate : usage.callbackRate,
        };
      const attempt = attempts.find((attempt) => attempt.id === leg.attemptId)!;
      if (
        !leg.connectedAt &&
        leg.kind === "business" &&
        ["busy", "no_answer"].includes(attempt.reason ?? "") &&
        attempt.endedAt
      )
        return { state: "unanswered" };
      return { state: "unknown" };
    });
    const noDialIntent = legs.length === 0 && cleaned;
    const assessed = noDialIntent
      ? {
          state: "finalized" as const,
          finalCents: 0,
          measuredMicros: "0",
          overrunCents: 0,
        }
      : assessCallUsage(evidence, usage.reservedCents, cleaned);
    if (assessed.state === "metering_pending") {
      await tx
        .update(billingCallUsage)
        .set({ state: "metering_pending", updatedAt: now })
        .where(eq(billingCallUsage.id, usage.id));
      return { state: "metering_pending" };
    }
    await tx
      .update(billingCallUsage)
      .set({
        state: noDialIntent ? "released" : "finalized",
        finalCents: assessed.finalCents,
        finalizedAt: now,
        evidence: {
          measuredMicros: assessed.measuredMicros,
          connectedLegs: legs.filter((leg) => leg.connectedAt).length,
          overrunCents: assessed.overrunCents,
          noDialIntent,
        },
        updatedAt: now,
      })
      .where(eq(billingCallUsage.id, usage.id));
    await tx
      .update(billingPeriods)
      .set({
        reservedCents: period.reservedCents - usage.reservedCents,
        spentCents: period.spentCents + assessed.finalCents,
        updatedAt: now,
      })
      .where(eq(billingPeriods.id, period.id));
    await tx
      .update(calls)
      .set({ paymentState: "accrued", updatedAt: now })
      .where(eq(calls.id, callId));
    if (assessed.overrunCents > 0)
      await tx
        .update(billingAccounts)
        .set({
          status: "suspended",
          blockReason: "provider_overrun",
          updatedAt: now,
        })
        .where(eq(billingAccounts.id, account.id));
    await billingAudit(
      tx,
      account,
      `usage:${usage.id}:finalized`,
      "usage_finalized",
      "system",
      "billing-drain",
      {
        callReference: callId,
        finalCents: assessed.finalCents,
        overrunCents: assessed.overrunCents,
      },
    );
    return assessed;
  });
}
