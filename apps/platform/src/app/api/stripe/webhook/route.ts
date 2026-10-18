import { ApiError } from "@/lib/auth";
import { verifyStripeEvent, receiveStripeEvent } from "@/lib/stripe-events";

export const runtime = "nodejs";

async function rawBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Stripe event body is required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return Buffer.concat(chunks, length);
      length += chunk.value.length;
      if (length > 1_048_576) {
        await reader.cancel();
        throw new ApiError(413, "Stripe event is too large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  try {
    const event = verifyStripeEvent(
      await rawBody(request),
      request.headers.get("stripe-signature"),
    );
    await receiveStripeEvent(event);
    return Response.json(
      { received: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    // Keep payment payloads, signatures and provider/configuration errors out of logs.
    return Response.json(
      {
        error:
          status < 500 && error instanceof ApiError
            ? error.message
            : "Stripe event could not be recorded",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
