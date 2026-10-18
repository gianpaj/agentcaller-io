import { timingSafeCompare } from "@/lib/auth";
import { getCronEnv } from "@/lib/env";
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
