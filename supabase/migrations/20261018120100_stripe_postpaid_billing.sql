ALTER TABLE calls ADD CONSTRAINT calls_id_client_key UNIQUE (id, client_id);

CREATE TABLE billing_accounts (

  id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stripe_customer_id TEXT,
  livemode BOOLEAN NOT NULL DEFAULT false,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending_setup',
  block_reason TEXT,
  monthly_limit_cents INTEGER NOT NULL DEFAULT 0,
  per_call_limit_cents INTEGER NOT NULL DEFAULT 0,
  credit_limit_cents INTEGER NOT NULL DEFAULT 1000,
  collection_consent BOOLEAN NOT NULL DEFAULT false,
  consent_version TEXT,
  consented_at TIMESTAMPTZ,
  consented_by UUID,
  pricing_version TEXT,
  card_generation INTEGER NOT NULL DEFAULT 0,
  payment_method_id TEXT,
  setup_intent_id TEXT,
  card_brand TEXT,
  card_last4 TEXT,
  card_expiry_month INTEGER,
  card_expiry_year INTEGER,
  billing_email TEXT,
  customer_operation_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT billing_accounts_check_1 CHECK (currency = 'USD'),
  CONSTRAINT billing_accounts_check_2 CHECK (status in ('pending_setup','active','past_due','suspended','revoked')),
  CONSTRAINT billing_accounts_check_3 CHECK (monthly_limit_cents >= 0 and per_call_limit_cents >= 0 and per_call_limit_cents <= monthly_limit_cents),
  CONSTRAINT billing_accounts_check_4 CHECK (credit_limit_cents between 0 and 1000),
  CONSTRAINT billing_accounts_check_5 CHECK (card_generation >= 0),
  CONSTRAINT billing_accounts_check_6 CHECK (not collection_consent or (consented_by is not null and consented_at is not null and consent_version is not null)),
  CONSTRAINT billing_accounts_check_7 CHECK (status <> 'active' or (payment_method_id is not null and setup_intent_id is not null and collection_consent)),
  CONSTRAINT billing_accounts_unique_1 UNIQUE (id, client_id),
  CONSTRAINT billing_accounts_unique_2 UNIQUE (client_id),
  CONSTRAINT billing_accounts_unique_3 UNIQUE (stripe_customer_id),
  CONSTRAINT billing_accounts_fk_1 FOREIGN KEY (client_id) REFERENCES client_profiles (id),
  CONSTRAINT billing_accounts_fk_2 FOREIGN KEY (client_id, consented_by) REFERENCES client_profiles (id, supabase_user_id)
);

CREATE INDEX billing_accounts_index_1 ON billing_accounts (status);

ALTER TABLE billing_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE billing_authorizations (

  id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  billing_account_id UUID NOT NULL,
  connection_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  monthly_limit_cents INTEGER NOT NULL DEFAULT 0,
  per_call_limit_cents INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  agreement_version TEXT,
  pricing_version TEXT,
  consented_by UUID,
  consented_at TIMESTAMPTZ,
  effective_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT billing_authorizations_check_1 CHECK (status in ('pending','active','revoked','expired')),
  CONSTRAINT billing_authorizations_check_2 CHECK (monthly_limit_cents >= 0 and per_call_limit_cents >= 0 and per_call_limit_cents <= monthly_limit_cents),
  CONSTRAINT billing_authorizations_check_3 CHECK (version > 0),
  CONSTRAINT billing_authorizations_check_4 CHECK (status <> 'active' or (consented_by is not null and consented_at is not null and agreement_version is not null and pricing_version is not null and effective_at is not null and revoked_at is null)),
  CONSTRAINT billing_authorizations_unique_1 UNIQUE (id, billing_account_id, client_id, connection_id),
  CONSTRAINT billing_authorizations_unique_2 UNIQUE (billing_account_id, connection_id),
  CONSTRAINT billing_authorizations_fk_1 FOREIGN KEY (billing_account_id, client_id) REFERENCES billing_accounts (id, client_id),
  CONSTRAINT billing_authorizations_fk_2 FOREIGN KEY (connection_id, client_id) REFERENCES agent_connections (id, client_id),
  CONSTRAINT billing_authorizations_fk_3 FOREIGN KEY (client_id, consented_by) REFERENCES client_profiles (id, supabase_user_id)
);

CREATE INDEX billing_authorizations_index_1 ON billing_authorizations (billing_account_id, status);

