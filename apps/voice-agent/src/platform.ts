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
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agentcaller-agent-secret": AGENT_CALLBACK_SECRET,
        },
        body: JSON.stringify(event),
        signal,
      });
      if (response.ok) return true;
      await response.body?.cancel();
      console.error("Call event callback failed", {
        stage: event.type,
        callId,
        requestAttempt: attempt,
        status: response.status,
      });
      // The platform rejected the event itself; retrying will not change the verdict.
      if (response.status >= 400 && response.status < 500) {
        return false;
      }
    } catch (error) {
      console.error("Call event callback failed", {
        stage: event.type,
        callId,
        requestAttempt: attempt,
        failure:
          signal.aborted ||
          (error instanceof Error && error.name === "TimeoutError")
            ? "timeout"
            : "network",
      });
    }
    if (attempt < MAX_ATTEMPTS) await wait(2 ** attempt * 250);
  }
  return false;
}

export async function connectRequest(
  callId: string,
  event: import("@agentcaller/contracts").ConnectEvent,
): Promise<unknown> {
  let config: z.infer<typeof agentEnv>;
  try {
    config = env();
  } catch {
    console.error("Connect callback configuration is invalid", {
      stage: event.action,
      callId,
      attemptId: event.attemptId,
      failure: "invalid_configuration",
    });
    return { allowed: false };
  }
  const { PLATFORM_URL, AGENT_CALLBACK_SECRET } = config;
  // Reuse the exact event ID across transport retries. A dial command itself is never retried.
  for (let attempt = 0; attempt < 3; attempt++) {
    const signal = AbortSignal.timeout(5000);
    const context = {
      stage: event.action,
      callId,
      attemptId: event.attemptId,
      requestAttempt: attempt + 1,
    };
    try {
      const response = await fetch(
        `${PLATFORM_URL.replace(/\/$/, "")}/api/internal/calls/${callId}/connect`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-agentcaller-agent-secret": AGENT_CALLBACK_SECRET,
          },
          body: JSON.stringify(event),
          signal,
        },
      );
      if (response.ok) {
        let result;
        try {
          result = await response.json();
        } catch (error) {
          if (signal.aborted) throw error;
          console.error("Connect callback failed", {
            ...context,
            status: response.status,
            failure: "invalid_response",
          });
          continue;
        }
        if (!result || typeof result.allowed !== "boolean") {
          console.error("Connect callback failed", {
            ...context,
            status: response.status,
            failure: "invalid_response",
          });
          continue;
        }
        if (!result.allowed)
          console.warn("Connect command denied", {
            ...context,
            status: response.status,
          });
        return result;
      }
      await response.body?.cancel();
      console.error("Connect callback failed", {
        ...context,
        status: response.status,
      });
      if (response.status < 500) return { allowed: false };
    } catch (error) {
      console.error("Connect callback failed", {
        ...context,
        failure:
          signal.aborted ||
          (error instanceof Error && error.name === "TimeoutError")
            ? "timeout"
            : "network",
      });
    }
  }
  return { allowed: false };
}
