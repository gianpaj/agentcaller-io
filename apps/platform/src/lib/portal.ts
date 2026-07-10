import { clientProfiles } from "@agentcaller/database";
import { eq } from "drizzle-orm";
import { database } from "@/lib/database";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateWebhookSecret } from "@/lib/webhooks";

/**
 * Resolves the signed-in developer's client profile.
 *
 * Identity is the Supabase auth uid, which comes from the verified JWT `sub`. It is deliberately
 * not `user_metadata.user_name`: users can rewrite their own `user_metadata` via
 * `auth.updateUser()`, so a profile keyed on it can be claimed by anyone.
 */
export async function loadClientProfile() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null };

  const [profile] = await database().select().from(clientProfiles).where(eq(clientProfiles.supabaseUserId, user.id)).limit(1);
  if (!profile) return { user, profile: null };

  // Clients need a secret of their own to verify signatures; a platform-wide secret would let any
  // client forge events for every other client.
  if (!profile.webhookSecret) {
    const [updated] = await database().update(clientProfiles)
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
