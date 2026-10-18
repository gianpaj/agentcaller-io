import { z } from "zod";
import { ApiError } from "./auth";
import { getStripeEnv, isStripeBillingEnabled } from "./env";

export const billingAgreementVersion = "monthly-usage-v1";
export function billingPolicy(
  env: Record<string, string | undefined> = process.env,
) {
  const policy = z
    .object({
      STRIPE_PRICING_VERSION: z.string().trim().min(1).max(120),
      NEXT_PUBLIC_APP_URL: z.url(),
    })
    .parse(env);
  const origin = new URL(policy.NEXT_PUBLIC_APP_URL);
  if (
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      ))
  )
    throw new ApiError(503, "Billing origin is not configured");
  return {
    pricingVersion: policy.STRIPE_PRICING_VERSION,
    agreementVersion: billingAgreementVersion,
    origin: origin.origin,
    livemode: getStripeEnv(env).livemode,
  };
}
export function requireEnrollmentPolicy() {
  const policy = billingPolicy();
  if (policy.livemode && !isStripeBillingEnabled())
    throw new ApiError(503, "Live billing enrollment is disabled");
  return policy;
}

export function enrollmentBlocked(account: {
  status: string;
  blockReason: string | null;
}) {
  return (
    account.status === "revoked" ||
    (account.status === "suspended" &&
      account.blockReason !== "saved_card_unavailable")
  );
}

export function billingErrorResponse(error: unknown) {
  if (error instanceof ApiError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: "Invalid billing request",
        issues: error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  return Response.json(
    { error: "Billing is temporarily unavailable" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
