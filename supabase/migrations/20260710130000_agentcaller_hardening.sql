-- Tenant identity moves from the mutable GitHub username to the immutable Supabase auth uid.
-- `user_metadata` is writable by the user via auth.updateUser(), so any policy or lookup keyed
-- on it can be spoofed to read another tenant's profile.
ALTER TABLE client_profiles ADD COLUMN supabase_user_id UUID UNIQUE;
COMMENT ON COLUMN client_profiles.github_user_id IS 'Display handle only. Never use for authorization: GitHub usernames are mutable and re-registrable.';

DROP POLICY IF EXISTS "linked developer can read own profile" ON client_profiles;
CREATE POLICY "linked developer can read own profile" ON client_profiles FOR SELECT USING (supabase_user_id = auth.uid());

-- Supabase exposes every public-schema table through PostgREST to the anon role, whose key is
-- public by design. Without RLS these tables leak API key hashes, payment payloads, and
-- transcripts. All access goes through the service role, which bypasses RLS.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api keys require server access" ON api_keys FOR ALL USING (false);
ALTER TABLE rate_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rate cards require server access" ON rate_cards FOR ALL USING (false);
ALTER TABLE call_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call events require server access" ON call_events FOR ALL USING (false);
ALTER TABLE payment_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment settlements require server access" ON payment_settlements FOR ALL USING (false);
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "webhook deliveries require server access" ON webhook_deliveries FOR ALL USING (false);

-- Per-client webhook secrets. A shared platform secret lets any client that can verify a
-- signature also forge one for every other client.
UPDATE client_profiles SET webhook_secret = encode(gen_random_bytes(32), 'hex') WHERE webhook_secret IS NULL;

ALTER TABLE calls ADD COLUMN client_reference TEXT;

-- The drain query filters on (delivered_at IS NULL, next_attempt_at) and orders by the same.
CREATE INDEX webhook_deliveries_pending_index ON webhook_deliveries (next_attempt_at NULLS FIRST, created_at) WHERE delivered_at IS NULL;
-- Child-side FK indexes: DELETE /v1/calls/:id cascades into both tables.
CREATE INDEX webhook_deliveries_call_index ON webhook_deliveries (call_id);
CREATE INDEX call_events_call_index ON call_events (call_id);
-- Every settlement lookup is by call_id, and the code assumes at most one per call.
CREATE UNIQUE INDEX payment_settlements_call_index ON payment_settlements (call_id) WHERE call_id IS NOT NULL;
