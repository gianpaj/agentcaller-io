import { authorizeConnectFunding } from "./billing-authority";
import { callAttempts } from "@agentcaller/database";
import { and, eq, gt, isNotNull, isNull, or, inArray, asc } from "drizzle-orm";
import { database } from "./database";
import { stopCall, dispatchConnectAttempt } from "./livekit";
import { claimConnectAttempt, dueConnectJobs } from "./connect-me";
import { logConnectFailure } from "./connect-log";

const UNCERTAIN_CLEANUP = [
  "dial_unknown",
  "worker_lost",
  "cancelled",
  "configuration_error",
];
const UNCERTAIN_RETRY_MS = 15 * 60 * 1000;

export async function cleanupConnectRooms(callId?: string) {
  const now = new Date();
  const attempts = await database()
    .select()
    .from(callAttempts)
    .where(
      and(
        isNotNull(callAttempts.endedAt),
        isNull(callAttempts.roomsCleanedAt),
        or(
          gt(callAttempts.cleanupUntil, now),
          and(
            inArray(callAttempts.reason, UNCERTAIN_CLEANUP),
            gt(
              callAttempts.endedAt,
              new Date(now.getTime() - UNCERTAIN_RETRY_MS),
            ),
          ),
        ),
        ...(callId ? [eq(callAttempts.callId, callId)] : []),
      ),
    )
    .orderBy(asc(callAttempts.updatedAt))
    .limit(100);
  let failedRooms = 0;
  for (const attempt of attempts) {
    const cleanup = await Promise.allSettled([
      stopCall(attempt.businessRoom),
      stopCall(attempt.callbackRoom),
    ]);
    const failed = cleanup.filter((result) => result.status === "rejected");
    cleanup.forEach((result, index) => {
      if (result.status === "rejected")
        logConnectFailure(
          index === 0 ? "cleanup_business" : "cleanup_callback",
          result.reason,
          { callId: attempt.callId, attemptId: attempt.id },
        );
    });
    failedRooms += failed.length;
    if (failed.length === 0)
      await database()
        .update(callAttempts)
        .set({ roomsCleanedAt: new Date() })
        .where(eq(callAttempts.id, attempt.id));
  }
  return { attempts: attempts.length, failedRooms };
}
/** Dispatch only with current durable funding authority and the matching release gate. */
export async function drainConnectJobs(dispatch = dispatchConnectAttempt) {
  for (const { callId } of await dueConnectJobs()) {
    let permitted = true;
    try {
      await authorizeConnectFunding(callId);
    } catch (error) {
      logConnectFailure("authorize", error, { callId });
      permitted = false;
    }
    let attempt;
    try {
      attempt = await claimConnectAttempt(
        callId,
        database(),
        new Date(),
        permitted,
      );
    } catch (error) {
      logConnectFailure("claim_attempt", error, { callId });
      throw error;
    }
    if (!attempt) continue;
    try {
      await dispatch(callId, attempt.id, attempt.businessRoom);
    } catch (error) {
      logConnectFailure("dispatch", error, { callId, attemptId: attempt.id });
      // Never dispatch twice after a timeout. Lease expiry terminates the attempt and cleans rooms.
      // A late worker must claim the durable attempt before it can dial.
    }
  }
  return { cleanup: await cleanupConnectRooms() };
}
