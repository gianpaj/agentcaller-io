import { createDatabase } from "@agentcaller/database";
import { getDatabaseEnv } from "./env";

let instance: ReturnType<typeof createDatabase> | undefined;

export function database() {
  if (!instance) instance = createDatabase(getDatabaseEnv().DATABASE_URL);
  return instance.db;
}
