import { connectEventSchema } from "@agentcaller/contracts";
import { timingSafeCompare, ApiError } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { errorResponse } from "@/lib/http";
import { connectCommand } from "@/lib/connect-me";
import { authorizeOperatorCall } from "@/lib/operator-funding";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (
      !timingSafeCompare(
        request.headers.get("x-agentcaller-agent-secret"),
        getServerEnv().AGENT_CALLBACK_SECRET,
      )
    )
      throw new ApiError(401, "Unauthorized");
    const event = connectEventSchema.parse(await request.json());
    const { id } = await context.params;
    if (
      ["claim", "heartbeat", "dial", "accept", "bridged"].includes(event.action)
    )
      await authorizeOperatorCall(id);
    return Response.json(await connectCommand(id, event));
  } catch (error) {
    return errorResponse(error);
  }
}
