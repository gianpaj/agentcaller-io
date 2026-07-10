import { calls } from "@agentcaller/database";
import { and, eq, isNull } from "drizzle-orm";
import { authenticateApiRequest, ApiError } from "@/lib/auth";
import { database } from "@/lib/database";
import { errorResponse } from "@/lib/http";
import { signedRecordingUrl } from "@/lib/r2";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const client = await authenticateApiRequest(request);
    const { id } = await context.params;
    const [call] = await database().select({ recordingKey: calls.recordingKey }).from(calls).where(and(eq(calls.id, id), eq(calls.clientId, client.id), isNull(calls.deletedAt))).limit(1);
    if (!call?.recordingKey) throw new ApiError(404, "Recording is unavailable, not consented, or expired");
    return Response.json({ data: { url: await signedRecordingUrl(call.recordingKey), expiresInSeconds: 300 } });
  } catch (error) {
    return errorResponse(error);
  }
}
