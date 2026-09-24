import { timingSafeCompare } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { drainConnectJobs } from "@/lib/connect-scheduler";
import { CONNECT_PAYMENT_BLOCKER } from "@/lib/connect-policy";
export async function POST(request: Request) {
  if (
    !timingSafeCompare(
      request.headers.get("authorization"),
      `Bearer ${getServerEnv().CRON_SECRET}`,
    )
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({
    ...(await drainConnectJobs()),
    paidJobsBlocked: CONNECT_PAYMENT_BLOCKER,
  });
}
