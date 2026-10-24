import { authenticateBillingPrincipal } from "@/lib/agent-auth";
import { billingSetupStatus } from "@/lib/billing-setup";
import { billingErrorResponse } from "@/lib/billing-policy";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(
      await billingSetupStatus(
        await authenticateBillingPrincipal(request),
        (await context.params).id,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return billingErrorResponse(error);
  }
}
