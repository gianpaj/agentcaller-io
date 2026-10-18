import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const callState = pgEnum("call_state", [
  "queued",
  "dialing",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
]);
export const paymentState = pgEnum("payment_state", [
  "not_required",
  "authorized",
  "settling",
  "settled",
  "failed",
  "accruing",
  "accrued",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const clientProfiles = pgTable(
  "client_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    isOperator: boolean("is_operator").notNull().default(false),
    supabaseUserId: uuid("supabase_user_id").unique(),
    githubUserId: text("github_user_id").unique(),
    webhookUrl: text("webhook_url"),
    webhookSecret: text("webhook_secret"),
    callsPerMinute: integer("calls_per_minute").notNull().default(5),
    maxConcurrentCalls: integer("max_concurrent_calls").notNull().default(2),
    allowedVoiceIds: jsonb("allowed_voice_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("client_profiles_id_owner_key").on(table.id, table.supabaseUserId),
  ],
);

export const agentConnections = pgTable(
  "agent_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clientProfiles.id),
    name: text("name").notNull(),
    issuer: text("issuer").notNull(),
    subject: uuid("subject").notNull(),
    oauthClientId: text("oauth_client_id").notNull(),
    operations: jsonb("operations").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("pending"),
    consentVersion: text("consent_version"),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    consentedBy: uuid("consented_by"),
    version: integer("version").notNull().default(1),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("agent_connections_identity_key").on(
      table.issuer,
      table.subject,
      table.oauthClientId,
    ),
    unique("agent_connections_id_client_key").on(table.id, table.clientId),
    foreignKey({
      name: "agent_connections_owner_fk",
      columns: [table.clientId, table.subject],
      foreignColumns: [clientProfiles.id, clientProfiles.supabaseUserId],
    }),
    check(
      "agent_connections_status_check",
      sql`${table.status} in ('pending','active','revoked')`,
    ),
    check("agent_connections_version_check", sql`${table.version} > 0`),
    check(
      "agent_connections_operations_check",
      sql`jsonb_typeof(${table.operations}) = 'array' and ${table.operations} <@ '["calls:read","calls:create","billing:setup","billing:read"]'::jsonb`,
    ),
    check(
      "agent_connections_consent_check",
      sql`${table.status} <> 'active' or (${table.consentedBy} = ${table.subject} and ${table.consentedBy} is not null and ${table.consentedAt} is not null and ${table.consentVersion} is not null and ${table.revokedAt} is null)`,
    ),
    check(
      "agent_connections_revocation_check",
      sql`(${table.status} = 'revoked') = (${table.revokedAt} is not null)`,
    ),
    index("agent_connections_client_status_index").on(
      table.clientId,
      table.status,
    ),
  ],
).enableRLS();

export const stripeEvents = pgTable(
  "stripe_events",
  {
    livemode: boolean("livemode").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    objectId: text("object_id").notNull(),
    apiVersion: text("api_version").notNull(),
    status: text("status").notNull().default("pending"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => [
    primaryKey({
      name: "stripe_events_environment_event_key",
      columns: [table.livemode, table.eventId],
    }),
    check(
      "stripe_events_status_check",
      sql`${table.status} in ('pending','processing','processed','failed')`,
    ),
    check("stripe_events_attempts_check", sql`${table.attempts} >= 0`),
    index("stripe_events_pending_index")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} in ('pending','failed')`),
  ],
).enableRLS();

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clientProfiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hash: text("hash").notNull().unique(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
});

export const rateCards = pgTable(
  "rate_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: text("version").notNull().unique(),
    country: text("country").notNull(),
    connectionFeeMicros: integer("connection_fee_micros").notNull(),
    startedMinuteFeeMicros: integer("started_minute_fee_micros").notNull(),
    active: boolean("active").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("one_active_rate_card_per_country")
      .on(table.country)
      .where(sql`${table.active}`),
    check(
      "rate_cards_country_check",
      sql`${table.country} in ('ES','US','IT')`,
    ),
  ],
);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clientProfiles.id),
    idempotencyKey: text("idempotency_key").notNull(),
    fundingSource: text("funding_source").notNull().default("x402"),
    operatorAuthorizedBy: uuid("operator_authorized_by").references(
      () => clientProfiles.id,
    ),
    destination: text("destination").notNull(),
    destinationCountry: text("destination_country").notNull(),
    language: text("language").notNull(),
    voiceId: text("voice_id"),
    clientReference: text("client_reference"),
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
  },
  (table) => [
    check(
      "calls_destination_country_check",
      sql`${table.destinationCountry} in ('ES','US','IT')`,
    ),
    check("calls_language_check", sql`${table.language} in ('en','es','it')`),
    check(
      "connect_only_italian",
      sql`(${table.destinationCountry} <> 'IT' and ${table.language} <> 'it') or ${table.task}->>'type' = 'connect_me'`,
    ),
    check(
      "connect_no_recording",
      sql`${table.task}->>'type' <> 'connect_me' or (${table.recordingKey} is null and ${table.recordingConsent} is not true)`,
    ),
    check(
      "calls_funding_source_check",
      sql`${table.fundingSource} in ('x402','operator')`,
    ),
    check(
      "calls_operator_authorization_check",
      sql`(${table.fundingSource} = 'operator' and ${table.operatorAuthorizedBy} = ${table.clientId} and ${table.operatorAuthorizedBy} is not null and ${table.paymentState} = 'not_required' and coalesce(${table.task}->>'type', '') = 'connect_me') or (${table.fundingSource} = 'x402' and ${table.operatorAuthorizedBy} is null and ${table.paymentState} <> 'not_required')`,
    ),
    unique("calls_client_idempotency_key").on(
      table.clientId,
      table.idempotencyKey,
    ),
    index("calls_client_created_index").on(
      table.clientId,
      table.createdAt.desc(),
    ),
  ],
);

export const callEvents = pgTable(
  "call_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("call_events_call_index").on(table.callId)],
);

export const paymentSettlements = pgTable(
  "payment_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id").references(() => calls.id, {
      onDelete: "set null",
    }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clientProfiles.id),
    payer: text("payer"),
    paymentPayload: jsonb("payment_payload"),
    authorizedMicros: integer("authorized_micros").notNull(),
    settledMicros: integer("settled_micros"),
    transactionHash: text("transaction_hash"),
    status: text("status").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("payment_settlements_call_index")
      .on(table.callId)
      .where(sql`${table.callId} is not null`),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    attempt: integer("attempt").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    payload: jsonb("payload").notNull(),
    ...timestamps,
  },
  (table) => [
    index("webhook_deliveries_pending_index")
      .on(table.nextAttemptAt, table.createdAt)
      .where(sql`${table.deliveredAt} is null`),
    index("webhook_deliveries_call_index").on(table.callId),
  ],
);

// One call and authorization span all bounded attempts.
export const connectJobs = pgTable(
  "connect_jobs",
  {
    callId: uuid("call_id")
      .primaryKey()
      .references(() => calls.id, { onDelete: "cascade" }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attemptCount: integer("attempt_count").notNull().default(0),
    reservedMicros: integer("reserved_micros").notNull().default(0),
    businessRate: jsonb("business_rate")
      .$type<{ connectionFeeMicros: number; startedMinuteFeeMicros: number }>()
      .notNull(),
    callbackRate: jsonb("callback_rate")
      .$type<{ connectionFeeMicros: number; startedMinuteFeeMicros: number }>()
      .notNull(),
    ...timestamps,
  },
  (t) => [
    check(
      "connect_jobs_attempt_count_check",
      sql`${t.attemptCount} between 0 and 6`,
    ),
    check("connect_jobs_reserved_micros_check", sql`${t.reservedMicros} >= 0`),
  ],
).enableRLS();
export const callAttempts = pgTable(
  "call_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id")
      .notNull()
      .references(() => connectJobs.callId, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    state: text("state").notNull().default("dispatched"),
    workerId: uuid("worker_id"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    businessRoom: text("business_room").notNull().unique(),
    callbackRoom: text("callback_room").notNull().unique(),
    reason: text("reason"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    cleanupUntil: timestamp("cleanup_until", { withTimezone: true }).notNull(),
    roomsCleanedAt: timestamp("rooms_cleaned_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("call_attempts_ordinal_check", sql`${t.ordinal} between 1 and 6`),
    check(
      "call_attempts_state_check",
      sql`${t.state} in ('dispatched','running','human','accepted','bridged','terminal')`,
    ),
    unique("attempt_ordinal").on(t.callId, t.ordinal),
    uniqueIndex("one_active_attempt")
      .on(t.callId)
      .where(sql`${t.endedAt} is null`),
    index("call_attempts_pending_cleanup")
      .on(t.updatedAt)
      .where(sql`${t.endedAt} is not null and ${t.roomsCleanedAt} is null`),
  ],
).enableRLS();
export const callLegs = pgTable(
  "call_legs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => callAttempts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    identity: text("identity").notNull().unique(),
    sipCallId: text("sip_call_id"),
    state: text("state").notNull().default("intent"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // Application-observed SIP timing, not a provider invoice. Missing timing stays null.
    measuredMicros: integer("measured_micros"),
    ...timestamps,
  },
  (t) => [
    unique("attempt_leg").on(t.attemptId, t.kind),
    check("call_legs_kind_check", sql`${t.kind} in ('business','callback')`),
    check(
      "call_legs_state_check",
      sql`${t.state} in ('intent','connected','ended')`,
    ),
  ],
).enableRLS();
export const connectReceipts = pgTable("connect_receipts", {
  eventId: uuid("event_id").primaryKey(),
  attemptId: uuid("attempt_id")
    .notNull()
    .references(() => callAttempts.id, { onDelete: "cascade" }),
  response: jsonb("response").notNull(),
}).enableRLS();