ALTER TABLE billing_authorizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE billing_setup_requests (

  id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  billing_account_id UUID NOT NULL,
  connection_id UUID NOT NULL,
  authorization_id UUID NOT NULL,
  expected_user_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'enroll',
  status TEXT NOT NULL DEFAULT 'pending',
  token_generation INTEGER NOT NULL DEFAULT 1,
  token_digest TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  card_generation INTEGER NOT NULL DEFAULT 0,
  authorization_version INTEGER NOT NULL DEFAULT 1,
  monthly_limit_cents INTEGER NOT NULL DEFAULT 0,
  per_call_limit_cents INTEGER NOT NULL DEFAULT 0,
  agreement_version TEXT,
  pricing_version TEXT,
  consented_at TIMESTAMPTZ,
  stripe_session_id TEXT,
  stripe_setup_intent_id TEXT,
  checkout_expires_at TIMESTAMPTZ,
  operation_started_at TIMESTAMPTZ,
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  CONSTRAINT billing_setup_requests_check_1 CHECK (purpose in ('enroll','replace_card')),
  CONSTRAINT billing_setup_requests_check_2 CHECK (status in ('pending','consented','creating_checkout','processing','ready','failed','expired','revoked')),
  CONSTRAINT billing_setup_requests_check_3 CHECK (generation > 0 and token_generation > 0 and card_generation >= 0 and authorization_version > 0),
  CONSTRAINT billing_setup_requests_check_4 CHECK (monthly_limit_cents >= 0 and per_call_limit_cents >= 0 and per_call_limit_cents <= monthly_limit_cents),
  CONSTRAINT billing_setup_requests_unique_1 UNIQUE (client_id, connection_id, idempotency_key),
  CONSTRAINT billing_setup_requests_unique_2 UNIQUE (token_digest),
  CONSTRAINT billing_setup_requests_unique_3 UNIQUE (stripe_session_id),
  CONSTRAINT billing_setup_requests_fk_1 FOREIGN KEY (billing_account_id, client_id) REFERENCES billing_accounts (id, client_id),
  CONSTRAINT billing_setup_requests_fk_2 FOREIGN KEY (connection_id, client_id) REFERENCES agent_connections (id, client_id),
  CONSTRAINT billing_setup_requests_fk_3 FOREIGN KEY (authorization_id, billing_account_id, client_id, connection_id) REFERENCES billing_authorizations (id, billing_account_id, client_id, connection_id),
  CONSTRAINT billing_setup_requests_fk_4 FOREIGN KEY (client_id, expected_user_id) REFERENCES client_profiles (id, supabase_user_id)
);

CREATE INDEX billing_setup_requests_index_1 ON billing_setup_requests (status, expires_at);

