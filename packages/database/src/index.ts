import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";

/** Drop the node-postgres flag. postgres.js already encrypts sslmode=require without a CA. */
export function normalizeDatabaseUrl(connectionString: string) {
  const url = new URL(connectionString);
  url.searchParams.delete("uselibpqcompat");
  return url.toString();
}

export function createDatabase(connectionString: string) {
  const client = postgres(normalizeDatabaseUrl(connectionString), {
    prepare: false,
    max: 1,
    idle_timeout: 20,
  });
  return { db: drizzle(client, { schema }), client };
}
