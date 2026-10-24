import { calls, paymentSettlements, rateCards } from "@agentcaller/database";
import { and, eq } from "drizzle-orm";
import { ApiError } from "./auth";
import { database } from "./database";
import { paymentRequirements, settlePayment } from "./payment";
import { queueWebhook } from "./webhooks";

type CallRow = typeof calls.$inferSelect;

/**
 * What the telephony leg did. Only a ringing leg nobody answered or an answered leg is billable;
 * a call that never rang (cancelled first, routing or platform failure) costs nothing.
 */
export type CallUsage =
  | { kind: "not_dialed" }
  | { kind: "unanswered" }
  | { kind: "connected"; seconds: number };

const UNANSWERED_REASONS = ["busy", "no_answer"];

/** Classifies a terminal agent report. `answered` is the worker's SIP answer signal. */
export function usageFromReport(report: {
  answered: boolean;
  durationSeconds?: number;
  reason?: unknown;
}): CallUsage {
  if (report.answered)
    return { kind: "connected", seconds: report.durationSeconds ?? 0 };
  return UNANSWERED_REASONS.includes(String(report.reason))
    ? { kind: "unanswered" }
    : { kind: "not_dialed" };
}

/**
 * An unanswered leg pays the connection fee; an answered leg adds every started minute.
 * Never more than the client's ceiling.
 */
export function chargeableMicros(
  call: Pick<CallRow, "maxAmountMicros">,
  rate: Pick<
    typeof rateCards.$inferSelect,
    "connectionFeeMicros" | "startedMinuteFeeMicros"
  >,
  usage: CallUsage,
) {
  if (usage.kind === "not_dialed") return 0;
  const startedMinutes =
    usage.kind === "connected" ? Math.ceil(usage.seconds / 60) : 0;
  return Math.min(
    call.maxAmountMicros,
    rate.connectionFeeMicros + startedMinutes * rate.startedMinuteFeeMicros,
  );
}

/**
 * Settles a call exactly once. The conditional update is the lock: whichever caller flips
 * payment_state away from 'authorized' owns settlement, so a replayed terminal event, a
 * concurrent cancel, and a retrying agent cannot double-charge the payer.
 *
 * Returns false when another caller already owns (or completed) settlement.
 */
export async function settleCallOnce(call: CallRow, usage: CallUsage) {
  if (call.fundingSource === "operator") return false;
  if ((call.task as { type?: string }).type === "connect_me")
    throw new ApiError(
      503,
      "Connect jobs require aggregate leg settlement with a supported payment scheme",
    );
  const claimed = await database()
    .update(calls)
    .set({ paymentState: "settling", updatedAt: new Date() })
    .where(and(eq(calls.id, call.id), eq(calls.paymentState, "authorized")))
    .returning({ id: calls.id });
  if (!claimed.length) return false;

  const [settlement] = await database()
    .select()
    .from(paymentSettlements)
    .where(eq(paymentSettlements.callId, call.id))
    .limit(1);
  const [rate] = await database()
    .select()
    .from(rateCards)
    .where(eq(rateCards.version, call.rateCardVersion))
    .limit(1);
  if (!settlement || !rate || !settlement.paymentPayload)
    throw new ApiError(500, "Call settlement cannot be resolved");

  const actualMicros = chargeableMicros(call, rate, usage);

  try {
    // Nothing to capture: let the payment authorization lapse instead of settling zero.
    const settled =
      actualMicros === 0
        ? {
            success: true,
            transaction: undefined,
            payer: undefined,
            errorReason: undefined,
          }
        : await settlePayment(
            settlement.paymentPayload,
            paymentRequirements(settlement.authorizedMicros),
            actualMicros,
          );
    if (!settled.success)
      throw new Error(settled.errorReason ?? "Settlement was rejected");
    await database()
      .update(paymentSettlements)
      .set({
        settledMicros: actualMicros,
        transactionHash: settled.transaction,
        payer: settled.payer ?? settlement.payer,
        status: "settled",
        updatedAt: new Date(),
      })
      .where(eq(paymentSettlements.id, settlement.id));
    await database()
      .update(calls)
      .set({ paymentState: "settled", updatedAt: new Date() })
      .where(eq(calls.id, call.id));
    await queueWebhook(call.id, "payment.settled", {
      callId: call.id,
      amountMicros: actualMicros,
      transaction: settled.transaction,
    });
  } catch (error) {
    await database()
      .update(paymentSettlements)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(paymentSettlements.id, settlement.id));
    await database()
      .update(calls)
      .set({ paymentState: "failed", updatedAt: new Date() })
      .where(eq(calls.id, call.id));
    await queueWebhook(call.id, "payment.failed", {
      callId: call.id,
      error: error instanceof Error ? error.message : "Settlement failed",
    });
  }
  return true;
}

/** Whole seconds between the answer signal and the end; never negative when clocks disagree. */
export function connectedSeconds(answeredAt: Date, endedAt: Date) {
  return Math.max(
    0,
    Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000),
  );
}
