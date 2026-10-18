"use server";

import { revalidatePath } from "next/cache";
import { ensureClientProfileForUser, requireHumanSession } from "@/lib/portal";
import { revokeAgentConnection } from "@/lib/oauth-consent";

export async function disconnectAgent(form: FormData) {
  const { user } = await requireHumanSession();
  const profile = await ensureClientProfileForUser(user.id);
  const connectionId = form.get("connection_id");
  if (typeof connectionId !== "string")
    throw new Error("Choose an integration");
  await revokeAgentConnection(profile.id, connectionId);
  revalidatePath("/app/connections");
}
