import { readFileSync, readdirSync } from "node:fs";
import postgres from "postgres";

export function openTestDatabase(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" || parsed.password !== "offline-test")
    throw new Error("E2E requires its owned loopback database");
  return postgres(url, { max: 1, prepare: false, onnotice() {} });
}

export async function migrateTestDatabase(sql) {
  await sql.unsafe(
    "create extension if not exists pgcrypto; create schema if not exists auth; create or replace function auth.uid() returns uuid language sql as $$select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid$$; create or replace function auth.jwt() returns jsonb language sql as $$select nullif(current_setting('request.jwt.claims', true), '')::jsonb$$;",
  );
  const migrations = new URL(
    "../../../../supabase/migrations/",
    import.meta.url,
  );
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await sql.unsafe(readFileSync(new URL(name, migrations), "utf8"));
}

export async function resetTestDatabase(sql) {
  await sql.unsafe(
    "truncate client_profiles, stripe_events, rate_cards cascade",
  );
  await sql`insert into rate_cards (country, currency, version, connection_fee_micros, started_minute_fee_micros, active, stripe_pricing_version) values ('ES', 'USD', 'e2e-v1', 100000, 200000, true, 'e2e-v1')`;
}
