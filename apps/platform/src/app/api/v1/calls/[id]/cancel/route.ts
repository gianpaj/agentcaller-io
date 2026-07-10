import { calls, callEvents } from "@agentcaller/database";
import { and, eq, isNull } from "drizzle-orm";
import { authenticateApiRequest, ApiError } from "@/lib/auth";
import { database } from "@/lib/database";
import { errorResponse } from "@/lib/http";
import { roomNameForCall, stopCall } from "@/lib/livekit";
import { elapsedSeconds, settleCallOnce } from "@/lib/settlement";
import { queueWebhook } from "@/lib/webhooks";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const client = await authenticateApiRequest(request);
    const { id } = await context.params;
    const [call] = await database().select().from(calls).where(and(eq(calls.id, id), eq(calls.clientId, client.id), isNull(calls.deletedAt))).limit(1);
    if (!call) throw new ApiError(404, "Call not found");
    if (["completed", "failed", "cancelled"].includes(call.state)) throw new ApiError(409, "Call is already terminal");

    // Claim the transition before tearing down, so a racing agent event cannot settle a call we
    // are about to cancel and we cannot cancel twice.
    const [cancelled] = await database().update(calls)
      .set({ state: "cancelled", endedAt: new Date(), updatedAt: new Date(), outcome: { reason: "cancelled_by_client" } })
      .where(and(eq(calls.id, call.id), eq(calls.state, call.state)))
      .returning();
    if (!cancelled) throw new ApiError(409, "Call is already terminal");

    // Drop the PSTN leg. The row is already terminal, so a teardown failure must not fail the
    // request; the room's maxCallDuration still bounds the call.
    try {
      await stopCall(call.livekitRoom ?? roomNameForCall(call.id));
    } catch (error) {
      console.error("Failed to tear down LiveKit room for cancelled call", call.id, error);
    }

    await database().insert(callEvents).values({ callId: call.id, type: "call.cancelled", payload: { reason: "cancelled_by_client" } });
    await queueWebhook(call.id, "call.cancelled", { callId: call.id, state: "cancelled" });

    // The agent's terminal event is ignored once a call is terminal, so cancel owns settlement
    // for whatever the call already consumed. Otherwise the authorization is never captured.
    await settleCallOnce(cancelled, elapsedSeconds(call, cancelled.endedAt ?? new Date()));
    return Response.json({ data: cancelled });
  } catch (error) {
    return errorResponse(error);
  }
}
