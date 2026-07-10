CREATE TYPE call_state AS ENUM ('queued', 'dialing', 'in_progress', 'completed', 'failed', 'cancelled');
CREATE TYPE payment_state AS ENUM ('authorized', 'settling', 'settled', 'failed');

CREATE TABLE client_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  github_user_id TEXT UNIQUE,
  webhook_url TEXT,
  webhook_secret TEXT,
  calls_per_minute INTEGER NOT NULL DEFAULT 5 CHECK (calls_per_minute BETWEEN 1 AND 60),
  max_concurrent_calls INTEGER NOT NULL DEFAULT 2 CHECK (max_concurrent_calls BETWEEN 1 AND 20),
  allowed_voice_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rate_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL CHECK (country IN ('ES', 'US')),
  connection_fee_micros INTEGER NOT NULL CHECK (connection_fee_micros >= 0),
  started_minute_fee_micros INTEGER NOT NULL CHECK (started_minute_fee_micros > 0),
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_rate_card_per_country ON rate_cards(country) WHERE active;

CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES client_profiles(id),
  idempotency_key TEXT NOT NULL,
  destination TEXT NOT NULL,
  destination_country TEXT NOT NULL CHECK (destination_country IN ('ES', 'US')),
  language TEXT NOT NULL CHECK (language IN ('en', 'es')),
  voice_id TEXT,
  task JSONB NOT NULL,
  max_duration_seconds INTEGER NOT NULL CHECK (max_duration_seconds BETWEEN 60 AND 1800),
  max_amount_micros INTEGER NOT NULL CHECK (max_amount_micros > 0),
  state call_state NOT NULL DEFAULT 'queued',
  payment_state payment_state NOT NULL DEFAULT 'authorized',
  rate_card_version TEXT NOT NULL,
  livekit_room TEXT,
  outcome JSONB,
  transcript JSONB,
  recording_key TEXT,
  recording_consent BOOLEAN,
  ended_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, idempotency_key)
);
CREATE INDEX calls_client_created_index ON calls(client_id, created_at DESC);

CREATE TABLE call_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  client_id UUID NOT NULL REFERENCES client_profiles(id),
  payer TEXT,
  payment_payload JSONB,
  authorized_micros INTEGER NOT NULL,
  settled_micros INTEGER,
  transaction_hash TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linked developer can read own profile" ON client_profiles FOR SELECT USING (github_user_id = auth.jwt() -> 'user_metadata' ->> 'user_name');
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client calls require server access" ON calls FOR ALL USING (false);
