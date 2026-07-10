import { timingSafeCompare } from "@/lib/auth";
import { deliverPendingWebhooks } from "@/lib/webhooks";
import { getServerEnv } from "@/lib/env";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!timingSafeCompare(authorization, `Bearer ${getServerEnv().CRON_SECRET}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(await deliverPendingWebhooks());
}
