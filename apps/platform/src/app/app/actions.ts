"use server";
import { clientProfiles } from "@agentcaller/database";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { database } from "@/lib/database";

export async function updateControls(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? ""); const webhookUrl = String(formData.get("webhookUrl") ?? ""); const callsPerMinute = Number(formData.get("callsPerMinute")); const maxConcurrentCalls = Number(formData.get("maxConcurrentCalls"));
  if (!clientId || !Number.isInteger(callsPerMinute) || !Number.isInteger(maxConcurrentCalls)) return;
  if (webhookUrl && !webhookUrl.startsWith("https://")) throw new Error("Webhook URL must be HTTPS");
  await database().update(clientProfiles).set({ webhookUrl: webhookUrl || null, callsPerMinute: Math.min(Math.max(callsPerMinute, 1), 60), maxConcurrentCalls: Math.min(Math.max(maxConcurrentCalls, 1), 20), updatedAt: new Date() }).where(eq(clientProfiles.id, clientId));
  revalidatePath("/app");
}
