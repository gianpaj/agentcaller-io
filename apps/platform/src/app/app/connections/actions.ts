"use server";

import { revalidatePath } from "next/cache";
import { findClientProfileForUser, requireHumanSession } from "@/lib/portal";
import { revokeAgentConnection } from "@/lib/oauth-consent";

export async function disconnectAgent(form: FormData) {
  const { user } = await requireHumanSession();
  const connectionId = form.get("connection_id");
  if (typeof connectionId !== "string")
    throw new Error("Choose an integration");
  // No profile means no connections; disconnecting must never provision one.
  const profile = await findClientProfileForUser(user.id);
  if (!profile) return;
  await revokeAgentConnection(profile.id, connectionId);
  revalidatePath("/app/connections");
}