ALTER TABLE billing_setup_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE billing_periods (

  id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  billing_account_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  limit_cents INTEGER NOT NULL,
  spent_cents INTEGER NOT NULL DEFAULT 0,
  reserved_cents INTEGER NOT NULL DEFAULT 0,
  collected_cents INTEGER NOT NULL DEFAULT 0,
  waived_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  total_cents INTEGER,
  closed_at TIMESTAMPTZ,
  CONSTRAINT billing_periods_check_1 CHECK (status in ('open','closing','closed')),
  CONSTRAINT billing_periods_check_2 CHECK (starts_at = (date_trunc('month', starts_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') and ends_at = ((starts_at AT TIME ZONE 'UTC' + interval '1 month') AT TIME ZONE 'UTC')),
  CONSTRAINT billing_periods_check_3 CHECK (limit_cents >= 0 and spent_cents >= 0 and reserved_cents >= 0 and collected_cents >= 0 and waived_cents >= 0 and collected_cents + waived_cents <= spent_cents),
  CONSTRAINT billing_periods_check_4 CHECK (status <> 'closed' or (reserved_cents = 0 and total_cents is not null and total_cents >= 0 and closed_at is not null)),
  CONSTRAINT billing_periods_unique_1 UNIQUE (id, billing_account_id, client_id),
  CONSTRAINT billing_periods_unique_2 UNIQUE (billing_account_id, starts_at),
  CONSTRAINT billing_periods_fk_1 FOREIGN KEY (billing_account_id, client_id) REFERENCES billing_accounts (id, client_id)
);

CREATE INDEX billing_periods_index_1 ON billing_periods (status, ends_at);

ALTER TABLE billing_periods ENABLE ROW LEVEL SECURITY;

CREATE TABLE billing_call_usage (

  id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  billing_account_id UUID NOT NULL,
  connection_id UUID NOT NULL,
  authorization_id UUID NOT NULL,
  period_id UUID NOT NULL,
  call_id UUID,
  call_reference UUID NOT NULL,
  credential_id TEXT NOT NULL,
  authorization_version INTEGER NOT NULL,
  connection_version INTEGER NOT NULL,
  request_fingerprint TEXT NOT NULL,
  pricing_version TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  business_rate JSONB NOT NULL,
  callback_rate JSONB NOT NULL,
  reserved_cents INTEGER NOT NULL,
  final_cents INTEGER,
  state TEXT NOT NULL DEFAULT 'reserved',
  evidence JSONB,
  finalized_at TIMESTAMPTZ,
  CONSTRAINT billing_call_usage_check_1 CHECK (currency = 'USD'),
  CONSTRAINT billing_call_usage_check_2 CHECK (state in ('reserved','metering_pending','finalized','released')),
  CONSTRAINT billing_call_usage_check_3 CHECK (reserved_cents >= 0 and (final_cents is null or final_cents between 0 and reserved_cents)),
  CONSTRAINT billing_call_usage_check_4 CHECK ((state in ('finalized','released')) = (final_cents is not null and finalized_at is not null)),
  CONSTRAINT billing_call_usage_check_5 CHECK (state <> 'released' or final_cents = 0),
  CONSTRAINT billing_call_usage_unique_1 UNIQUE (call_reference),
  CONSTRAINT billing_call_usage_unique_2 UNIQUE (call_id),
  CONSTRAINT billing_call_usage_fk_1 FOREIGN KEY (billing_account_id, client_id) REFERENCES billing_accounts (id, client_id),
  CONSTRAINT billing_call_usage_fk_2 FOREIGN KEY (connection_id, client_id) REFERENCES agent_connections (id, client_id),
  CONSTRAINT billing_call_usage_fk_3 FOREIGN KEY (authorization_id, billing_account_id, client_id, connection_id) REFERENCES billing_authorizations (id, billing_account_id, client_id, connection_id),
  CONSTRAINT billing_call_usage_fk_4 FOREIGN KEY (period_id, billing_account_id, client_id) REFERENCES billing_periods (id, billing_account_id, client_id),
  CONSTRAINT billing_call_usage_fk_5 FOREIGN KEY (call_id, client_id) REFERENCES calls (id, client_id)
);

CREATE INDEX billing_call_usage_index_1 ON billing_call_usage (period_id, state);

CREATE INDEX billing_call_usage_index_2 ON billing_call_usage (authorization_id, period_id);

ALTER TABLE billing_call_usage ENABLE ROW LEVEL SECURITY;

CREATE TABLE billing_invoices (

  id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  billing_account_id UUID NOT NULL,
  period_id UUID NOT NULL,
  expected_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  stripe_customer_id TEXT NOT NULL,
  payment_method_id TEXT NOT NULL,
  stripe_invoice_id TEXT,
  stripe_item_id TEXT,
  issuance_state TEXT NOT NULL DEFAULT 'pending',
  stripe_status TEXT,
  action_required BOOLEAN NOT NULL DEFAULT false,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  amount_remaining INTEGER NOT NULL DEFAULT 0,
  create_started_at TIMESTAMPTZ,
  item_started_at TIMESTAMPTZ,
  finalize_started_at TIMESTAMPTZ,
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  last_error TEXT,
  CONSTRAINT billing_invoices_check_1 CHECK (currency = 'USD'),
  CONSTRAINT billing_invoices_check_2 CHECK (expected_cents > 0 and amount_paid >= 0 and amount_remaining >= 0),
  CONSTRAINT billing_invoices_check_3 CHECK (issuance_state in ('pending','creating','ready','unknown')),
  CONSTRAINT billing_invoices_check_4 CHECK (stripe_status is null or stripe_status in ('draft','open','paid','uncollectible','void')),
  CONSTRAINT billing_invoices_unique_1 UNIQUE (period_id),
  CONSTRAINT billing_invoices_unique_2 UNIQUE (stripe_invoice_id),
  CONSTRAINT billing_invoices_fk_1 FOREIGN KEY (billing_account_id, client_id) REFERENCES billing_accounts (id, client_id),
  CONSTRAINT billing_invoices_fk_2 FOREIGN KEY (period_id, billing_account_id, client_id) REFERENCES billing_periods (id, billing_account_id, client_id)
);

CREATE INDEX billing_invoices_index_1 ON billing_invoices (issuance_state, lease_until);

CREATE INDEX billing_invoices_index_2 ON billing_invoices (stripe_status, reconciled_at);

ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;

CREATE TABLE billing_audit_events (

  id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  billing_account_id UUID NOT NULL,
  operation_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  detail JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT billing_audit_events_check_1 CHECK (actor_type in ('human','agent','system','stripe','operator')),
  CONSTRAINT billing_audit_events_check_2 CHECK (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 8192),
  CONSTRAINT billing_audit_events_unique_1 UNIQUE (operation_key),
  CONSTRAINT billing_audit_events_fk_1 FOREIGN KEY (billing_account_id, client_id) REFERENCES billing_accounts (id, client_id)
);

CREATE INDEX billing_audit_events_index_1 ON billing_audit_events (billing_account_id, created_at);

ALTER TABLE billing_audit_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE billing_authorizations ADD CONSTRAINT billing_authorizations_owner_key UNIQUE (id, billing_account_id, client_id);
CREATE UNIQUE INDEX billing_setup_requests_one_pending ON billing_setup_requests(connection_id, purpose) WHERE status IN ('pending','consented','creating_checkout','processing');
ALTER TABLE api_keys ADD COLUMN connection_id UUID;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_connection_owner_fk FOREIGN KEY (connection_id, client_id) REFERENCES agent_connections(id, client_id);
CREATE INDEX api_keys_connection_index ON api_keys(connection_id);
ALTER TABLE rate_cards ADD COLUMN currency TEXT;
ALTER TABLE rate_cards ADD COLUMN stripe_pricing_version TEXT;
ALTER TABLE rate_cards ADD CONSTRAINT rate_cards_stripe_currency_check CHECK ((currency IS NULL AND stripe_pricing_version IS NULL) OR (currency = 'USD' AND stripe_pricing_version IS NOT NULL));
ALTER TABLE calls ADD COLUMN stripe_billing_account_id UUID;
ALTER TABLE calls ADD COLUMN billing_authorization_id UUID;
ALTER TABLE calls ADD COLUMN request_fingerprint TEXT;
ALTER TABLE calls ADD COLUMN scheduled_for TIMESTAMPTZ;
ALTER TABLE calls ADD CONSTRAINT calls_billing_account_owner_fk FOREIGN KEY (stripe_billing_account_id, client_id) REFERENCES billing_accounts(id, client_id);
ALTER TABLE calls ADD CONSTRAINT calls_billing_grant_owner_fk FOREIGN KEY (billing_authorization_id, stripe_billing_account_id, client_id) REFERENCES billing_authorizations(id, billing_account_id, client_id);
ALTER TABLE calls DROP CONSTRAINT calls_funding_source_check;
ALTER TABLE calls DROP CONSTRAINT calls_operator_authorization_check;
ALTER TABLE calls ADD CONSTRAINT calls_funding_source_check CHECK (funding_source IN ('x402','operator','stripe_postpaid'));
ALTER TABLE calls ADD CONSTRAINT calls_operator_authorization_check CHECK (
 (funding_source = 'operator' AND operator_authorized_by = client_id AND operator_authorized_by IS NOT NULL AND payment_state = 'not_required' AND coalesce(task->>'type','') = 'connect_me' AND stripe_billing_account_id IS NULL AND billing_authorization_id IS NULL)
 OR (funding_source = 'x402' AND operator_authorized_by IS NULL AND payment_state IN ('authorized','settling','settled','failed') AND stripe_billing_account_id IS NULL AND billing_authorization_id IS NULL)
 OR (funding_source = 'stripe_postpaid' AND operator_authorized_by IS NULL AND stripe_billing_account_id IS NOT NULL AND billing_authorization_id IS NOT NULL AND request_fingerprint IS NOT NULL AND payment_state IN ('accruing','accrued') AND task->>'type' = 'connect_me')
);
CREATE FUNCTION preserve_billing_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Billing audit facts are append only'; END $$;
CREATE TRIGGER billing_audit_immutable BEFORE UPDATE OR DELETE ON billing_audit_events FOR EACH ROW EXECUTE FUNCTION preserve_billing_audit();
CREATE FUNCTION preserve_final_billing_usage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state IN ('finalized','released') AND
  (to_jsonb(OLD) - 'call_id' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'call_id' - 'updated_at') THEN
  RAISE EXCEPTION 'Final billing usage is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_usage_immutable BEFORE UPDATE ON billing_call_usage FOR EACH ROW EXECUTE FUNCTION preserve_final_billing_usage();
CREATE FUNCTION preserve_closed_billing_period() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status = 'closed' AND
  (to_jsonb(OLD) - 'collected_cents' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'collected_cents' - 'updated_at') THEN
  RAISE EXCEPTION 'Closed billing totals are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_period_immutable BEFORE UPDATE ON billing_periods FOR EACH ROW EXECUTE FUNCTION preserve_closed_billing_period();
