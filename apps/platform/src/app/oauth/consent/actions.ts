"use server";

import { redirect } from "next/navigation";
import { authorizationIdSchema } from "@agentcaller/contracts";
import { ensureClientProfileForUser, requireHumanSession } from "@/lib/portal";
import { getMcpConfig, isMcpEnabled } from "@/lib/mcp-config";
import {
  approveAgentConnection,
  issuerRedirect,
  verifyOAuthAuthorization,
} from "@/lib/oauth-consent";

export async function decideOAuthConsent(form: FormData) {
  if (!isMcpEnabled()) throw new Error("Agent connections are unavailable");
  const authorizationId = authorizationIdSchema.parse(
    form.get("authorization_id"),
  );
  const { user, supabase } = await requireHumanSession();
  const { data, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data)
    throw new Error("This authorization request is unavailable");
  if ("redirect_url" in data) redirect(issuerRedirect(data.redirect_url));
  const details = verifyOAuthAuthorization(data, user.id, authorizationId);
  let result;
  if (form.get("decision") === "approve" && form.get("consent") === "yes") {
    const profile = await ensureClientProfileForUser(user.id);
    await approveAgentConnection(
      profile.id,
      user.id,
      getMcpConfig().issuer,
      details,
    );
    result = await supabase.auth.oauth.approveAuthorization(authorizationId, {
      skipBrowserRedirect: true,
    });
  } else {
    result = await supabase.auth.oauth.denyAuthorization(authorizationId, {
      skipBrowserRedirect: true,
    });
  }
  if (result.error || !result.data)
    throw new Error(
      "Unable to complete authorization. Reconnect from your agent.",
    );
  redirect(issuerRedirect(result.data.redirect_url, details.redirect_uri));
}
