import { createCallSchema } from "@agentcaller/contracts";
import { apiKeys, calls, callEvents, paymentSettlements, rateCards } from "@agentcaller/database";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { authenticateApiRequest, ApiError } from "@/lib/auth";
import { database } from "@/lib/database";
import { dispatchCall } from "@/lib/livekit";
import { errorResponse } from "@/lib/http";
import { paymentRequiredResponse, paymentRequirements, readPaymentPayload, verifyPayment } from "@/lib/payment";
import { queueWebhook } from "@/lib/webhooks";

function matchesDestinationCountry(destination: string, country: string) {
  return (country === "ES" && destination.startsWith("+34")) || (country === "US" && destination.startsWith("+1"));
}

export async function GET(request: Request) {
  try {
    const client = await authenticateApiRequest(request);
    const rows = await database().select().from(calls).where(and(eq(calls.clientId, client.id), isNull(calls.deletedAt))).orderBy(desc(calls.createdAt)).limit(100);
    return Response.json({ data: rows });
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

    const [existing] = await database().select().from(calls).where(and(eq(calls.clientId, client.id), eq(calls.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) return Response.json({ data: existing }, { status: 202 });

    const minuteAgo = new Date(Date.now() - 60_000);
    const recent = await database().select({ id: calls.id }).from(calls).where(and(eq(calls.clientId, client.id), gte(calls.createdAt, minuteAgo))).limit(client.callsPerMinute + 1);
    if (recent.length >= client.callsPerMinute) throw new ApiError(429, "Calls-per-minute limit reached");
    const active = await database().select({ id: calls.id }).from(calls).where(and(eq(calls.clientId, client.id), isNull(calls.endedAt))).limit(client.maxConcurrentCalls + 1);
    if (active.length >= client.maxConcurrentCalls) throw new ApiError(429, "Active-call limit reached");

    const [rate] = await database().select().from(rateCards).where(and(eq(rateCards.country, input.destinationCountry), eq(rateCards.active, true))).limit(1);
    if (!rate) throw new ApiError(503, "No active rate card is available for this destination");
    const maxAmountMicros = Math.round(input.maxAmountUsd * 1_000_000);
    if (maxAmountMicros < rate.connectionFeeMicros + rate.startedMinuteFeeMicros) throw new ApiError(422, "Amount ceiling must cover a connection and one started minute");

    if (!request.headers.get("payment-signature")) return paymentRequiredResponse(maxAmountMicros);
    const requirements = paymentRequirements(maxAmountMicros);
    const paymentPayload = readPaymentPayload(request);
    const verified = await verifyPayment(paymentPayload, requirements);

    const [call] = await database().insert(calls).values({
      clientId: client.id,
      idempotencyKey,
      destination: input.destination,
      destinationCountry: input.destinationCountry,
      language: input.language,
      voiceId: input.voiceId,
      task: input.task,
      maxDurationSeconds: input.maxDurationSeconds,
      maxAmountMicros,
      rateCardVersion: rate.version,
    }).returning();
    if (!call) throw new ApiError(500, "Call could not be created");
    await database().insert(paymentSettlements).values({ clientId: client.id, callId: call.id, payer: verified.payer, paymentPayload, authorizedMicros: maxAmountMicros, status: "authorized" });
    await database().insert(callEvents).values({ callId: call.id, type: "call.queued", payload: { state: "queued" } });
    await queueWebhook(call.id, "call.queued", { callId: call.id, state: "queued" });

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
