import { authenticateBillingPrincipal } from "@/lib/agent-auth";
import { BillingSetupRequired, reserveStripeCall } from "@/lib/billing-usage";
import { billingErrorResponse } from "@/lib/billing-policy";
import { calls } from "@agentcaller/database";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { authenticateApiRequest, ApiError } from "@/lib/auth";
import { database } from "@/lib/database";
import { errorResponse } from "@/lib/http";
import { submitCall } from "@/lib/submit-call";

const PAGE_SIZE = 50;

/** Summary columns only: transcripts are large and are served by the dedicated transcript route. */
const callSummary = {
  id: calls.id,
  destination: calls.destination,
  destinationCountry: calls.destinationCountry,
  language: calls.language,
  clientReference: calls.clientReference,
  state: calls.state,
  paymentState: calls.paymentState,
  maxAmountMicros: calls.maxAmountMicros,
  createdAt: calls.createdAt,
  endedAt: calls.endedAt,
};

export async function GET(request: Request) {
  try {
    const client = await authenticateApiRequest(request);
    const cursor = new URL(request.url).searchParams.get("before");
    const createdBefore = cursor ? new Date(cursor) : undefined;
    if (createdBefore && Number.isNaN(createdBefore.getTime()))
      throw new ApiError(400, "`before` must be an ISO-8601 timestamp");

    const rows = await database()
      .select(callSummary)
      .from(calls)
      .where(
        and(
          eq(calls.clientId, client.id),
          isNull(calls.deletedAt),
          ...(createdBefore ? [lt(calls.createdAt, createdBefore)] : []),
        ),
      )
      .orderBy(desc(calls.createdAt))
      .limit(PAGE_SIZE);

    const nextCursor =
      rows.length === PAGE_SIZE
        ? rows[rows.length - 1]?.createdAt.toISOString()
        : null;
    return Response.json({ data: rows, nextCursor });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (request.headers.get("x-agentcaller-funding") === "stripe_postpaid") {
    try {
      if (
        request.headers.has("payment-signature") ||
        request.headers.has("x-payment")
      )
        throw new ApiError(422, "Choose one payment method");
      return Response.json(
        {
          data: await reserveStripeCall(
            await authenticateBillingPrincipal(request),
            request.headers.get("idempotency-key") ?? "",
            await request.json(),
          ),
        },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof BillingSetupRequired)
        return Response.json(
          { error: "billing_setup_required", ...error.setup },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      return billingErrorResponse(error);
    }
  }
  try {
    return await submitCall(request, await authenticateApiRequest(request));
  } catch (error) {
    return errorResponse(error);
  }
}
