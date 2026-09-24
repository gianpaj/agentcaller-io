import {
  calls,
  callAttempts,
  callLegs,
  callEvents,
  connectJobs,
} from "@agentcaller/database";
import { and, asc, desc, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { database } from "./database";
import { ApiError } from "./auth";

export const historyCursor = z.object({
  at: z.string().datetime(),
  id: z.string().uuid(),
});
export async function listCallHistory(
  clientId: string,
  cursor?: { at: string; id: string },
) {
  const before = cursor ? historyCursor.parse(cursor) : undefined;
  return database()
    .select({
      id: calls.id,
      destination: calls.destination,
      clientReference: calls.clientReference,
      state: calls.state,
      createdAt: calls.createdAt,
      endedAt: calls.endedAt,
      outcome: calls.outcome,
      task: calls.task,
    })
    .from(calls)
    .where(
      and(
        eq(calls.clientId, clientId),
        isNull(calls.deletedAt),
        before
          ? or(
              lt(calls.createdAt, new Date(before.at)),
              and(
                eq(calls.createdAt, new Date(before.at)),
                lt(calls.id, before.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(calls.createdAt), desc(calls.id))
    .limit(31);
}
export async function loadCallHistory(clientId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success)
    throw new ApiError(404, "Call not found");
  const [call] = await database()
    .select()
    .from(calls)
    .where(
      and(
        eq(calls.id, id),
        eq(calls.clientId, clientId),
        isNull(calls.deletedAt),
      ),
    )
    .limit(1);
  if (!call) throw new ApiError(404, "Call not found");
  const [attempts, legs, events, jobs] = await Promise.all([
    database()
      .select()
      .from(callAttempts)
      .where(eq(callAttempts.callId, call.id))
      .orderBy(asc(callAttempts.ordinal)),
    database()
      .select({
        attemptId: callLegs.attemptId,
        kind: callLegs.kind,
        state: callLegs.state,
        connectedAt: callLegs.connectedAt,
        endedAt: callLegs.endedAt,
        measuredMicros: callLegs.measuredMicros,
      })
      .from(callLegs)
      .innerJoin(callAttempts, eq(callAttempts.id, callLegs.attemptId))
      .where(eq(callAttempts.callId, call.id)),
    database()
      .select({
        id: callEvents.id,
        type: callEvents.type,
        payload: callEvents.payload,
        occurredAt: callEvents.occurredAt,
      })
      .from(callEvents)
      .where(eq(callEvents.callId, call.id))
      .orderBy(desc(callEvents.occurredAt), desc(callEvents.id))
      .limit(100),
    database()
      .select()
      .from(connectJobs)
      .where(eq(connectJobs.callId, call.id))
      .limit(1),
  ]);
  return { call, attempts, legs, events, job: jobs[0] };
}
