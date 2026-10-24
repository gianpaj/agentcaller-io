import { timingSafeCompare } from "@/lib/auth";
import { getCronEnv, isStripeConfigured } from "@/lib/env";
import { drainBilling } from "@/lib/billing-drain";
export const maxDuration = 300;
export async function POST(request: Request) {
  if (
    !timingSafeCompare(
      request.headers.get("authorization"),
      `Bearer ${getCronEnv().CRON_SECRET}`,
    )
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Without a Stripe key nobody can enroll, so there is nothing to reconcile.
  // Skip instead of failing every minute.
  if (!isStripeConfigured())
    return Response.json(
      { skipped: "stripe_not_configured" },
      { headers: { "Cache-Control": "no-store" } },
    );
  try {
    return Response.json(await drainBilling(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Billing reconciliation is temporarily unavailable" },
      { status: 503 },
    );
  }
}
export const GET = POST;
