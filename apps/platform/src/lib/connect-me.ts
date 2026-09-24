import { randomUUID } from "node:crypto";
import {
  createCallSchema,
  inCallingWindow,
  nextWindowStart,
  retryTime,
  legLimit,
  type ConnectEvent,
} from "@agentcaller/contracts";
import {
  calls,
  callAttempts,
  callLegs,
  connectJobs,
  connectReceipts,
  callEvents,
  webhookDeliveries,
} from "@agentcaller/database";
import { and, eq, isNull, lte, asc } from "drizzle-orm";
import { database } from "./database";
import { ApiError } from "./auth";
import { attemptReserve, quotedCost } from "./connect-policy";

type DB = ReturnType<typeof database>;
type TX = Parameters<Parameters<DB["transaction"]>[0]>[0];

async function terminal(tx: TX, callId: string, reason: string, now: Date) {
  const [funding] = await tx
    .select({ source: calls.fundingSource })
    .from(calls)
    .where(eq(calls.id, callId));
  const state =
    reason === "connected"
      ? "completed"
      : reason === "cancelled"
        ? "cancelled"
        : "failed";
  await tx
    .update(calls)
    .set({
      state,
      endedAt: now,
      updatedAt: now,
      outcome: {
        reason,
        costStatus:
          funding?.source === "operator" ? "operator_funded" : "unsettled",
      },
    })
    .where(and(eq(calls.id, callId), isNull(calls.endedAt)));
  await tx
    .insert(callEvents)
    .values({ callId, type: `call.${state}`, payload: { reason } });
  await tx.insert(webhookDeliveries).values({
    callId,
    eventType: `call.${state}`,
    payload: { callId, state, reason },
  });
}

