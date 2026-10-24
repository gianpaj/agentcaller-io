import { agentConnections, clientProfiles } from "@agentcaller/database";
import {
  agentOperations,
  oauthConsentVersion,
  authorizationIdSchema,
} from "@agentcaller/contracts";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "./auth";
import { database } from "./database";

export const oauthAuthorizationSchema = z.object({
  authorization_id: authorizationIdSchema,
  redirect_uri: z.url(),
  client: z.object({ id: z.uuid(), name: z.string().min(1).max(200) }),
  user: z.object({ id: z.uuid() }),
  scope: z.string().max(1000),
});

/** Only call for responses retrieved directly from the trusted issuer API. */
export function issuerRedirect(value: string, registeredRedirect?: string) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new ApiError(400, "Unsupported OAuth redirect");
  if (registeredRedirect) {
    const expected = new URL(registeredRedirect);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname)
      throw new ApiError(
        400,
        "OAuth redirect does not match the registered client",
      );
  }
  return url.href;
}

export function verifyOAuthAuthorization(
  value: unknown,
  userId: string,
  authorizationId: string,
) {
  const details = oauthAuthorizationSchema.parse(value);
  if (
    details.user.id !== userId ||
    details.authorization_id !== authorizationId
  )
    throw new ApiError(
      403,
      "OAuth authorization does not belong to this session",
    );
  issuerRedirect(details.redirect_uri);
  return details;
}

export async function approveAgentConnection(
  clientId: string,
  userId: string,
  issuer: string,
  details: z.infer<typeof oauthAuthorizationSchema>,
  db = database(),
  now = new Date(),
) {
  if (details.user.id !== userId)
    throw new ApiError(403, "OAuth owner mismatch");
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select()
      .from(clientProfiles)
      .where(
        and(
          eq(clientProfiles.id, clientId),
          eq(clientProfiles.supabaseUserId, userId),
        ),
      )
      .for("update");
    if (!owner?.enabled) throw new ApiError(403, "This account is unavailable");
    await tx
      .insert(agentConnections)
      .values({
        clientId,
        subject: userId,
        issuer,
        oauthClientId: details.client.id,
        name: details.client.name,
        operations: [...agentOperations],
        status: "active",
        consentVersion: oauthConsentVersion,
        consentedBy: userId,
        consentedAt: now,
      })
      .onConflictDoNothing({
        target: [
          agentConnections.issuer,
          agentConnections.subject,
          agentConnections.oauthClientId,
        ],
      });
    const [connection] = await tx
      .select()
      .from(agentConnections)
      .where(
        and(
          eq(agentConnections.issuer, issuer),
          eq(agentConnections.subject, userId),
          eq(agentConnections.oauthClientId, details.client.id),
        ),
      )
      .for("update");
    if (
      !connection ||
      connection.clientId !== clientId ||
      connection.status !== "active"
    )
      throw new ApiError(403, "This integration is revoked or unavailable");
    return connection;
  });
}

export async function revokeAgentConnection(
  clientId: string,
  connectionId: string,
  db = database(),
  now = new Date(),
) {
  const { revokeBillingAccess } = await import("./billing-controls");
  return revokeBillingAccess(clientId, connectionId, true, db, now);
}
