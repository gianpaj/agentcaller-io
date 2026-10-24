ALTER TABLE client_profiles ADD CONSTRAINT client_profiles_id_owner_key
  UNIQUE (id, supabase_user_id);

CREATE TABLE agent_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES client_profiles(id),
  name TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject UUID NOT NULL,
  oauth_client_id TEXT NOT NULL,
  operations JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  consent_version TEXT,
  consented_at TIMESTAMPTZ,
  consented_by UUID,
  version INTEGER NOT NULL DEFAULT 1,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_connections_identity_key UNIQUE (issuer, subject, oauth_client_id),
  CONSTRAINT agent_connections_id_client_key UNIQUE (id, client_id),
  CONSTRAINT agent_connections_owner_fk FOREIGN KEY (client_id, subject)
    REFERENCES client_profiles(id, supabase_user_id),
  CONSTRAINT agent_connections_status_check CHECK (status IN ('pending','active','revoked')),
  CONSTRAINT agent_connections_version_check CHECK (version > 0),
  CONSTRAINT agent_connections_operations_check CHECK (
    jsonb_typeof(operations) = 'array' AND
    operations <@ '["calls:read","calls:create","billing:setup","billing:read"]'::jsonb
  ),
  CONSTRAINT agent_connections_consent_check CHECK (status <> 'active' OR (
    consented_by = subject AND consented_by IS NOT NULL AND consented_at IS NOT NULL
    AND consent_version IS NOT NULL AND revoked_at IS NULL
  )),
  CONSTRAINT agent_connections_revocation_check CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX agent_connections_client_status_index ON agent_connections(client_id, status);
ALTER TABLE agent_connections ENABLE ROW LEVEL SECURITY;

-- OAuth bearer tokens must not gain access to human profile settings via PostgREST.
DROP POLICY "linked developer can read own profile" ON client_profiles;
CREATE POLICY "linked developer can read own profile" ON client_profiles FOR SELECT
  USING (supabase_user_id = auth.uid() AND (auth.jwt()->>'client_id') IS NULL);
