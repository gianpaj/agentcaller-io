import { calls, clientProfiles, webhookDeliveries } from "@agentcaller/database";
import { eq, inArray, sql } from "drizzle-orm";
import { createHmac, randomBytes } from "node:crypto";
import { database } from "./database";
import { assertPublicWebhookUrl } from "./webhook-url";

const BATCH_SIZE = 25;
const DELIVERY_CONCURRENCY = 6;
const DELIVERY_TIMEOUT_MS = 10_000;
/** After this many failures a delivery is left in place as a dead letter rather than retried forever. */
const MAX_ATTEMPTS = 10;
/** How long a claimed row is hidden from other drain runs while we attempt delivery. */
const CLAIM_LEASE_MINUTES = 5;

export function generateWebhookSecret() {
  return randomBytes(32).toString("hex");
}

export async function queueWebhook(callId: string, eventType: string, payload: Record<string, unknown>) {
  await database().insert(webhookDeliveries).values({ callId, eventType, payload });
}

export function webhookSignature(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

type ClaimedDelivery = {
  id: string;
  call_id: string;
  event_type: string;
  attempt: number;
  payload: Record<string, unknown>;
};

/**
 * Atomically claims a batch: oldest-due first, skipping rows another drain run already holds.
 * The lease bump means a crashed run's rows return automatically instead of being lost.
 */
async function claimBatch() {
  const claimed = await database().execute(sql`
    with due as (
      select id from webhook_deliveries
      where delivered_at is null
        and attempt < ${MAX_ATTEMPTS}
        and (next_attempt_at is null or next_attempt_at <= now())
      order by next_attempt_at nulls first, created_at
      limit ${BATCH_SIZE}
      for update skip locked
    )
    update webhook_deliveries d
    set next_attempt_at = now() + make_interval(mins => ${CLAIM_LEASE_MINUTES}), updated_at = now()
    from due
    where d.id = due.id
    returning d.id, d.call_id, d.event_type, d.attempt, d.payload
  `);
  return (claimed.rows ?? []) as ClaimedDelivery[];
}

async function markDelivered(id: string, attempt: number) {
  const now = new Date();
  await database().update(webhookDeliveries)
    .set({ attempt, deliveredAt: now, nextAttemptAt: null, updatedAt: now, lastError: null })
    .where(eq(webhookDeliveries.id, id));
}

async function markFailed(id: string, attempt: number, error: unknown) {
  const now = new Date();
  const delayMinutes = Math.min(2 ** attempt, 60);
  await database().update(webhookDeliveries)
    .set({
      attempt,
      nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000),
      updatedAt: now,
      lastError: error instanceof Error ? error.message : "Webhook failed",
    })
    .where(eq(webhookDeliveries.id, id));
}

type Endpoint = { webhookUrl: string | null; webhookSecret: string | null };

/** One query for the whole batch: several deliveries usually share a call, and many share a client. */
async function endpointsForBatch(batch: ClaimedDelivery[]) {
  const callIds = [...new Set(batch.map((item) => item.call_id))];
  if (!callIds.length) return new Map<string, Endpoint>();
  const rows = await database()
    .select({ callId: calls.id, webhookUrl: clientProfiles.webhookUrl, webhookSecret: clientProfiles.webhookSecret })
    .from(calls)
    .innerJoin(clientProfiles, eq(calls.clientId, clientProfiles.id))
    .where(inArray(calls.id, callIds));
  return new Map(rows.map((row) => [row.callId, { webhookUrl: row.webhookUrl, webhookSecret: row.webhookSecret }]));
}

async function deliver(item: ClaimedDelivery, endpoint: Endpoint | undefined) {
  const attempt = item.attempt + 1;

  // No endpoint configured, or the call is gone: nothing to deliver, so retire the row.
  if (!endpoint?.webhookUrl || !endpoint.webhookSecret) {
    await markDelivered(item.id, attempt);
    return false;
  }

  const timestamp = new Date().toISOString();
  const body = JSON.stringify({ id: item.id, timestamp, type: item.event_type, data: item.payload });
  const signature = webhookSignature(endpoint.webhookSecret, timestamp, body);

  try {
    const url = await assertPublicWebhookUrl(endpoint.webhookUrl);
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "AgentCaller-Event": item.id,
        "AgentCaller-Timestamp": timestamp,
        "AgentCaller-Signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Webhook responded ${response.status}`);
    await markDelivered(item.id, attempt);
    return true;
  } catch (error) {
    await markFailed(item.id, attempt, error);
    return false;
  }
}

export async function deliverPendingWebhooks() {
  const batch = await claimBatch();
  const endpoints = await endpointsForBatch(batch);
  let delivered = 0;
  const queue = [...batch];
  const workers = Array.from({ length: Math.min(DELIVERY_CONCURRENCY, queue.length) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      if (await deliver(item, endpoints.get(item.call_id))) delivered += 1;
    }
  });
  await Promise.all(workers);
  return { claimed: batch.length, delivered };
}
