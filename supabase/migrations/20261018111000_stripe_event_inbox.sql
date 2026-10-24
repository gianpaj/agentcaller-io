CREATE TABLE stripe_events (
  livemode BOOLEAN NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  api_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  CONSTRAINT stripe_events_environment_event_key PRIMARY KEY (livemode, event_id),
  CONSTRAINT stripe_events_status_check CHECK (status IN ('pending','processing','processed','failed')),
  CONSTRAINT stripe_events_attempts_check CHECK (attempts >= 0)
);
CREATE INDEX stripe_events_pending_index ON stripe_events(next_attempt_at) WHERE status IN ('pending','failed');
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
