import { calls, clientProfiles, webhookDeliveries } from "@agentcaller/database";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { createHmac, randomUUID } from "node:crypto";
import { database } from "./database";
import { getServerEnv } from "./env";

export async function queueWebhook(callId: string, eventType: string, payload: Record<string, unknown>) {
  await database().insert(webhookDeliveries).values({ callId, eventType, payload });
}

export function signWebhook(payload: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const eventId = randomUUID();
  const body = JSON.stringify({ id: eventId, timestamp, ...payload });
  const signature = createHmac("sha256", getServerEnv().WEBHOOK_SIGNING_SECRET).update(`${timestamp}.${body}`).digest("hex");
  return { body, eventId, timestamp, signature };
}

export async function deliverPendingWebhooks() {
  const now = new Date();
  const pending = await database().select({ delivery: webhookDeliveries, call: calls, client: clientProfiles })
    .from(webhookDeliveries)
    .innerJoin(calls, eq(webhookDeliveries.callId, calls.id))
    .innerJoin(clientProfiles, eq(calls.clientId, clientProfiles.id))
    .where(and(or(isNull(webhookDeliveries.nextAttemptAt), lte(webhookDeliveries.nextAttemptAt, now)), isNull(webhookDeliveries.deliveredAt)))
    .limit(25);
  for (const item of pending) {
    const attempt = item.delivery.attempt + 1;
    if (!item.client.webhookUrl) {
      await database().update(webhookDeliveries).set({ deliveredAt: now, attempt, updatedAt: now }).where(eq(webhookDeliveries.id, item.delivery.id));
      continue;
    }
    const timestamp = now.toISOString();
    const payload = { id: item.delivery.id, timestamp, type: item.delivery.eventType, data: item.delivery.payload };
    const body = JSON.stringify(payload);
    const secret = item.client.webhookSecret || getServerEnv().WEBHOOK_SIGNING_SECRET;
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    try {
      const response = await fetch(item.client.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", "AgentCaller-Event": item.delivery.id, "AgentCaller-Timestamp": timestamp, "AgentCaller-Signature": `sha256=${signature}` }, body, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Webhook responded ${response.status}`);
      await database().update(webhookDeliveries).set({ attempt, deliveredAt: now, updatedAt: now, lastError: null }).where(eq(webhookDeliveries.id, item.delivery.id));
    } catch (error) {
      const delayMinutes = Math.min(2 ** attempt, 60);
      await database().update(webhookDeliveries).set({ attempt, nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000), updatedAt: now, lastError: error instanceof Error ? error.message : "Webhook failed" }).where(eq(webhookDeliveries.id, item.delivery.id));
    }
  }
  return pending.length;
}
