import { authorizeOperatorInput } from "@/lib/operator-funding";
import { createCallSchema } from "@agentcaller/contracts";
import {
  calls,
  callEvents,
  paymentSettlements,
  rateCards,
  webhookDeliveries,
  connectJobs,
  clientProfiles,
} from "@agentcaller/database";
import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { ApiError } from "@/lib/auth";
import { database } from "@/lib/database";
import { dispatchCall } from "@/lib/livekit";
import { errorResponse } from "@/lib/http";
import {
  paymentRequiredResponse,
  paymentRequirements,
  readPaymentPayload,
  verifyPayment,
} from "@/lib/payment";
import { queueWebhook } from "@/lib/webhooks";

import { connectPaymentBlocker, attemptReserve } from "@/lib/connect-policy";
import { redialBlock, outcomeReason } from "@/lib/call-display";

const UNIQUE_VIOLATION = "23505";

function matchesDestinationCountry(destination: string, country: string) {
  return (
    (country === "ES" && destination.startsWith("+34")) ||
    (country === "US" && destination.startsWith("+1")) ||
    (country === "IT" && destination.startsWith("+39"))
  );
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}

export async function submitCall(
  request: Request,
  client: typeof clientProfiles.$inferSelect,
  portal?: { redialOf?: string },
) {
  try {
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 128)
      throw new ApiError(400, "Idempotency-Key is required");
    const input = createCallSchema.parse(await request.json());
    if (!matchesDestinationCountry(input.destination, input.destinationCountry))
      throw new ApiError(
        422,
        "Destination does not match the declared country",
      );
    if (input.voiceId && !client.allowedVoiceIds.includes(input.voiceId))
      throw new ApiError(422, "Voice is not enabled for this client");

    if (input.task.type === "connect_me") {
      if (
        Date.parse(input.task.expiresAt) <= Date.now() ||
        Date.parse(input.task.expiresAt) > Date.now() + 7 * 86400_000
      )
        throw new ApiError(422, "Expiry must be in the next seven days");
    }

    const fundingHeader = request.headers.get("x-agentcaller-funding");
    if (fundingHeader && fundingHeader !== "operator")
      throw new ApiError(422, "Unsupported funding mode");
    const operatorFunded = fundingHeader === "operator";
    if (operatorFunded) authorizeOperatorInput(client, input);
    const blocker = operatorFunded
      ? null
      : connectPaymentBlocker(input.task.type);
    if (blocker) throw new ApiError(503, blocker);

    const minuteAgo = new Date(Date.now() - 60_000);
    const [[existing], recent, active, [rate]] = await Promise.all([
      database()
        .select()
        .from(calls)
        .where(
          and(
            eq(calls.clientId, client.id),
            eq(calls.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1),
      database()
        .select({ id: calls.id })
        .from(calls)
        .where(
          and(eq(calls.clientId, client.id), gte(calls.createdAt, minuteAgo)),
        )
        .limit(client.callsPerMinute + 1),
      database()
        .select({ id: calls.id })
        .from(calls)
        .where(and(eq(calls.clientId, client.id), isNull(calls.endedAt)))
        .limit(client.maxConcurrentCalls + 1),
      database()
        .select()
        .from(rateCards)
        .where(
          and(
            eq(rateCards.country, input.destinationCountry),
            eq(rateCards.active, true),
          ),
        )
        .limit(1),
    ]);

    if (existing) return Response.json({ data: existing }, { status: 202 });
    if (recent.length >= client.callsPerMinute)
      throw new ApiError(429, "Calls-per-minute limit reached");
    if (active.length >= client.maxConcurrentCalls)
      throw new ApiError(429, "Active-call limit reached");
    if (!rate)
      throw new ApiError(
        503,
        "No active rate card is available for this destination",
      );

    const [callbackRate] =
      input.task.type === "connect_me"
        ? await database()
            .select()
            .from(rateCards)
            .where(and(eq(rateCards.country, "ES"), eq(rateCards.active, true)))
            .limit(1)
        : [];
    if (input.task.type === "connect_me" && !callbackRate)
      throw new ApiError(503, "No Spanish callback rate");
    const maxAmountMicros = Math.round(input.maxAmountUsd * 1_000_000);
    if (
      maxAmountMicros <
      rate.connectionFeeMicros + rate.startedMinuteFeeMicros
    )
      throw new ApiError(
        422,
        "Amount ceiling must cover a connection and one started minute",
      );

    if (
      input.task.type === "connect_me" &&
      callbackRate &&
      attemptReserve(input.task, rate, callbackRate) > maxAmountMicros
    )
      throw new ApiError(
        422,
        "Spend cap must cover both legs at their duration limits",
      );

    if (!operatorFunded && !request.headers.get("payment-signature"))
      return paymentRequiredResponse(maxAmountMicros);
    const paymentPayload = operatorFunded
      ? undefined
      : readPaymentPayload(request);
    const verified = operatorFunded
      ? undefined
      : await verifyPayment(
          paymentPayload,
          paymentRequirements(maxAmountMicros),
        );

    // Persist funding authorization with the job before any dispatch.
    let call: typeof calls.$inferSelect;
    try {
      call = await database().transaction(async (tx) => {
        if (input.task.type === "connect_me") {
          const [lockedClient] = await tx
            .select()
            .from(clientProfiles)
            .where(eq(clientProfiles.id, client.id))
            .for("update");
          if (operatorFunded) {
            if (!lockedClient)
              throw new ApiError(403, "Operator profile is unavailable");
            authorizeOperatorInput(lockedClient, input);
          }
          const [duplicate] = await tx
            .select()
            .from(calls)
            .where(
              and(
                eq(calls.clientId, client.id),
                eq(calls.idempotencyKey, idempotencyKey),
              ),
            )
            .limit(1);
          if (duplicate) return duplicate;
          if (portal) {
            if (portal.redialOf) {
              const [source] = await tx
                .select()
                .from(calls)
                .where(
                  and(
                    eq(calls.id, portal.redialOf),
                    eq(calls.clientId, client.id),
                    isNull(calls.deletedAt),
                  ),
                )
                .limit(1);
              if (!source) throw new ApiError(404, "Original call not found");
              const blocked = redialBlock(source);
              if (blocked) throw new ApiError(409, blocked);
            }
            // An unknown provider result is not evidence that the previous call ended.
            const previous = await tx
              .select({ outcome: calls.outcome })
              .from(calls)
              .where(
                and(
                  eq(calls.clientId, client.id),
                  eq(calls.destination, input.destination),
                ),
              );
            if (
              previous.some((c) =>
                [
                  "dial_unknown",
                  "worker_lost",
                  "cancelled",
                  "configuration_error",
                ].includes(outcomeReason(c.outcome) ?? ""),
              )
            )
              throw new ApiError(
                409,
                "A previous call to this number needs provider cleanup reconciliation before another website call is allowed.",
              );
          }
          const recentJobs = await tx
            .select({ id: calls.id })
            .from(calls)
            .where(
              and(
                eq(calls.clientId, client.id),
                gte(calls.createdAt, minuteAgo),
              ),
            )
            .limit(client.callsPerMinute);
          if (recentJobs.length >= client.callsPerMinute)
            throw new ApiError(429, "Calls-per-minute limit reached");
          const activeJobs = await tx
            .select({ id: calls.id })
            .from(calls)
            .where(and(eq(calls.clientId, client.id), isNull(calls.endedAt)))
            .limit(client.maxConcurrentCalls);
          if (activeJobs.length >= (portal ? 1 : client.maxConcurrentCalls))
            throw new ApiError(429, "Active-call limit reached");
        }
        const [created] = await tx
          .insert(calls)
          .values({
            clientId: client.id,
            idempotencyKey,
            fundingSource: operatorFunded ? "operator" : "x402",
            operatorAuthorizedBy: operatorFunded ? client.id : null,
            paymentState: operatorFunded ? "not_required" : "authorized",
            destination: input.destination,
            destinationCountry: input.destinationCountry,
            language: input.language,
            voiceId: input.voiceId,
            clientReference: input.clientReference,
            task: input.task,
            maxDurationSeconds: input.maxDurationSeconds,
            maxAmountMicros,
            rateCardVersion: rate.version,
          })
          .returning();
        if (!created) throw new ApiError(500, "Call could not be created");
        if (input.task.type === "connect_me" && callbackRate) {
          const snapshot = (r: typeof rate) => ({
            connectionFeeMicros: r.connectionFeeMicros,
            startedMinuteFeeMicros: r.startedMinuteFeeMicros,
          });
          await tx.insert(connectJobs).values({
            callId: created.id,
            businessRate: snapshot(rate),
            callbackRate: snapshot(callbackRate),
          });
        }
        if (!operatorFunded)
          await tx.insert(paymentSettlements).values({
            clientId: client.id,
            callId: created.id,
            payer: verified?.payer,
            paymentPayload,
            authorizedMicros: maxAmountMicros,
            status: "authorized",
          });
        await tx.insert(callEvents).values({
          callId: created.id,
          type: "call.queued",
          payload: {
            state: "queued",
            fundingSource: created.fundingSource,
            operatorAuthorizedBy: created.operatorAuthorizedBy,
          },
        });
        await tx.insert(webhookDeliveries).values({
          callId: created.id,
          eventType: "call.queued",
          payload: { callId: created.id, state: "queued" },
        });
        return created;
      });
    } catch (error) {
      // Lost the race against a concurrent request with the same key: return that request's call
      // rather than a 500, so the retry stays idempotent.
      if (isUniqueViolation(error)) {
        const [winner] = await database()
          .select()
          .from(calls)
          .where(
            and(
              eq(calls.clientId, client.id),
              eq(calls.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (winner) return Response.json({ data: winner }, { status: 202 });
      }
      throw error;
    }

    if (input.task.type === "connect_me")
      return Response.json({ data: call }, { status: 202 });

    try {
      const roomName = await dispatchCall(call.id, input);
      const [dispatched] = await database()
        .update(calls)
        .set({ livekitRoom: roomName, updatedAt: new Date() })
        .where(eq(calls.id, call.id))
        .returning();
      return Response.json({ data: dispatched }, { status: 202 });
    } catch (dispatchError) {
      console.error(dispatchError);
      const [failed] = await database()
        .update(calls)
        .set({
          state: "failed",
          endedAt: new Date(),
          updatedAt: new Date(),
          outcome: { reason: "agent_dispatch_failed" },
        })
        .where(eq(calls.id, call.id))
        .returning();
      await database()
        .insert(callEvents)
        .values({
          callId: call.id,
          type: "call.failed",
          payload: { reason: "agent_dispatch_failed" },
        });
      await queueWebhook(call.id, "call.failed", {
        callId: call.id,
        reason: "agent_dispatch_failed",
      });
      return Response.json({ data: failed }, { status: 202 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
