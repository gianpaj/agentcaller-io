import { authorizeOperatorCall } from "./operator-funding";
import { callAttempts } from "@agentcaller/database";
import { and, eq, gt, isNotNull, or, inArray, asc } from "drizzle-orm";
import { database } from "./database";
import { stopCall, dispatchConnectAttempt } from "./livekit";
import { claimConnectAttempt, dueConnectJobs } from "./connect-me";

export async function cleanupConnectRooms(callId?: string) {
  const attempts = await database()
    .select()
    .from(callAttempts)
    .where(
      and(
        isNotNull(callAttempts.endedAt),
        or(
          gt(callAttempts.cleanupUntil, new Date()),
          inArray(callAttempts.reason, [
            "dial_unknown",
            "worker_lost",
            "cancelled",
            "configuration_error",
          ]),
        ),
        ...(callId ? [eq(callAttempts.callId, callId)] : []),
      ),
    )
    .orderBy(asc(callAttempts.updatedAt))
    .limit(100);
  const cleanup = await Promise.allSettled(
    attempts.flatMap((a) => [
      stopCall(a.businessRoom),
      stopCall(a.callbackRoom),
    ]),
  );
  for (const attempt of attempts)
    await database()
      .update(callAttempts)
      .set({ updatedAt: new Date() })
      .where(eq(callAttempts.id, attempt.id));
  return {
    attempts: attempts.length,
    failedRooms: cleanup.filter((result) => result.status === "rejected")
      .length,
  };
}
/** Only durably authorized operator jobs may dispatch; paid connect jobs remain blocked. */
export async function drainConnectJobs(dispatch = dispatchConnectAttempt) {
  for (const { callId } of await dueConnectJobs()) {
    let permitted = true;
    try {
      await authorizeOperatorCall(callId);
    } catch {
      permitted = false;
    }
    const attempt = await claimConnectAttempt(
      callId,
      database(),
      new Date(),
      permitted,
    );
    if (!attempt) continue;
    try {
      await dispatch(callId, attempt.id, attempt.businessRoom);
    } catch {
      // Never dispatch twice after a timeout. Lease expiry terminates the attempt and cleans rooms.
      // A late worker must claim the durable attempt before it can dial.
    }
  }
  return { cleanup: await cleanupConnectRooms() };
}
