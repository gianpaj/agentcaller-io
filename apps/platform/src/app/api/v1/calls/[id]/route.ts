import { calls, paymentSettlements } from "@agentcaller/database";
import { and, eq, isNull } from "drizzle-orm";
import { authenticateApiRequest, ApiError } from "@/lib/auth";
import { database } from "@/lib/database";
import { errorResponse } from "@/lib/http";
import { deleteRecording } from "@/lib/r2";

async function loadCall(id: string, clientId: string) {
  const [call] = await database().select().from(calls).where(and(eq(calls.id, id), eq(calls.clientId, clientId), isNull(calls.deletedAt))).limit(1);
  if (!call) throw new ApiError(404, "Call not found");
  return call;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const client = await authenticateApiRequest(request);
    const { id } = await context.params;
    const call = await loadCall(id, client.id);
    const [settlement] = await database().select({ settledMicros: paymentSettlements.settledMicros, transactionHash: paymentSettlements.transactionHash, status: paymentSettlements.status }).from(paymentSettlements).where(eq(paymentSettlements.callId, call.id)).limit(1);
    return Response.json({ data: { ...call, settlement } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const client = await authenticateApiRequest(request);
    const { id } = await context.params;
    const call = await loadCall(id, client.id);
    if (call.recordingKey) await deleteRecording(call.recordingKey);
    await database().update(paymentSettlements).set({ callId: null, updatedAt: new Date() }).where(eq(paymentSettlements.callId, call.id));
    await database().delete(calls).where(eq(calls.id, call.id));
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
