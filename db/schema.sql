-- AgentCaller.io waitlist table (Neon Postgres)
-- Run once against your Neon database before deploying.

CREATE TABLE IF NOT EXISTS waitlist (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  persona     TEXT,
  referrer    TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
