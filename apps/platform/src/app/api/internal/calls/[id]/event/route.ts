import { callEvents, calls, paymentSettlements, rateCards } from "@agentcaller/database";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/auth";
import { database } from "@/lib/database";
import { getServerEnv } from "@/lib/env";
import { errorResponse } from "@/lib/http";
import { paymentRequirements, settlePayment } from "@/lib/payment";
import { queueWebhook } from "@/lib/webhooks";

const eventSchema = z.object({
  type: z.enum(["call.dialing", "call.in_progress", "call.completed", "call.failed", "call.cancelled"]),
  durationSeconds: z.number().int().min(0).max(1800).optional(),
  outcome: z.record(z.string(), z.unknown()).optional(),
  transcript: z.array(z.object({ speaker: z.string(), text: z.string(), at: z.string() })).optional(),
  recordingKey: z.string().min(1).optional(),
  recordingConsent: z.boolean().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.get("x-agentcaller-agent-secret") !== getServerEnv().AGENT_CALLBACK_SECRET) throw new ApiError(401, "Unauthorized agent event");
    const { id } = await context.params;
    const event = eventSchema.parse(await request.json());
    const [call] = await database().select().from(calls).where(eq(calls.id, id)).limit(1);
    if (!call) throw new ApiError(404, "Call not found");
    const state = event.type.replace("call.", "") as "dialing" | "in_progress" | "completed" | "failed" | "cancelled";
    const terminal = ["completed", "failed", "cancelled"].includes(state);
    const [updated] = await database().update(calls).set({ state, outcome: event.outcome, transcript: event.transcript, recordingKey: event.recordingKey, recordingConsent: event.recordingConsent, endedAt: terminal ? new Date() : null, updatedAt: new Date() }).where(eq(calls.id, id)).returning();
    await database().insert(callEvents).values({ callId: id, type: event.type, payload: event });
    await queueWebhook(id, event.type, { callId: id, state, outcome: event.outcome });
    if (!terminal) return Response.json({ data: updated });

    const [settlement] = await database().select().from(paymentSettlements).where(eq(paymentSettlements.callId, id)).limit(1);
    const [rate] = await database().select().from(rateCards).where(eq(rateCards.version, call.rateCardVersion)).limit(1);
    if (!settlement || !rate || !settlement.paymentPayload) throw new ApiError(500, "Call settlement cannot be resolved");
    const startedMinutes = Math.max(1, Math.ceil((event.durationSeconds ?? 0) / 60));
    const actualMicros = Math.min(call.maxAmountMicros, rate.connectionFeeMicros + startedMinutes * rate.startedMinuteFeeMicros);
    await database().update(calls).set({ paymentState: "settling", updatedAt: new Date() }).where(eq(calls.id, id));
    try {
      const settled = await settlePayment(settlement.paymentPayload, paymentRequirements(settlement.authorizedMicros), actualMicros);
      if (!settled.success) throw new Error(settled.errorReason ?? "Settlement was rejected");
      await database().update(paymentSettlements).set({ settledMicros: actualMicros, transactionHash: settled.transaction, payer: settled.payer ?? settlement.payer, status: "settled", updatedAt: new Date() }).where(eq(paymentSettlements.id, settlement.id));
      await database().update(calls).set({ paymentState: "settled", updatedAt: new Date() }).where(eq(calls.id, id));
      await queueWebhook(id, "payment.settled", { callId: id, amountMicros: actualMicros, transaction: settled.transaction });
    } catch (error) {
      await database().update(paymentSettlements).set({ status: "failed", updatedAt: new Date() }).where(eq(paymentSettlements.id, settlement.id));
      await database().update(calls).set({ paymentState: "failed", updatedAt: new Date() }).where(eq(calls.id, id));
      await queueWebhook(id, "payment.failed", { callId: id, error: error instanceof Error ? error.message : "Settlement failed" });
    }
    return Response.json({ data: updated });
  } catch (error) { return errorResponse(error); }
}
