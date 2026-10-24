import { z } from "zod";

type Environment = Record<string, string | undefined>;

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

const stripeEnv = z.object({
  STRIPE_SECRET_KEY: z.string().regex(/^sk_(test|live)_[A-Za-z0-9]+$/),
});
export function getStripeEnv(env: Environment = process.env) {
  const parsed = stripeEnv.parse(env);
  return {
    ...parsed,
    livemode: parsed.STRIPE_SECRET_KEY.startsWith("sk_live_"),
  };
}

export function getStripeWebhookEnv(env: Environment = process.env) {
  return {
    ...getStripeEnv(env),
    ...z
      .object({
        STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").min(16),
      })
      .parse(env),
  };
}

export function isStripeBillingEnabled(env: Environment = process.env) {
  return (
    z
      .enum(["true", "false"])
      .default("false")
      .parse(env.STRIPE_BILLING_ENABLED) === "true"
  );
}

export function getBillingSetupTokenSecret(env: Environment = process.env) {
  const secret = z.string().min(32).parse(env.BILLING_SETUP_TOKEN_SECRET);
  if (
    [env.API_KEY_PEPPER, env.CRON_SECRET, env.STRIPE_WEBHOOK_SECRET].includes(
      secret,
    )
  )
    throw new Error("Billing setup requires a dedicated token secret");
  return secret;
}

export function getDatabaseEnv(env: Environment = process.env) {
  return databaseEnv.parse({
    DATABASE_URL: env.DATABASE_URL || env.POSTGRES_URL,
  });
}

export function getSupabaseEnv(env: Environment = process.env) {
  return supabaseEnv.parse({
    SUPABASE_URL: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY:
      env.SUPABASE_PUBLISHABLE_KEY ||
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      env.SUPABASE_ANON_KEY ||
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
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
