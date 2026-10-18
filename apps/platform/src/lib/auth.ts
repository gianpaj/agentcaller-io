import { apiKeys, clientProfiles } from "@agentcaller/database";
import { and, eq, isNull } from "drizzle-orm";
import { createHash, timingSafeEqual } from "node:crypto";
import { database } from "./database";
import { getApiAuthEnv } from "./env";
import { agentOperations, type AgentPrincipal } from "@agentcaller/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function digest(value: string) {
  return createHash("sha256")
    .update(`${getApiAuthEnv().API_KEY_PEPPER}:${value}`)
    .digest("hex");
}

/** Compares two secrets without leaking their contents through response timing. */
export function timingSafeCompare(
  candidate: string | null | undefined,
  expected: string,
) {
  if (!candidate) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

async function authenticateApiCredential(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!token?.startsWith("ac_"))
    throw new ApiError(401, "A valid AgentCaller API key is required");
  const hash = digest(token);
  const [record] = await database()
    .select({ client: clientProfiles, key: apiKeys })
    .from(apiKeys)
    .innerJoin(clientProfiles, eq(apiKeys.clientId, clientProfiles.id))
    .where(
      and(
        eq(apiKeys.hash, hash),
        isNull(apiKeys.revokedAt),
        eq(clientProfiles.enabled, true),
      ),
    )
    .limit(1);
  if (!record)
    throw new ApiError(401, "API key is unknown, revoked, or disabled");
  return record;
}

export async function authenticateApiRequest(request: Request) {
  return (await authenticateApiCredential(request)).client;
}

/** Legacy keys retain their API access and have no implicit spending grant. */
export async function authenticateApiPrincipal(
  request: Request,
): Promise<AgentPrincipal> {
  const { client, key } = await authenticateApiCredential(request);
  return {
    clientId: client.id,
    connectionId: null,
    credentialId: key.id,
    credentialKind: "api_key",
    operations: [...agentOperations],
  };
}
