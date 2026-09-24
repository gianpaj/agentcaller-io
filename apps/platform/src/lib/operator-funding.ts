import { z } from "zod";
import { createCallSchema, type CreateCallInput } from "@agentcaller/contracts";
import { calls, clientProfiles } from "@agentcaller/database";
import { and, eq } from "drizzle-orm";
import { ApiError } from "./auth";
import { database } from "./database";

const config = z.object({
  CONNECT_OPERATOR_CALLS_ENABLED: z.enum(["true", "false"]).default("false"),
  CONNECT_OPERATOR_DESTINATIONS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^\+[1-9]\d{7,14}$/))),
  CONNECT_OPERATOR_MAX_USD: z.coerce.number().positive().max(500).default(5),
});

/** The role is server-managed; caller headers only select funding, never grant a role. */
export function authorizeOperatorInput(
  client: { isOperator?: boolean; enabled?: boolean },
  input: CreateCallInput,
  env: Record<string, string | undefined> = process.env,
) {
  if (!client.isOperator || client.enabled === false)
    throw new ApiError(
      403,
      "Operator funding requires an enabled operator profile",
    );
  const settings = config.safeParse(env);
  if (
    !settings.success ||
    settings.data.CONNECT_OPERATOR_CALLS_ENABLED !== "true"
  )
    throw new ApiError(
      503,
      "Operator-funded calling is disabled or misconfigured",
    );
  if (input.task.type !== "connect_me")
    throw new ApiError(422, "Operator funding supports connect_me only");
  const allowed = settings.data.CONNECT_OPERATOR_DESTINATIONS;
  if (
    !allowed.includes(input.destination) ||
    !allowed.includes(input.task.callbackNumber)
  )
    throw new ApiError(
      403,
      "Both destinations must be explicitly allowlisted for operator calls",
    );
  if (input.maxAmountUsd > settings.data.CONNECT_OPERATOR_MAX_USD)
    throw new ApiError(422, "Requested spend exceeds the operator job cap");
}

export async function authorizeOperatorCall(callId: string) {
  const [row] = await database()
    .select({ call: calls, client: clientProfiles })
    .from(calls)
    .innerJoin(clientProfiles, eq(calls.clientId, clientProfiles.id))
    .where(and(eq(calls.id, callId), eq(calls.fundingSource, "operator")))
    .limit(1);
  if (
    !row ||
    row.call.operatorAuthorizedBy !== row.client.id ||
    row.call.paymentState !== "not_required" ||
    row.call.endedAt
  )
    throw new ApiError(403, "No active operator authorization for this job");
  authorizeOperatorInput(
    row.client,
    createCallSchema.parse({
      ...row.call,
      voiceId: row.call.voiceId ?? undefined,
      clientReference: row.call.clientReference ?? undefined,
      maxAmountUsd: row.call.maxAmountMicros / 1e6,
    }),
  );
}
