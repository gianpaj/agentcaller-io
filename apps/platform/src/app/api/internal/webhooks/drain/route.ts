import { deliverPendingWebhooks } from "@/lib/webhooks";
import { getServerEnv } from "@/lib/env";

export async function POST(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${getServerEnv().CRON_SECRET}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ delivered: await deliverPendingWebhooks() });
}
