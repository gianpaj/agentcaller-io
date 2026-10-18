import { agentConnections, clientProfiles } from "@agentcaller/database";
import {
  agentOperationSchema,
  type AgentPrincipal,
} from "@agentcaller/contracts";
import { and, eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { ApiError } from "./auth";
import { database } from "./database";
import { getMcpConfig, type McpConfig } from "./mcp-config";

let keys: { url: string; resolver: JWTVerifyGetKey } | undefined;
function issuerKeys(config: McpConfig) {
  if (keys?.url !== config.jwksUrl)
    keys = {
      url: config.jwksUrl,
      resolver: createRemoteJWKSet(new URL(config.jwksUrl), {
        timeoutDuration: 5000,
      }),
    };
  return keys.resolver;
}

export async function verifyMcpToken(
  token: string,
  config: McpConfig,
  resolver: JWTVerifyGetKey = issuerKeys(config),
  now = new Date(),
) {
  try {
    const { payload } = await jwtVerify(token, resolver, {
      issuer: config.issuer,
      audience: config.resource,
      algorithms: ["ES256", "RS256"],
      requiredClaims: ["iss", "aud", "sub", "exp", "iat", "client_id"],
      currentDate: now,
    });
    return z
      .object({
        sub: z.uuid(),
        client_id: z.uuid(),
        role: z.literal("authenticated"),
        exp: z.number().int().positive(),
        iat: z
          .number()
          .int()
          .nonnegative()
          .max(Math.floor(now.getTime() / 1000)),
      })
      .parse(payload);
  } catch {
    throw new ApiError(
      401,
      "A valid resource-bound OAuth access token is required",
    );
  }
}

export async function authenticateMcpPrincipal(
  request: Request,
  config = getMcpConfig(),
  db?: ReturnType<typeof database>,
  resolver?: JWTVerifyGetKey,
): Promise<AgentPrincipal> {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer ([^\s]+)$/i);
  if (!match || match[1].length > 16384)
    throw new ApiError(401, "OAuth authentication is required");
  const claims = await verifyMcpToken(match[1], config, resolver);
  const [record] = await (db ?? database())
    .select({ connection: agentConnections })
    .from(agentConnections)
    .innerJoin(clientProfiles, eq(agentConnections.clientId, clientProfiles.id))
    .where(
      and(
        eq(agentConnections.issuer, config.issuer),
        eq(agentConnections.subject, claims.sub),
        eq(agentConnections.oauthClientId, claims.client_id),
        eq(agentConnections.status, "active"),
        eq(clientProfiles.supabaseUserId, claims.sub),
        eq(clientProfiles.enabled, true),
      ),
    )
    .limit(1);
  const connection = record?.connection;
  if (
    !connection?.consentedAt ||
    connection.revokedAt ||
    claims.iat < Math.floor(connection.consentedAt.getTime() / 1000)
  )
    throw new ApiError(
      403,
      "This integration has no active tool-access consent",
    );
  return {
    clientId: connection.clientId,
    connectionId: connection.id,
    credentialId: claims.client_id,
    credentialKind: "oauth",
    operations: z.array(agentOperationSchema).parse(connection.operations),
  };
}
