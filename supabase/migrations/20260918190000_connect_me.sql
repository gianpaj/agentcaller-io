create table connect_jobs (
  call_id uuid primary key references calls(id) on delete cascade,
  next_attempt_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count between 0 and 6),
  reserved_micros integer not null default 0 check (reserved_micros >= 0),
  business_rate jsonb not null,
  callback_rate jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table call_attempts (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references connect_jobs(call_id) on delete cascade,
  ordinal integer not null check (ordinal between 1 and 6),
  state text not null default 'dispatched' check (state in ('dispatched','running','human','accepted','bridged','terminal')),
  worker_id uuid,
  heartbeat_at timestamptz not null default now(),
  business_room text not null unique, callback_room text not null unique,
  reason text, ended_at timestamptz, cleanup_until timestamptz not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint attempt_ordinal unique(call_id, ordinal)
);
create unique index one_active_attempt on call_attempts(call_id) where ended_at is null;
create table call_legs (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references call_attempts(id) on delete cascade,
  kind text not null check (kind in ('business','callback')),
  identity text not null unique, sip_call_id text,
  state text not null default 'intent' check (state in ('intent','connected','ended')),
  connected_at timestamptz, ended_at timestamptz, measured_micros integer,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint attempt_leg unique(attempt_id,kind)
);
create table connect_receipts (
  event_id uuid primary key,
  attempt_id uuid not null references call_attempts(id) on delete cascade,
  response jsonb not null
);
alter table connect_jobs enable row level security;
alter table call_attempts enable row level security;
alter table call_legs enable row level security;
alter table connect_receipts enable row level security;
-- Access is through tenant-scoped platform endpoints; no browser policies.

alter table rate_cards drop constraint rate_cards_country_check;
alter table rate_cards add constraint rate_cards_country_check check (country in ('ES','US','IT'));
alter table calls drop constraint calls_destination_country_check;
alter table calls add constraint calls_destination_country_check check (destination_country in ('ES','US','IT'));
alter table calls drop constraint calls_language_check;
alter table calls add constraint calls_language_check check (language in ('en','es','it'));
alter table calls add constraint connect_only_italian check (
  (destination_country <> 'IT' and language <> 'it') or task->>'type' = 'connect_me'
);
alter table calls add constraint connect_no_recording check (
  task->>'type' <> 'connect_me' or (recording_key is null and recording_consent is not true)
);
