alter table call_attempts add column rooms_cleaned_at timestamptz;
create index call_attempts_pending_cleanup on call_attempts (updated_at)
  where ended_at is not null and rooms_cleaned_at is null;
