import { calls, callEvents } from "@agentcaller/database";
import { and, eq, isNull } from "drizzle-orm";
import { authenticateApiRequest, ApiError } from "@/lib/auth";
import { database } from "@/lib/database";
import { errorResponse } from "@/lib/http";
import { queueWebhook } from "@/lib/webhooks";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const client = await authenticateApiRequest(request);
    const { id } = await context.params;
    const [call] = await database().select().from(calls).where(and(eq(calls.id, id), eq(calls.clientId, client.id), isNull(calls.deletedAt))).limit(1);
    if (!call) throw new ApiError(404, "Call not found");
    if (["completed", "failed", "cancelled"].includes(call.state)) throw new ApiError(409, "Call is already terminal");
    const [cancelled] = await database().update(calls).set({ state: "cancelled", endedAt: new Date(), updatedAt: new Date(), outcome: { reason: "cancelled_by_client" } }).where(eq(calls.id, call.id)).returning();
    await database().insert(callEvents).values({ callId: call.id, type: "call.cancelled", payload: { reason: "cancelled_by_client" } });
    await queueWebhook(call.id, "call.cancelled", { callId: call.id, state: "cancelled" });
    return Response.json({ data: cancelled });
  } catch (error) {
    return errorResponse(error);
  }
}
