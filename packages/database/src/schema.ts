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

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clientProfiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    connectionId: uuid("connection_id"),
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull().unique(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "api_keys_connection_owner_fk",
      columns: [t.connectionId, t.clientId],
      foreignColumns: [agentConnections.id, agentConnections.clientId],
    }),
    index("api_keys_connection_index").on(t.connectionId),
  ],
);

export const rateCards = pgTable(
  "rate_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: text("version").notNull().unique(),
    country: text("country").notNull(),
    connectionFeeMicros: integer("connection_fee_micros").notNull(),
    startedMinuteFeeMicros: integer("started_minute_fee_micros").notNull(),
    active: boolean("active").notNull().default(false),
    currency: text("currency"),
    stripePricingVersion: text("stripe_pricing_version"),
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
    check(
      "rate_cards_stripe_currency_check",
      sql`(${table.currency} is null and ${table.stripePricingVersion} is null) or (${table.currency} = 'USD' and ${table.stripePricingVersion} is not null)`,
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
    stripeBillingAccountId: uuid("stripe_billing_account_id"),
    billingAuthorizationId: uuid("billing_authorization_id"),
    requestFingerprint: text("request_fingerprint"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
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
      sql`${table.fundingSource} in ('x402','operator','stripe_postpaid')`,
    ),
    check(
      "calls_operator_authorization_check",
      sql`(${table.fundingSource} = 'operator' and ${table.operatorAuthorizedBy} = ${table.clientId} and ${table.operatorAuthorizedBy} is not null and ${table.paymentState} = 'not_required' and coalesce(${table.task}->>'type', '') = 'connect_me' and ${table.stripeBillingAccountId} is null and ${table.billingAuthorizationId} is null) or (${table.fundingSource} = 'x402' and ${table.operatorAuthorizedBy} is null and ${table.paymentState} in ('authorized','settling','settled','failed') and ${table.stripeBillingAccountId} is null and ${table.billingAuthorizationId} is null) or (${table.fundingSource} = 'stripe_postpaid' and ${table.operatorAuthorizedBy} is null and ${table.stripeBillingAccountId} is not null and ${table.billingAuthorizationId} is not null and ${table.requestFingerprint} is not null and ${table.paymentState} in ('accruing','accrued') and ${table.task}->>'type' = 'connect_me')`,
    ),
    unique("calls_id_client_key").on(table.id, table.clientId),
    foreignKey({
      name: "calls_billing_account_owner_fk",
      columns: [table.stripeBillingAccountId, table.clientId],
      foreignColumns: [billingAccounts.id, billingAccounts.clientId],
    }),
    foreignKey({
      name: "calls_billing_grant_owner_fk",
      columns: [
        table.billingAuthorizationId,
        table.stripeBillingAccountId,
        table.clientId,
      ],
      foreignColumns: [
        billingAuthorizations.id,
        billingAuthorizations.billingAccountId,
        billingAuthorizations.clientId,
      ],
    }),
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

// Billing authority and financial history are server-only.
export type BillingRate = {
  currency: "USD";
  pricingVersion: string;
  connectionFeeMicros: number;
  startedMinuteFeeMicros: number;
};
export const billingAccounts = pgTable(
  "billing_accounts",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    clientId: uuid("client_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    stripeCustomerId: text("stripe_customer_id"),
    livemode: boolean("livemode").notNull().default(false),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("pending_setup"),
    blockReason: text("block_reason"),
    monthlyLimitCents: integer("monthly_limit_cents").notNull().default(0),
    perCallLimitCents: integer("per_call_limit_cents").notNull().default(0),
    creditLimitCents: integer("credit_limit_cents").notNull().default(1000),
    collectionConsent: boolean("collection_consent").notNull().default(false),
    consentVersion: text("consent_version"),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    consentedBy: uuid("consented_by"),
    pricingVersion: text("pricing_version"),
    cardGeneration: integer("card_generation").notNull().default(0),
    paymentMethodId: text("payment_method_id"),
    setupIntentId: text("setup_intent_id"),
    cardBrand: text("card_brand"),
    cardLast4: text("card_last4"),
    cardExpiryMonth: integer("card_expiry_month"),
    cardExpiryYear: integer("card_expiry_year"),
    billingEmail: text("billing_email"),
    contactName: text("contact_name"),
    customerOperationAt: timestamp("customer_operation_at", {
      withTimezone: true,
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "billing_accounts_contact_name_length",
      sql`contact_name is null or char_length(contact_name) between 1 and 80`,
    ),
    check("billing_accounts_check_1", sql.raw("currency = 'USD'")),
    check(
      "billing_accounts_check_2",
      sql.raw(
        "status in ('pending_setup','active','past_due','suspended','revoked')",
      ),
    ),
    check(
      "billing_accounts_check_3",
      sql.raw(
        "monthly_limit_cents >= 0 and per_call_limit_cents >= 0 and per_call_limit_cents <= monthly_limit_cents",
      ),
    ),
    check(
      "billing_accounts_check_4",
      sql.raw("credit_limit_cents between 0 and 1000"),
    ),
    check("billing_accounts_check_5", sql.raw("card_generation >= 0")),
    check(
      "billing_accounts_check_6",
      sql.raw(
        "not collection_consent or (consented_by is not null and consented_at is not null and consent_version is not null)",
      ),
    ),
    check(
      "billing_accounts_check_7",
      sql.raw(
        "status <> 'active' or (payment_method_id is not null and setup_intent_id is not null and collection_consent)",
      ),
    ),
    unique("billing_accounts_unique_1").on(t.id, t.clientId),
    unique("billing_accounts_unique_2").on(t.clientId),
    unique("billing_accounts_unique_3").on(t.stripeCustomerId),
    foreignKey({
      name: "billing_accounts_fk_1",
      columns: [t.clientId],
      foreignColumns: [clientProfiles.id],
    }),
    foreignKey({
      name: "billing_accounts_fk_2",
      columns: [t.clientId, t.consentedBy],
      foreignColumns: [clientProfiles.id, clientProfiles.supabaseUserId],
    }),
    index("billing_accounts_index_1").on(t.status),
  ],
).enableRLS();
export const billingAuthorizations = pgTable(
  "billing_authorizations",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    clientId: uuid("client_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    billingAccountId: uuid("billing_account_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    status: text("status").notNull().default("pending"),
    monthlyLimitCents: integer("monthly_limit_cents").notNull().default(0),
    perCallLimitCents: integer("per_call_limit_cents").notNull().default(0),
    version: integer("version").notNull().default(1),
    agreementVersion: text("agreement_version"),
    pricingVersion: text("pricing_version"),
    consentedBy: uuid("consented_by"),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "billing_authorizations_check_1",
      sql.raw("status in ('pending','active','revoked','expired')"),
    ),
    check(
      "billing_authorizations_check_2",
      sql.raw(
        "monthly_limit_cents >= 0 and per_call_limit_cents >= 0 and per_call_limit_cents <= monthly_limit_cents",
      ),
    ),
    check("billing_authorizations_check_3", sql.raw("version > 0")),
    check(
      "billing_authorizations_check_4",
      sql.raw(
        "status <> 'active' or (consented_by is not null and consented_at is not null and agreement_version is not null and pricing_version is not null and effective_at is not null and revoked_at is null)",
      ),
    ),
    unique("billing_authorizations_unique_1").on(
      t.id,
      t.billingAccountId,
      t.clientId,
      t.connectionId,
    ),
    unique("billing_authorizations_owner_key").on(
      t.id,
      t.billingAccountId,
      t.clientId,
    ),
    unique("billing_authorizations_unique_2").on(
      t.billingAccountId,
      t.connectionId,
    ),
    foreignKey({
      name: "billing_authorizations_fk_1",
      columns: [t.billingAccountId, t.clientId],
      foreignColumns: [billingAccounts.id, billingAccounts.clientId],
    }),
    foreignKey({
      name: "billing_authorizations_fk_2",
      columns: [t.connectionId, t.clientId],
      foreignColumns: [agentConnections.id, agentConnections.clientId],
    }),
    foreignKey({
      name: "billing_authorizations_fk_3",
      columns: [t.clientId, t.consentedBy],
      foreignColumns: [clientProfiles.id, clientProfiles.supabaseUserId],
    }),
    index("billing_authorizations_index_1").on(t.billingAccountId, t.status),
  ],
).enableRLS();
export const billingSetupRequests = pgTable(
  "billing_setup_requests",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    clientId: uuid("client_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    billingAccountId: uuid("billing_account_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    authorizationId: uuid("authorization_id").notNull(),
    expectedUserId: uuid("expected_user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    purpose: text("purpose").notNull().default("enroll"),
    status: text("status").notNull().default("pending"),
    tokenGeneration: integer("token_generation").notNull().default(1),
    tokenDigest: text("token_digest").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    generation: integer("generation").notNull().default(1),
    cardGeneration: integer("card_generation").notNull().default(0),
    authorizationVersion: integer("authorization_version").notNull().default(1),
    monthlyLimitCents: integer("monthly_limit_cents").notNull().default(0),
    perCallLimitCents: integer("per_call_limit_cents").notNull().default(0),
    agreementVersion: text("agreement_version"),
    pricingVersion: text("pricing_version"),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    stripeSessionId: text("stripe_session_id"),
    stripeSetupIntentId: text("stripe_setup_intent_id"),
    checkoutOrigin: text("checkout_origin"),
    checkoutExpiresAt: timestamp("checkout_expires_at", { withTimezone: true }),
    operationStartedAt: timestamp("operation_started_at", {
      withTimezone: true,
    }),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (t) => [
    check(
      "billing_setup_requests_check_1",
      sql.raw("purpose in ('enroll','replace_card')"),
    ),
    check(
      "billing_setup_requests_check_2",
      sql.raw(
        "status in ('pending','consented','creating_checkout','processing','ready','failed','expired','revoked')",
      ),
    ),
    check(
      "billing_setup_requests_check_3",
      sql.raw(
        "generation > 0 and token_generation > 0 and card_generation >= 0 and authorization_version > 0",
      ),
    ),
    check(
      "billing_setup_requests_check_4",
      sql.raw(
        "monthly_limit_cents >= 0 and per_call_limit_cents >= 0 and per_call_limit_cents <= monthly_limit_cents",
      ),
    ),
    uniqueIndex("billing_setup_requests_one_pending")
      .on(t.connectionId, t.purpose)
      .where(
        sql.raw(
          "status in ('pending','consented','creating_checkout','processing')",
        ),
      ),
    unique("billing_setup_requests_unique_1").on(
      t.clientId,
      t.connectionId,
      t.idempotencyKey,
    ),
    unique("billing_setup_requests_unique_2").on(t.tokenDigest),
    unique("billing_setup_requests_unique_3").on(t.stripeSessionId),
    foreignKey({
      name: "billing_setup_requests_fk_1",
      columns: [t.billingAccountId, t.clientId],
      foreignColumns: [billingAccounts.id, billingAccounts.clientId],
    }),
    foreignKey({
      name: "billing_setup_requests_fk_2",
      columns: [t.connectionId, t.clientId],
      foreignColumns: [agentConnections.id, agentConnections.clientId],
    }),
    foreignKey({
      name: "billing_setup_requests_fk_3",
      columns: [
        t.authorizationId,
        t.billingAccountId,
        t.clientId,
        t.connectionId,
      ],
      foreignColumns: [
        billingAuthorizations.id,
        billingAuthorizations.billingAccountId,
        billingAuthorizations.clientId,
        billingAuthorizations.connectionId,
      ],
    }),
    foreignKey({
      name: "billing_setup_requests_fk_4",
      columns: [t.clientId, t.expectedUserId],
      foreignColumns: [clientProfiles.id, clientProfiles.supabaseUserId],
    }),
    index("billing_setup_requests_index_1").on(t.status, t.expiresAt),
  ],
).enableRLS();
export const billingPeriods = pgTable(
  "billing_periods",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    clientId: uuid("client_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    billingAccountId: uuid("billing_account_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    limitCents: integer("limit_cents").notNull(),
    spentCents: integer("spent_cents").notNull().default(0),
    reservedCents: integer("reserved_cents").notNull().default(0),
    collectedCents: integer("collected_cents").notNull().default(0),
    waivedCents: integer("waived_cents").notNull().default(0),
    status: text("status").notNull().default("open"),
    totalCents: integer("total_cents"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "billing_periods_check_1",
      sql.raw("status in ('open','closing','closed')"),
    ),
    check(
      "billing_periods_check_2",
      sql.raw(
        "starts_at = (date_trunc('month', starts_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') and ends_at = ((starts_at AT TIME ZONE 'UTC' + interval '1 month') AT TIME ZONE 'UTC')",
      ),
    ),
    check(
      "billing_periods_check_3",
      sql.raw(
        "limit_cents >= 0 and spent_cents >= 0 and reserved_cents >= 0 and collected_cents >= 0 and waived_cents >= 0 and collected_cents + waived_cents <= spent_cents",
      ),
    ),
    check(
      "billing_periods_check_4",
      sql.raw(
        "status <> 'closed' or (reserved_cents = 0 and total_cents is not null and total_cents >= 0 and closed_at is not null)",
      ),
    ),
    unique("billing_periods_unique_1").on(t.id, t.billingAccountId, t.clientId),
    unique("billing_periods_unique_2").on(t.billingAccountId, t.startsAt),
    foreignKey({
      name: "billing_periods_fk_1",
      columns: [t.billingAccountId, t.clientId],
      foreignColumns: [billingAccounts.id, billingAccounts.clientId],
    }),
    index("billing_periods_index_1").on(t.status, t.endsAt),
  ],
).enableRLS();
export const billingCallUsage = pgTable(
  "billing_call_usage",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    clientId: uuid("client_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    billingAccountId: uuid("billing_account_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    authorizationId: uuid("authorization_id").notNull(),
    periodId: uuid("period_id").notNull(),
    callId: uuid("call_id"),
    callReference: uuid("call_reference").notNull(),
    credentialId: text("credential_id").notNull(),
    authorizationVersion: integer("authorization_version").notNull(),
    connectionVersion: integer("connection_version").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    pricingVersion: text("pricing_version").notNull(),
    currency: text("currency").notNull().default("USD"),
    businessRate: jsonb("business_rate").$type<BillingRate>().notNull(),
    callbackRate: jsonb("callback_rate").$type<BillingRate>().notNull(),
    reservedCents: integer("reserved_cents").notNull(),
    finalCents: integer("final_cents"),
    state: text("state").notNull().default("reserved"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (t) => [
    check("billing_call_usage_check_1", sql.raw("currency = 'USD'")),
    check(
      "billing_call_usage_check_2",
      sql.raw(
        "state in ('reserved','metering_pending','finalized','released')",
      ),
    ),
    check(
      "billing_call_usage_check_3",
      sql.raw(
        "reserved_cents >= 0 and (final_cents is null or final_cents between 0 and reserved_cents)",
      ),
    ),
    check(
      "billing_call_usage_check_4",
      sql.raw(
        "(state in ('finalized','released')) = (final_cents is not null and finalized_at is not null)",
      ),
    ),
    check(
      "billing_call_usage_check_5",
      sql.raw("state <> 'released' or final_cents = 0"),
    ),
    unique("billing_call_usage_unique_1").on(t.callReference),
    unique("billing_call_usage_unique_2").on(t.callId),
    foreignKey({
      name: "billing_call_usage_fk_1",
      columns: [t.billingAccountId, t.clientId],
      foreignColumns: [billingAccounts.id, billingAccounts.clientId],
    }),
    foreignKey({
      name: "billing_call_usage_fk_2",
      columns: [t.connectionId, t.clientId],
      foreignColumns: [agentConnections.id, agentConnections.clientId],
    }),
    foreignKey({
      name: "billing_call_usage_fk_3",
      columns: [
        t.authorizationId,
        t.billingAccountId,
        t.clientId,
        t.connectionId,
      ],
      foreignColumns: [
        billingAuthorizations.id,
        billingAuthorizations.billingAccountId,
        billingAuthorizations.clientId,
        billingAuthorizations.connectionId,
      ],
    }),
    foreignKey({
      name: "billing_call_usage_fk_4",
      columns: [t.periodId, t.billingAccountId, t.clientId],
      foreignColumns: [
        billingPeriods.id,
        billingPeriods.billingAccountId,
        billingPeriods.clientId,
      ],
    }),
    foreignKey({
      name: "billing_call_usage_fk_5",
      columns: [t.callId, t.clientId],
      foreignColumns: [calls.id, calls.clientId],
    }),
    index("billing_call_usage_index_1").on(t.periodId, t.state),
    index("billing_call_usage_index_2").on(t.authorizationId, t.periodId),
  ],
).enableRLS();
export const billingInvoices = pgTable(
  "billing_invoices",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    clientId: uuid("client_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    billingAccountId: uuid("billing_account_id").notNull(),
    periodId: uuid("period_id").notNull(),
    expectedCents: integer("expected_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    paymentMethodId: text("payment_method_id").notNull(),
    stripeInvoiceId: text("stripe_invoice_id"),
    stripeItemId: text("stripe_item_id"),
    issuanceState: text("issuance_state").notNull().default("pending"),
    stripeStatus: text("stripe_status"),
    actionRequired: boolean("action_required").notNull().default(false),
    amountPaid: integer("amount_paid").notNull().default(0),
    amountRemaining: integer("amount_remaining").notNull().default(0),
    createStartedAt: timestamp("create_started_at", { withTimezone: true }),
    itemStartedAt: timestamp("item_started_at", { withTimezone: true }),
    finalizeStartedAt: timestamp("finalize_started_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (t) => [
    check("billing_invoices_check_1", sql.raw("currency = 'USD'")),
    check(
      "billing_invoices_check_2",
      sql.raw(
        "expected_cents > 0 and amount_paid >= 0 and amount_remaining >= 0",
      ),
    ),
    check(
      "billing_invoices_check_3",
      sql.raw("issuance_state in ('pending','creating','ready','unknown')"),
    ),
    check(
      "billing_invoices_check_4",
      sql.raw(
        "stripe_status is null or stripe_status in ('draft','open','paid','uncollectible','void')",
      ),
    ),
    unique("billing_invoices_unique_1").on(t.periodId),
    unique("billing_invoices_unique_2").on(t.stripeInvoiceId),
    foreignKey({
      name: "billing_invoices_fk_1",
      columns: [t.billingAccountId, t.clientId],
      foreignColumns: [billingAccounts.id, billingAccounts.clientId],
    }),
    foreignKey({
      name: "billing_invoices_fk_2",
      columns: [t.periodId, t.billingAccountId, t.clientId],
      foreignColumns: [
        billingPeriods.id,
        billingPeriods.billingAccountId,
        billingPeriods.clientId,
      ],
    }),
    index("billing_invoices_index_1").on(t.issuanceState, t.leaseUntil),
    index("billing_invoices_index_2").on(t.stripeStatus, t.reconciledAt),
  ],
).enableRLS();
export const billingAuditEvents = pgTable(
  "billing_audit_events",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    clientId: uuid("client_id").notNull(),
    billingAccountId: uuid("billing_account_id").notNull(),
    operationKey: text("operation_key").notNull(),
    kind: text("kind").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "billing_audit_events_check_1",
      sql.raw("actor_type in ('human','agent','system','stripe','operator')"),
    ),
    check(
      "billing_audit_events_check_2",
      sql.raw(
        "jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 8192",
      ),
    ),
    unique("billing_audit_events_unique_1").on(t.operationKey),
    foreignKey({
      name: "billing_audit_events_fk_1",
      columns: [t.billingAccountId, t.clientId],
      foreignColumns: [billingAccounts.id, billingAccounts.clientId],
    }),
    index("billing_audit_events_index_1").on(t.billingAccountId, t.createdAt),
  ],
).enableRLS();