/** Call-row lock serializes cancellation, scheduler and worker commands. No network inside. */
export async function connectCommand(
  callId: string,
  event: ConnectEvent,
  db = database(),
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const [call] = await tx
      .select()
      .from(calls)
      .where(eq(calls.id, callId))
      .for("update");
    const [attempt] = await tx
      .select()
      .from(callAttempts)
      .where(
        and(
          eq(callAttempts.id, event.attemptId),
          eq(callAttempts.callId, callId),
        ),
      );
    if (!call || !attempt) throw new ApiError(404, "Attempt not found");
    const input = createCallSchema.parse({
      ...call,
      maxAmountUsd: call.maxAmountMicros / 1e6,
      voiceId: call.voiceId ?? undefined,
      clientReference: call.clientReference ?? undefined,
    });
    if (input.task.type !== "connect_me")
      throw new ApiError(409, "Not a connect-me job");
    const task = input.task;
    const [job] = await tx
      .select()
      .from(connectJobs)
      .where(eq(connectJobs.callId, callId));
    if (!job) throw new ApiError(409, "Missing job");
    // Even a replayed permission must not authorize work after cancellation or worker loss.
    const expired = now.getTime() >= Date.parse(task.expiresAt);
    // Finish stays open after expiry so the worker can hang up with the real reason.
    if (
      call.endedAt ||
      attempt.endedAt ||
      now.getTime() - attempt.heartbeatAt.getTime() > 90_000 ||
      (expired && event.action !== "finish")
    )
      return { allowed: false };
    if (
      (event.action !== "claim" || attempt.workerId !== null) &&
      attempt.workerId !== event.workerId
    )
      return { allowed: false };
    const [receipt] = await tx
      .select()
      .from(connectReceipts)
      .where(eq(connectReceipts.eventId, event.eventId));
    if (receipt)
      return receipt.attemptId === attempt.id
        ? receipt.response
        : { allowed: false };
    let defer: "outside_window" | undefined;
    const legs = await tx
      .select()
      .from(callLegs)
      .where(eq(callLegs.attemptId, attempt.id));
    const leg = legs.find((v) => v.kind === event.leg);
    const business = legs.find((v) => v.kind === "business");
    const callback = legs.find((v) => v.kind === "callback");
    let allowed = true;
    switch (event.action) {
      case "claim":
        allowed = attempt.workerId === null;
        if (allowed)
          await tx
            .update(callAttempts)
            .set({
              workerId: event.workerId,
              state: "running",
              heartbeatAt: now,
            })
            .where(eq(callAttempts.id, attempt.id));
        break;
      case "heartbeat":
        await tx
          .update(callAttempts)
          .set({ heartbeatAt: now })
          .where(eq(callAttempts.id, attempt.id));
        break;
      case "dial":
        if (
          event.leg === "business" &&
          !leg &&
          attempt.state === "running" &&
          !inCallingWindow(task, now)
        ) {
          allowed = false;
          defer = "outside_window";
          break;
        }
        allowed =
          !!event.leg &&
          !leg &&
          (event.leg === "business"
            ? attempt.state === "running"
            : attempt.state === "human" && business?.state === "connected");
        if (allowed) {
          await tx.insert(callLegs).values({
            attemptId: attempt.id,
            kind: event.leg!,
            identity: `${event.leg}_${attempt.id}`,
          });
          await tx
            .update(calls)
            .set({ state: "dialing", updatedAt: now })
            .where(eq(calls.id, callId));
        }
        break;
      case "connected":
        allowed = !!leg && leg.state === "intent" && !!event.at;
        if (allowed)
          await tx
            .update(callLegs)
            .set({
              state: "connected",
              connectedAt: new Date(event.at!),
              sipCallId: event.sipCallId,
            })
            .where(eq(callLegs.id, leg!.id));
        break;
      case "ended": {
        allowed = !!leg && leg.state !== "ended" && !!event.at;
        const end = new Date(event.at ?? now);
        if (allowed)
          await tx
            .update(callLegs)
            .set({
              state: "ended",
              endedAt: end,
              measuredMicros:
                leg!.connectedAt && end >= leg!.connectedAt
                  ? quotedCost(
                      event.leg === "business"
                        ? job.businessRate
                        : job.callbackRate,
                      (end.getTime() - leg!.connectedAt.getTime()) / 1000,
                    )
                  : null,
            })
            .where(eq(callLegs.id, leg!.id));
        break;
      }
      case "human":
        allowed =
          attempt.state === "running" && business?.state === "connected";
        if (allowed)
          await tx
            .update(callAttempts)
            .set({ state: "human" })
            .where(eq(callAttempts.id, attempt.id));
        break;
      case "accept":
        allowed =
          attempt.state === "human" &&
          business?.state === "connected" &&
          callback?.state === "connected";
        if (allowed)
          await tx
            .update(callAttempts)
            .set({ state: "accepted" })
            .where(eq(callAttempts.id, attempt.id));
        break;
      case "bridged":
        allowed =
          attempt.state === "accepted" &&
          business?.state === "connected" &&
          callback?.state === "connected";
        if (allowed) {
          await tx
            .update(callAttempts)
            .set({ state: "bridged" })
            .where(eq(callAttempts.id, attempt.id));
          await tx
            .update(calls)
            .set({ state: "in_progress", updatedAt: now })
            .where(eq(calls.id, callId));
        }
        break;
      case "finish": {
        if (!event.reason) throw new ApiError(422, "Terminal reason required");
        if (event.reason === "connected" && attempt.state !== "bridged") {
          allowed = false;
          break;
        }
        // Only explicit pre-answer SIP failures may retry. Connected or uncertain legs never do.
        // A closed window defers to the next open minute instead of cancelling the job.
        const preAnswer =
          !business?.connectedAt && !callback && attempt.state === "running";
        const retry = !preAnswer
          ? null
          : event.reason === "outside_window"
            ? nextWindowStart(task, now)
            : retryTime(task, attempt.ordinal, event.reason, now);
        await tx
          .update(callAttempts)
          .set({ state: "terminal", reason: event.reason, endedAt: now })
          .where(eq(callAttempts.id, attempt.id));
        if (retry) {
          await tx
            .update(connectJobs)
            .set({ nextAttemptAt: retry })
            .where(eq(connectJobs.callId, callId));
          await tx
            .update(calls)
            .set({
              state: "queued",
              updatedAt: now,
              outcome: {
                reason: event.reason,
                nextAttemptAt: retry.toISOString(),
              },
            })
            .where(eq(calls.id, callId));
        } else
          await terminal(
            tx,
            callId,
            event.reason === "outside_window"
              ? "expired"
              : ["busy", "no_answer"].includes(event.reason)
                ? "attempts_exhausted"
                : event.reason,
            now,
          );
        break;
      }
    }
    if (allowed && event.action !== "heartbeat")
      await tx.insert(callEvents).values({
        callId,
        type: `connect.${event.action}`,
        payload: {
          attemptId: attempt.id,
          ordinal: attempt.ordinal,
          leg: event.leg,
          reason: event.reason,
        },
        occurredAt: now,
      });
    const response = {
      allowed,
      ...(defer ? { defer } : {}),
      ...(event.action === "claim" && allowed
        ? {
            input,
            businessRoom: attempt.businessRoom,
            callbackRoom: attempt.callbackRoom,
          }
        : {}),
    };
    await tx
      .insert(connectReceipts)
      .values({ eventId: event.eventId, attemptId: attempt.id, response });
    return response;
  });
}

