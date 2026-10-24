import { timingSafeCompare } from "@/lib/auth";
import { getCronEnv } from "@/lib/env";
import { drainConnectJobs } from "@/lib/connect-scheduler";
import { isStripeBillingEnabled } from "@/lib/env";
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
      paidCallingEnabled: isStripeBillingEnabled(),
    });
  } catch (error) {
    logConnectFailure("drain", error);
    return Response.json(
      { error: "Scheduler drain failed; check platform logs" },
      { status: 500 },
    );
  }
}

export const GET = POST;
