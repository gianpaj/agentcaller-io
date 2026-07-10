import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const callState = pgEnum("call_state", ["queued", "dialing", "in_progress", "completed", "failed", "cancelled"]);
export const paymentState = pgEnum("payment_state", ["authorized", "settling", "settled", "failed"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const clientProfiles = pgTable("client_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  githubUserId: text("github_user_id").unique(),
  webhookUrl: text("webhook_url"),
  webhookSecret: text("webhook_secret"),
  callsPerMinute: integer("calls_per_minute").notNull().default(5),
  maxConcurrentCalls: integer("max_concurrent_calls").notNull().default(2),
  allowedVoiceIds: jsonb("allowed_voice_ids").$type<string[]>().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps,
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clientProfiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hash: text("hash").notNull().unique(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
});

export const rateCards = pgTable("rate_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: text("version").notNull().unique(),
  country: text("country").notNull(),
  connectionFeeMicros: integer("connection_fee_micros").notNull(),
  startedMinuteFeeMicros: integer("started_minute_fee_micros").notNull(),
  active: boolean("active").notNull().default(false),
  ...timestamps,
});

export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clientProfiles.id),
  idempotencyKey: text("idempotency_key").notNull(),
  destination: text("destination").notNull(),
  destinationCountry: text("destination_country").notNull(),
  language: text("language").notNull(),
  voiceId: text("voice_id"),
  task: jsonb("task").notNull(),
  maxDurationSeconds: integer("max_duration_seconds").notNull(),
  maxAmountMicros: integer("max_amount_micros").notNull(),
  state: callState("state").notNull().default("queued"),
  paymentState: paymentState("payment_state").notNull().default("authorized"),
  rateCardVersion: text("rate_card_version").notNull(),
  livekitRoom: text("livekit_room"),
  outcome: jsonb("outcome"),
  transcript: jsonb("transcript"),
  recordingKey: text("recording_key"),
  recordingConsent: boolean("recording_consent"),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
});

export const callEvents = pgTable("call_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentSettlements = pgTable("payment_settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
  clientId: uuid("client_id").notNull().references(() => clientProfiles.id),
  payer: text("payer"),
  paymentPayload: jsonb("payment_payload"),
  authorizedMicros: integer("authorized_micros").notNull(),
  settledMicros: integer("settled_micros"),
  transactionHash: text("transaction_hash"),
  status: text("status").notNull(),
  ...timestamps,
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  attempt: integer("attempt").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  lastError: text("last_error"),
  payload: jsonb("payload").notNull(),
  ...timestamps,
});
