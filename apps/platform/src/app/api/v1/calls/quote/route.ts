import { authenticateBillingPrincipal } from "@/lib/agent-auth";
import { quoteStripeCall } from "@/lib/billing-usage";
import { billingErrorResponse } from "@/lib/billing-policy";
export async function POST(request: Request) {
  try {
    return Response.json(
      await quoteStripeCall(
        await authenticateBillingPrincipal(request),
        await request.json(),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return billingErrorResponse(error);
  }
}