export async function claimConnectAttempt(
  callId: string,
  db = database(),
  now = new Date(),
  allowNewAttempt = true,
) {
  return db.transaction(async (tx) => {
    const [call] = await tx
      .select()
      .from(calls)
      .where(eq(calls.id, callId))
      .for("update");
    if (
      !call ||
      call.endedAt ||
      (call.fundingSource === "operator"
        ? call.paymentState !== "not_required"
        : call.paymentState !== "authorized")
    )
      return null;
    const [job] = await tx
      .select()
      .from(connectJobs)
      .where(eq(connectJobs.callId, callId));
    const input = createCallSchema.parse({
      ...call,
      maxAmountUsd: call.maxAmountMicros / 1e6,
      voiceId: call.voiceId ?? undefined,
      clientReference: call.clientReference ?? undefined,
    });
    if (!job || input.task.type !== "connect_me") return null;
    await tx
      .update(connectJobs)
      .set({ updatedAt: now })
      .where(eq(connectJobs.callId, callId));
    const task = input.task;
    const [active] = await tx
      .select()
      .from(callAttempts)
      .where(
        and(eq(callAttempts.callId, callId), isNull(callAttempts.endedAt)),
      );
    if (active) {
      const heartbeatStale =
        now.getTime() - active.heartbeatAt.getTime() > 90_000;
      const expired = now.getTime() >= Date.parse(task.expiresAt);
      const pastCleanup = now >= active.cleanupUntil;
      if (heartbeatStale || expired || pastCleanup) {
        const reason = heartbeatStale
          ? "worker_lost"
          : expired
            ? "expired"
            : "duration_limit";
        await tx
          .update(callAttempts)
          .set({ state: "terminal", endedAt: now, reason })
          .where(eq(callAttempts.id, active.id));
        await terminal(tx, callId, reason, now);
      }
      return null;
    }
    if (
      Date.parse(task.expiresAt) <=
      now.getTime() + task.ringingSeconds * 1000
    ) {
      await terminal(tx, callId, "expired", now);
      return null;
    }
    if (!allowNewAttempt) return null;
    if (job.attemptCount >= task.maxAttempts) {
      await terminal(tx, callId, "attempts_exhausted", now);
      return null;
    }
    if (job.nextAttemptAt > now || !inCallingWindow(task, now)) return null;
    const reserve = attemptReserve(task, job.businessRate, job.callbackRate);
    if (job.reservedMicros + reserve > call.maxAmountMicros) {
      await terminal(tx, callId, "spend_limit", now);
      return null;
    }
    const id = randomUUID();
    const [attempt] = await tx
      .insert(callAttempts)
      .values({
        id,
        callId,
        ordinal: job.attemptCount + 1,
        heartbeatAt: now,
        businessRoom: `connect_${id}`,
        callbackRoom: `callback_${id}`,
        cleanupUntil: new Date(
          now.getTime() +
            (task.ringingSeconds + legLimit(task, "business") + 120) * 1000,
        ),
      })
      .returning();
    await tx
      .update(connectJobs)
      .set({
        attemptCount: job.attemptCount + 1,
        reservedMicros: job.reservedMicros + reserve,
      })
      .where(eq(connectJobs.callId, callId));
    return attempt;
  });
}

export async function cancelConnect(
  callId: string,
  clientId: string,
  db = database(),
) {
  return db.transaction(async (tx) => {
    const [call] = await tx
      .select()
      .from(calls)
      .where(and(eq(calls.id, callId), eq(calls.clientId, clientId)))
      .for("update");
    if (!call) throw new ApiError(404, "Call not found");
    if ((call.task as { type?: string }).type !== "connect_me")
      throw new ApiError(409, "Not a connect-me job");
    if (!call.endedAt) {
      await terminal(tx, callId, "cancelled", new Date());
      await tx
        .update(callAttempts)
        .set({ state: "terminal", endedAt: new Date(), reason: "cancelled" })
        .where(
          and(eq(callAttempts.callId, callId), isNull(callAttempts.endedAt)),
        );
    }
    return { ...call, state: call.endedAt ? call.state : "cancelled" };
  });
}

export async function dueConnectJobs(db = database()) {
  return db
    .select({ callId: connectJobs.callId })
    .from(connectJobs)
    .innerJoin(calls, eq(calls.id, connectJobs.callId))
    .where(
      and(isNull(calls.endedAt), lte(connectJobs.nextAttemptAt, new Date())),
    )
    .orderBy(asc(connectJobs.updatedAt))
    .limit(100);
}
