import { type ConnectEvent, connectEventSchema } from "@agentcaller/contracts";
import { timingSafeCompare, ApiError } from "@/lib/auth";
import { getAgentCallbackEnv } from "@/lib/env";
import { errorResponse } from "@/lib/http";
import { connectCommand } from "@/lib/connect-me";
import { authorizeConnectFunding } from "@/lib/billing-authority";
import { logConnectTiming } from "@/lib/connect-log";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let timing:
    | {
        callId: string;
        attemptId: string;
        action: ConnectEvent["action"];
        startedAt: number;
        commandStartedAt?: number;
      }
    | undefined;
  let status = 500;
  let allowed: boolean | undefined;
  try {
    if (
      !timingSafeCompare(
        request.headers.get("x-agentcaller-agent-secret"),
        getAgentCallbackEnv().AGENT_CALLBACK_SECRET,
      )
    )
      throw new ApiError(401, "Unauthorized");
    const event = connectEventSchema.parse(await request.json());
    const { id } = await context.params;
    timing = {
      callId: id,
      attemptId: event.attemptId,
      action: event.action,
      startedAt: performance.now(),
    };
    if (
      ["claim", "heartbeat", "dial", "accept", "bridged"].includes(event.action)
    )
      await authorizeConnectFunding(
        id,
        undefined,
        event.action === "claim" ||
          (event.action === "dial" && event.leg === "business")
          ? undefined
          : event.attemptId,
      );
    timing.commandStartedAt = performance.now();
    const result = await connectCommand(id, event);
    if (
      result &&
      typeof result === "object" &&
      "allowed" in result &&
      typeof result.allowed === "boolean"
    )
      allowed = result.allowed;
    status = 200;
    return Response.json(result);
  } catch (error) {
    const response = errorResponse(error);
    status = response.status;
    return response;
  } finally {
    if (timing) {
      const finishedAt = performance.now();
      logConnectTiming(
        "callback",
        {
          callId: timing.callId,
          attemptId: timing.attemptId,
          action: timing.action,
        },
        {
          totalMs: Math.round(finishedAt - timing.startedAt),
          authorizationMs: Math.round(
            (timing.commandStartedAt ?? finishedAt) - timing.startedAt,
          ),
          ...(timing.commandStartedAt === undefined
            ? {}
            : { commandMs: Math.round(finishedAt - timing.commandStartedAt) }),
        },
        { status, ...(allowed === undefined ? {} : { allowed }) },
      );
    }
  }
}
