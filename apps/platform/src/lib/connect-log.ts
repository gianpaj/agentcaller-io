/** Provider messages and response bodies may contain credentials or task data. */
export function logConnectFailure(
  stage: string,
  error: unknown,
  ids: { callId?: string; attemptId?: string } = {},
) {
  const details = error && typeof error === "object" ? error : {};
  const status = "status" in details ? details.status : undefined;
  const name = "name" in details ? details.name : undefined;
  console.error("Connect operation failed", {
    stage,
    ...ids,
    ...(typeof status === "number" && status >= 100 && status <= 599
      ? { status }
      : {}),
    failure:
      name === "TimeoutError" || name === "AbortError"
        ? "timeout"
        : name === "ZodError"
          ? "invalid_configuration"
          : "request_failed",
  });
}

/** Milliseconds only; never pass callback bodies or provider errors to timing logs. */
export function logConnectTiming(
  stage: "callback" | "transaction",
  ids: { callId: string; attemptId: string; action: string },
  timings: {
    totalMs: number;
    authorizationMs?: number;
    commandMs?: number;
    transactionStartMs?: number;
    transactionMs?: number;
  },
  result: { status?: number; allowed?: boolean } = {},
) {
  if (timings.totalMs < 1000) return;
  console.warn("Slow connect operation", {
    stage,
    ...ids,
    ...timings,
    ...result,
  });
}
