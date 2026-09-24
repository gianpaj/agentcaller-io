import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export * from "./schema";

export function normalizeDatabaseUrl(connectionString: string) {
  const url = new URL(connectionString);
  if (
    url.searchParams.get("sslmode") === "require" &&
    !url.searchParams.has("uselibpqcompat")
  )
    url.searchParams.set("uselibpqcompat", "true");
  return url.toString();
}

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString: normalizeDatabaseUrl(connectionString),
    max: 5,
  });
  return { db: drizzle(pool, { schema }), pool };
}
