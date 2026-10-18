import { authenticateApiPrincipal, ApiError } from "@/lib/auth";
import { createBillingSetup, billingSetupStatus } from "@/lib/billing-setup";
import {
  getBillingStatus,
  getBillingUsage,
  quoteStripeCall,
  reserveStripeCall,
  BillingSetupRequired,
} from "@/lib/billing-usage";
import { billingErrorResponse } from "@/lib/billing-policy";
export async function GET(
  request: Request,
  context: { params: Promise<{ operation: string }> },
) {
  try {
    const principal = await authenticateApiPrincipal(request),
      { operation } = await context.params;
    const query = new URL(request.url).searchParams;
    const result =
      operation === "status"
        ? await getBillingStatus(principal)
        : operation === "usage"
          ? await getBillingUsage(principal, query.get("before") ?? undefined)
          : operation === "setup"
            ? await billingSetupStatus(principal, query.get("id") ?? "")
            : null;
    if (!result) throw new ApiError(404, "Unknown billing operation");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return billingErrorResponse(error);
  }
}
export async function POST(
  request: Request,
  context: { params: Promise<{ operation: string }> },
) {
  try {
    const principal = await authenticateApiPrincipal(request),
      { operation } = await context.params;
    const input: unknown = await request.json();
    const key = request.headers.get("idempotency-key") ?? "";
    const result =
      operation === "setup"
        ? await createBillingSetup(principal, key)
        : operation === "quote"
          ? await quoteStripeCall(principal, input)
          : operation === "calls"
            ? await reserveStripeCall(principal, key, input)
            : null;
    if (!result) throw new ApiError(404, "Unknown billing operation");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof BillingSetupRequired)
      return Response.json(
        { error: "billing_setup_required", ...error.setup },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    return billingErrorResponse(error);
  }
}
