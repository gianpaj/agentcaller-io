import { calls } from "@agentcaller/database";
import { and, eq, isNull } from "drizzle-orm";
import { authenticateApiRequest, ApiError } from "@/lib/auth";
import { database } from "@/lib/database";
import { errorResponse } from "@/lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const client = await authenticateApiRequest(request);
    const { id } = await context.params;
    const [call] = await database().select({ transcript: calls.transcript }).from(calls).where(and(eq(calls.id, id), eq(calls.clientId, client.id), isNull(calls.deletedAt))).limit(1);
    if (!call) throw new ApiError(404, "Call not found");
    if (!call.transcript) throw new ApiError(404, "Transcript is unavailable or expired");
    return Response.json({ data: call.transcript });
  } catch (error) {
    return errorResponse(error);
  }
}
