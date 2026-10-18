import { clientProfiles } from "@agentcaller/database";
import { eq } from "drizzle-orm";
import { database } from "@/lib/database";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateWebhookSecret } from "@/lib/webhooks";
import { ApiError } from "@/lib/auth";
import { z } from "zod";

/** Call only with the UID returned by verified human authentication. */
export async function ensureClientProfileForUser(
  userId: string,
  db = database(),
) {
  const uid = z.uuid().parse(userId);
  await db
    .insert(clientProfiles)
    .values({
      supabaseUserId: uid,
      name: "AgentCaller customer",
      isOperator: false,
      webhookSecret: generateWebhookSecret(),
    })
    .onConflictDoNothing({ target: clientProfiles.supabaseUserId });
  const [profile] = await db
    .select()
    .from(clientProfiles)
    .where(eq(clientProfiles.supabaseUserId, uid))
    .limit(1);
  if (!profile?.enabled) throw new ApiError(403, "This account is unavailable");
  return profile;
}

export async function requireHumanSession() {
  const supabase = await createSupabaseServerClient();
  const [
    {
      data: { user },
      error,
    },
    { data: claimsData, error: claimsError },
  ] = await Promise.all([supabase.auth.getUser(), supabase.auth.getClaims()]);
  if (error || claimsError || !user || claimsData?.claims.sub !== user.id)
    throw new ApiError(401, "Sign in to continue");
  if (claimsData.claims.client_id || user.is_anonymous)
    throw new ApiError(403, "A human sign-in is required");
  return { user, supabase };
}

/**
 * Resolves the signed-in developer's client profile.
 *
 * Identity is the Supabase auth uid, which comes from the verified JWT `sub`. It is deliberately
 * not `user_metadata.user_name`: users can rewrite their own `user_metadata` via
 * `auth.updateUser()`, so a profile keyed on it can be claimed by anyone.
 */
export async function loadClientProfile() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null };
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  if (
    claimsError ||
    claimsData?.claims.sub !== user.id ||
    claimsData.claims.client_id ||
    user.is_anonymous
  )
    return { user, profile: null };

  const [profile] = await database()
    .select()
    .from(clientProfiles)
    .where(eq(clientProfiles.supabaseUserId, user.id))
    .limit(1);
  if (!profile || !profile.enabled) return { user, profile: null };

  // Clients need a secret of their own to verify signatures; a platform-wide secret would let any
  // client forge events for every other client.
  if (!profile.webhookSecret) {
    const [updated] = await database()
      .update(clientProfiles)
      .set({ webhookSecret: generateWebhookSecret(), updatedAt: new Date() })
      .where(eq(clientProfiles.id, profile.id))
      .returning();
    return { user, profile: updated ?? profile };
  }
  return { user, profile };
}

export async function requireClientProfile() {
  const { user, profile } = await loadClientProfile();
  if (!user) throw new Error("Not authenticated");
  if (!profile) throw new Error("No client profile is linked to this account");
  return profile;
}
