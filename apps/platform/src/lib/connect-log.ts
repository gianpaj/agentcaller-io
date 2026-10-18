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
