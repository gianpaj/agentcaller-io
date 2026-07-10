import { createDatabase } from "@agentcaller/database";
import { getServerEnv } from "./env";

let instance: ReturnType<typeof createDatabase> | undefined;

export function database() {
  if (!instance) instance = createDatabase(getServerEnv().DATABASE_URL);
  return instance.db;
}
