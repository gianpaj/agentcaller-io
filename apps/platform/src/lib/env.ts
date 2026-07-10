import { z } from "zod";

const serverEnv = z.object({
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  API_KEY_PEPPER: z.string().min(32),
  WEBHOOK_SIGNING_SECRET: z.string().min(32),
  AGENT_CALLBACK_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(32),
  CDP_API_KEY: z.string().min(1),
  X402_PAY_TO: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  X402_USDC_ASSET: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_AGENT_EU: z.string().min(1),
  LIVEKIT_AGENT_US: z.string().min(1),
  LIVEKIT_SIP_TRUNK_EU: z.string().min(1),
  LIVEKIT_SIP_TRUNK_US: z.string().min(1),
  LIVEKIT_CALLER_ID_EU: z.string().regex(/^\+[1-9]\d{7,14}$/),
  LIVEKIT_CALLER_ID_US: z.string().regex(/^\+[1-9]\d{7,14}$/),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverEnv>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (!cached) cached = serverEnv.parse(process.env);
  return cached;
}
