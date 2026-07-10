import { z } from "zod";

const agentEnv = z.object({
  PLATFORM_URL: z.string().url(),
  AGENT_CALLBACK_SECRET: z.string().min(32),
});

let cached: z.infer<typeof agentEnv> | undefined;

function env() {
  if (!cached) cached = agentEnv.parse(process.env);
  return cached;
}

export type TranscriptEntry = { speaker: string; text: string; at: string };

export type CallEvent = {
  type: "call.dialing" | "call.in_progress" | "call.completed" | "call.failed";
  durationSeconds?: number;
  outcome?: Record<string, unknown>;
  transcript?: TranscriptEntry[];
};

const MAX_ATTEMPTS = 4;
const TIMEOUT_MS = 10_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reports a lifecycle event to the platform. The platform writes `ended_at` and settles payment
 * from these events, so a dropped terminal event leaves a call billable-but-unbilled and holds a
 * slot against the client's concurrency limit — hence the retries.
 *
 * The platform ignores events for calls that are already terminal, so retrying is safe.
 */
export async function reportEvent(callId: string, event: CallEvent) {
  const { PLATFORM_URL, AGENT_CALLBACK_SECRET } = env();
  const url = `${PLATFORM_URL.replace(/\/$/, "")}/api/internal/calls/${callId}/event`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agentcaller-agent-secret": AGENT_CALLBACK_SECRET },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return true;
      // The platform rejected the event itself; retrying will not change the verdict.
      if (response.status >= 400 && response.status < 500) {
        console.error(`Call event ${event.type} rejected for ${callId}: ${response.status}`);
        return false;
      }
      throw new Error(`Platform responded ${response.status}`);
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        console.error(`Call event ${event.type} failed for ${callId} after ${attempt} attempts`, error);
        return false;
      }
      await wait(2 ** attempt * 250);
    }
  }
  return false;
}
