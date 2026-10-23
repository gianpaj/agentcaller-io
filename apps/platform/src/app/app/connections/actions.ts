"use server";

import { revalidatePath } from "next/cache";
import { findClientProfileForUser, requireHumanSession } from "@/lib/portal";
import { revokeAgentConnection } from "@/lib/oauth-consent";

export async function disconnectAgent(form: FormData) {
  const { user, supabase } = await requireHumanSession();
  const connectionId = form.get("connection_id");
  if (typeof connectionId !== "string")
    throw new Error("Choose an integration");
  // No profile means no connections; disconnecting must never provision one.
  const profile = await findClientProfileForUser(user.id);
  if (!profile) return;
  // The database row is authoritative: /mcp denies the connection from here on.
  const connection = await revokeAgentConnection(profile.id, connectionId);
  revalidatePath("/app/connections");
  if (!connection) return;
  // Also drop issuer consent and refresh tokens so the host cannot be silently re-approved.
  const { error } = await supabase.auth.oauth.revokeGrant({
    clientId: connection.oauthClientId,
  });
  if (error)
    throw new Error(
      "Integration disconnected. Its sign-in could not be revoked at the issuer, but it can no longer use AgentCaller tools.",
    );
}
