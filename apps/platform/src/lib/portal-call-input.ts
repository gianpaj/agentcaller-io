import { createCallSchema } from "@agentcaller/contracts";
import { z } from "zod";
export function portalCallInput(form: FormData) {
  const string = (name: string) => String(form.get(name) ?? "").trim();
  const number = (name: string) => Number(string(name));
  const expiresAt = z
    .string()
    .datetime({ offset: true })
    .parse(string("expiresAt"));
  const waitingSeconds = number("waitingSeconds"),
    handoffSeconds = number("handoffSeconds"),
    conversationSeconds = number("conversationSeconds");
  return createCallSchema.parse({
    destination: string("destination"),
    destinationCountry: string("destinationCountry"),
    language: string("language"),
    clientReference: string("clientReference") || undefined,
    maxAmountUsd: number("maxAmountUsd"),
    maxDurationSeconds: waitingSeconds + handoffSeconds + conversationSeconds,
    task: {
      type: "connect_me",
      callbackNumber: string("callbackNumber"),
      callbackLanguage: string("callbackLanguage"),
      purpose: string("purpose"),
      expiresAt: new Date(expiresAt).toISOString(),
      callingWindow: {
        timezone: string("timezone"),
        weekdays: form.getAll("weekdays").map(Number),
        start: string("start"),
        end: string("end"),
      },
      maxAttempts: number("maxAttempts"),
      retryDelaySeconds: number("retryDelaySeconds"),
      ringingSeconds: number("ringingSeconds"),
      waitingSeconds,
      handoffSeconds,
      callbackRingingSeconds: number("callbackRingingSeconds"),
      acceptanceSeconds: number("acceptanceSeconds"),
      conversationSeconds,
      maxIvrDigits: number("maxIvrDigits"),
    },
  });
}
