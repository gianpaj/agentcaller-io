"use server";
import { clientProfiles } from "@agentcaller/database";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { database } from "@/lib/database";
import { assertPublicWebhookUrl } from "@/lib/webhook-url";
import { requireClientProfile } from "@/lib/portal";

function boundedInteger(value: FormDataEntryValue | null, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return undefined;
  return Math.min(Math.max(parsed, min), max);
}

export async function updateControls(formData: FormData) {
  // Server actions are public endpoints. The profile must come from the session, never from the
  // submitted form, or any signed-in user can rewrite any tenant's webhook and limits.
  const profile = await requireClientProfile();

  const webhookUrl = String(formData.get("webhookUrl") ?? "").trim();
  const callsPerMinute = boundedInteger(formData.get("callsPerMinute"), 1, 60);
  const maxConcurrentCalls = boundedInteger(formData.get("maxConcurrentCalls"), 1, 20);
  if (callsPerMinute === undefined || maxConcurrentCalls === undefined) throw new Error("Throttle values must be whole numbers");
  if (webhookUrl) await assertPublicWebhookUrl(webhookUrl);

  await database().update(clientProfiles)
    .set({ webhookUrl: webhookUrl || null, callsPerMinute, maxConcurrentCalls, updatedAt: new Date() })
    .where(eq(clientProfiles.id, profile.id));
  revalidatePath("/app");
}
