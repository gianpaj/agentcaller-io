import { calls, paymentSettlements, rateCards } from "@agentcaller/database";
import { and, eq } from "drizzle-orm";
import { ApiError } from "./auth";
import { database } from "./database";
import { paymentRequirements, settlePayment } from "./payment";
import { queueWebhook } from "./webhooks";

type CallRow = typeof calls.$inferSelect;

/** Charges the connection fee plus every started minute, never more than the client's ceiling. */
export function chargeableMicros(call: Pick<CallRow, "maxAmountMicros">, rate: Pick<typeof rateCards.$inferSelect, "connectionFeeMicros" | "startedMinuteFeeMicros">, durationSeconds: number | undefined) {
  const startedMinutes = Math.max(1, Math.ceil((durationSeconds ?? 0) / 60));
  return Math.min(call.maxAmountMicros, rate.connectionFeeMicros + startedMinutes * rate.startedMinuteFeeMicros);
}

/**
 * Settles a call exactly once. The conditional update is the lock: whichever caller flips
 * payment_state away from 'authorized' owns settlement, so a replayed terminal event, a
 * concurrent cancel, and a retrying agent cannot double-charge the payer.
 *
 * Returns false when another caller already owns (or completed) settlement.
 */
export async function settleCallOnce(call: CallRow, durationSeconds: number | undefined) {
  const claimed = await database().update(calls)
    .set({ paymentState: "settling", updatedAt: new Date() })
    .where(and(eq(calls.id, call.id), eq(calls.paymentState, "authorized")))
    .returning({ id: calls.id });
  if (!claimed.length) return false;

  const [settlement] = await database().select().from(paymentSettlements).where(eq(paymentSettlements.callId, call.id)).limit(1);
  const [rate] = await database().select().from(rateCards).where(eq(rateCards.version, call.rateCardVersion)).limit(1);
  if (!settlement || !rate || !settlement.paymentPayload) throw new ApiError(500, "Call settlement cannot be resolved");

  const actualMicros = chargeableMicros(call, rate, durationSeconds);

  try {
    const settled = await settlePayment(settlement.paymentPayload, paymentRequirements(settlement.authorizedMicros), actualMicros);
    if (!settled.success) throw new Error(settled.errorReason ?? "Settlement was rejected");
    await database().update(paymentSettlements).set({ settledMicros: actualMicros, transactionHash: settled.transaction, payer: settled.payer ?? settlement.payer, status: "settled", updatedAt: new Date() }).where(eq(paymentSettlements.id, settlement.id));
    await database().update(calls).set({ paymentState: "settled", updatedAt: new Date() }).where(eq(calls.id, call.id));
    await queueWebhook(call.id, "payment.settled", { callId: call.id, amountMicros: actualMicros, transaction: settled.transaction });
  } catch (error) {
    await database().update(paymentSettlements).set({ status: "failed", updatedAt: new Date() }).where(eq(paymentSettlements.id, settlement.id));
    await database().update(calls).set({ paymentState: "failed", updatedAt: new Date() }).where(eq(calls.id, call.id));
    await queueWebhook(call.id, "payment.failed", { callId: call.id, error: error instanceof Error ? error.message : "Settlement failed" });
  }
  return true;
}

/** Elapsed wall-clock for a call we are ending ourselves, used when the agent reports no duration. */
export function elapsedSeconds(call: Pick<CallRow, "createdAt">, endedAt: Date) {
  return Math.max(0, Math.round((endedAt.getTime() - call.createdAt.getTime()) / 1000));
}
