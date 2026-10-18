import { timingSafeCompare } from "@/lib/auth";
import { getCronEnv } from "@/lib/env";
import { drainConnectJobs } from "@/lib/connect-scheduler";
import { CONNECT_PAYMENT_BLOCKER } from "@/lib/connect-policy";
import { logConnectFailure } from "@/lib/connect-log";
export async function POST(request: Request) {
  try {
    if (
      !timingSafeCompare(
        request.headers.get("authorization"),
        `Bearer ${getCronEnv().CRON_SECRET}`,
      )
    )
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    return Response.json({
      ...(await drainConnectJobs()),
      paidJobsBlocked: CONNECT_PAYMENT_BLOCKER,
    });
  } catch (error) {
    logConnectFailure("drain", error);
    return Response.json(
      { error: "Scheduler drain failed; check platform logs" },
      { status: 500 },
    );
  }
}
