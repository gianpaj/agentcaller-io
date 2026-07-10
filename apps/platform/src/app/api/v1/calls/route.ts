import { createCallSchema } from "@agentcaller/contracts";
import { calls, callEvents, paymentSettlements, rateCards, webhookDeliveries } from "@agentcaller/database";
import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { authenticateApiRequest, ApiError } from "@/lib/auth";
import { database } from "@/lib/database";
import { dispatchCall } from "@/lib/livekit";
import { errorResponse } from "@/lib/http";
import { paymentRequiredResponse, paymentRequirements, readPaymentPayload, verifyPayment } from "@/lib/payment";
import { queueWebhook } from "@/lib/webhooks";

const PAGE_SIZE = 50;
const UNIQUE_VIOLATION = "23505";

/** Summary columns only: transcripts are large and are served by the dedicated transcript route. */
const callSummary = {
  id: calls.id,
  destination: calls.destination,
  destinationCountry: calls.destinationCountry,
  language: calls.language,
  clientReference: calls.clientReference,
  state: calls.state,
  paymentState: calls.paymentState,
  maxAmountMicros: calls.maxAmountMicros,
  createdAt: calls.createdAt,
  endedAt: calls.endedAt,
};

function matchesDestinationCountry(destination: string, country: string) {
  return (country === "ES" && destination.startsWith("+34")) || (country === "US" && destination.startsWith("+1"));
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === UNIQUE_VIOLATION;
}

export async function GET(request: Request) {
  try {
    const client = await authenticateApiRequest(request);
    const cursor = new URL(request.url).searchParams.get("before");
    const createdBefore = cursor ? new Date(cursor) : undefined;
    if (createdBefore && Number.isNaN(createdBefore.getTime())) throw new ApiError(400, "`before` must be an ISO-8601 timestamp");

    const rows = await database().select(callSummary).from(calls)
      .where(and(
        eq(calls.clientId, client.id),
        isNull(calls.deletedAt),
        ...(createdBefore ? [lt(calls.createdAt, createdBefore)] : []),
      ))
      .orderBy(desc(calls.createdAt))
      .limit(PAGE_SIZE);

    const nextCursor = rows.length === PAGE_SIZE ? rows[rows.length - 1]?.createdAt.toISOString() : null;
    return Response.json({ data: rows, nextCursor });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const client = await authenticateApiRequest(request);
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 128) throw new ApiError(400, "Idempotency-Key is required");
    const input = createCallSchema.parse(await request.json());
    if (!matchesDestinationCountry(input.destination, input.destinationCountry)) throw new ApiError(422, "Destination does not match the declared country");
    if (input.voiceId && !client.allowedVoiceIds.includes(input.voiceId)) throw new ApiError(422, "Voice is not enabled for this client");

    const minuteAgo = new Date(Date.now() - 60_000);
    const [[existing], recent, active, [rate]] = await Promise.all([
      database().select().from(calls).where(and(eq(calls.clientId, client.id), eq(calls.idempotencyKey, idempotencyKey))).limit(1),
      database().select({ id: calls.id }).from(calls).where(and(eq(calls.clientId, client.id), gte(calls.createdAt, minuteAgo))).limit(client.callsPerMinute + 1),
      database().select({ id: calls.id }).from(calls).where(and(eq(calls.clientId, client.id), isNull(calls.endedAt))).limit(client.maxConcurrentCalls + 1),
      database().select().from(rateCards).where(and(eq(rateCards.country, input.destinationCountry), eq(rateCards.active, true))).limit(1),
    ]);

    if (existing) return Response.json({ data: existing }, { status: 202 });
    if (recent.length >= client.callsPerMinute) throw new ApiError(429, "Calls-per-minute limit reached");
    if (active.length >= client.maxConcurrentCalls) throw new ApiError(429, "Active-call limit reached");
    if (!rate) throw new ApiError(503, "No active rate card is available for this destination");

    const maxAmountMicros = Math.round(input.maxAmountUsd * 1_000_000);
    if (maxAmountMicros < rate.connectionFeeMicros + rate.startedMinuteFeeMicros) throw new ApiError(422, "Amount ceiling must cover a connection and one started minute");

    if (!request.headers.get("payment-signature")) return paymentRequiredResponse(maxAmountMicros);
    const requirements = paymentRequirements(maxAmountMicros);
    const paymentPayload = readPaymentPayload(request);
    const verified = await verifyPayment(paymentPayload, requirements);

    // The call, its authorization receipt, and its first event have to land together. A call row
    // without a settlement row can be dialled but never charged.
    let call: typeof calls.$inferSelect;
    try {
      call = await database().transaction(async (tx) => {
        const [created] = await tx.insert(calls).values({
          clientId: client.id,
          idempotencyKey,
          destination: input.destination,
          destinationCountry: input.destinationCountry,
          language: input.language,
          voiceId: input.voiceId,
          clientReference: input.clientReference,
          task: input.task,
          maxDurationSeconds: input.maxDurationSeconds,
          maxAmountMicros,
          rateCardVersion: rate.version,
        }).returning();
        if (!created) throw new ApiError(500, "Call could not be created");
        await tx.insert(paymentSettlements).values({ clientId: client.id, callId: created.id, payer: verified.payer, paymentPayload, authorizedMicros: maxAmountMicros, status: "authorized" });
        await tx.insert(callEvents).values({ callId: created.id, type: "call.queued", payload: { state: "queued" } });
        await tx.insert(webhookDeliveries).values({ callId: created.id, eventType: "call.queued", payload: { callId: created.id, state: "queued" } });
        return created;
      });
    } catch (error) {
      // Lost the race against a concurrent request with the same key: return that request's call
      // rather than a 500, so the retry stays idempotent.
      if (isUniqueViolation(error)) {
        const [winner] = await database().select().from(calls).where(and(eq(calls.clientId, client.id), eq(calls.idempotencyKey, idempotencyKey))).limit(1);
        if (winner) return Response.json({ data: winner }, { status: 202 });
      }
      throw error;
    }

    try {
      const roomName = await dispatchCall(call.id, input);
      const [dispatched] = await database().update(calls).set({ livekitRoom: roomName, updatedAt: new Date() }).where(eq(calls.id, call.id)).returning();
      return Response.json({ data: dispatched }, { status: 202 });
    } catch (dispatchError) {
      console.error(dispatchError);
      const [failed] = await database().update(calls).set({ state: "failed", endedAt: new Date(), updatedAt: new Date(), outcome: { reason: "agent_dispatch_failed" } }).where(eq(calls.id, call.id)).returning();
      await database().insert(callEvents).values({ callId: call.id, type: "call.failed", payload: { reason: "agent_dispatch_failed" } });
      await queueWebhook(call.id, "call.failed", { callId: call.id, reason: "agent_dispatch_failed" });
      return Response.json({ data: failed }, { status: 202 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
