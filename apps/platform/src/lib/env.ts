import { z } from "zod";

const databaseEnv = z.object({
  DATABASE_URL: z.string().url(),
});

const supabaseEnv = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const apiAuthEnv = z.object({
  API_KEY_PEPPER: z.string().min(32),
});

const agentCallbackEnv = z.object({
  AGENT_CALLBACK_SECRET: z.string().min(32),
});

const cronEnv = z.object({
  CRON_SECRET: z.string().min(32),
});

const paymentEnv = z.object({
  CDP_API_KEY: z.string().min(1).optional(),
  X402_PAY_TO: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  X402_USDC_ASSET: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
});

const liveKitEnv = z.object({
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_AGENT_EU: z.string().min(1),
  LIVEKIT_AGENT_US: z.string().min(1),
});

const r2Env = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
});

export function getDatabaseEnv() {
  return databaseEnv.parse(process.env);
}

export function getSupabaseEnv() {
  return supabaseEnv.parse(process.env);
}

export function getApiAuthEnv() {
  return apiAuthEnv.parse(process.env);
}

export function getAgentCallbackEnv() {
  return agentCallbackEnv.parse(process.env);
}

export function getCronEnv() {
  return cronEnv.parse(process.env);
}

export function getPaymentEnv() {
  return paymentEnv.parse(process.env);
}

export function getLiveKitEnv() {
  return liveKitEnv.parse(process.env);
}

export function getR2Env() {
  return r2Env.parse(process.env);
}
