import { callEvents, calls } from "@agentcaller/database";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError, timingSafeCompare } from "@/lib/auth";
import { database } from "@/lib/database";
import { getServerEnv } from "@/lib/env";
import { errorResponse } from "@/lib/http";
import { isRecordingKeyForCall } from "@/lib/r2";
import { settleCallOnce } from "@/lib/settlement";
import { queueWebhook } from "@/lib/webhooks";

const TERMINAL_STATES = ["completed", "failed", "cancelled"] as const;

const eventSchema = z.object({
  type: z.enum(["call.dialing", "call.in_progress", "call.completed", "call.failed", "call.cancelled"]),
  durationSeconds: z.number().int().min(0).max(1800).optional(),
  outcome: z.record(z.string(), z.unknown()).optional(),
  transcript: z.array(z.object({
    speaker: z.string().max(40),
    text: z.string().max(4000),
    at: z.string().max(40),
  })).max(2000).optional(),
  recordingKey: z.string().min(1).max(300).optional(),
  recordingConsent: z.boolean().optional(),
});

type CallRow = typeof calls.$inferSelect;

function isTerminal(state: string): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!timingSafeCompare(request.headers.get("x-agentcaller-agent-secret"), getServerEnv().AGENT_CALLBACK_SECRET)) {
      throw new ApiError(401, "Unauthorized agent event");
    }
    const { id } = await context.params;
    const event = eventSchema.parse(await request.json());
    const [call] = await database().select().from(calls).where(eq(calls.id, id)).limit(1);
    if (!call) throw new ApiError(404, "Call not found");

    // A terminal call is final. Late or replayed events must never reopen it, because an active
    // call is billable, counts against the concurrency limit, and can be settled again.
    if (isTerminal(call.state)) return Response.json({ data: call, ignored: "call is already terminal" });

    const state = event.type.replace("call.", "") as CallRow["state"];
    const terminal = isTerminal(state);

    if (event.recordingKey && !isRecordingKeyForCall(event.recordingKey, call.id)) {
      throw new ApiError(422, "Recording key is outside this call's prefix");
    }

    const [updated] = await database().update(calls)
      .set({
        state,
        outcome: event.outcome ?? call.outcome,
        transcript: event.transcript ?? call.transcript,
        recordingKey: event.recordingKey ?? call.recordingKey,
        recordingConsent: event.recordingConsent ?? call.recordingConsent,
        ...(terminal ? { endedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      // Re-check the state we read: a concurrent event may have made the call terminal since.
      .where(and(eq(calls.id, id), eq(calls.state, call.state)))
      .returning();
    if (!updated) return Response.json({ data: call, ignored: "call changed state concurrently" });

    // The transcript and recording key already live on the call row; keeping a second copy in the
    // event payload doubles storage and would survive any future purge of calls.transcript.
    const { transcript: _transcript, recordingKey: _recordingKey, ...eventPayload } = event;
    await database().insert(callEvents).values({ callId: id, type: event.type, payload: eventPayload });
    await queueWebhook(id, event.type, { callId: id, state, outcome: event.outcome });

    if (terminal) await settleCallOnce(updated, event.durationSeconds);
    return Response.json({ data: updated });
  } catch (error) {
    return errorResponse(error);
  }
}
