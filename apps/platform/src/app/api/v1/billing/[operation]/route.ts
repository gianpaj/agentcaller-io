import { authenticateBillingPrincipal } from "@/lib/agent-auth";
import { ApiError } from "@/lib/auth";
import { createBillingSetup } from "@/lib/billing-setup";
import { getBillingStatus, getBillingUsage } from "@/lib/billing-usage";
import { billingErrorResponse } from "@/lib/billing-policy";
export async function GET(
  request: Request,
  context: { params: Promise<{ operation: string }> },
) {
  try {
    const principal = await authenticateBillingPrincipal(request),
      { operation } = await context.params;
    const result =
      operation === "status"
        ? await getBillingStatus(principal)
        : operation === "usage"
          ? await getBillingUsage(
              principal,
              new URL(request.url).searchParams.get("before") ?? undefined,
            )
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
    const principal = await authenticateBillingPrincipal(request);
    if ((await context.params).operation !== "setup")
      throw new ApiError(404, "Unknown billing operation");
    return Response.json(
      await createBillingSetup(
        principal,
        request.headers.get("idempotency-key") ?? "",
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return billingErrorResponse(error);
  }
}
