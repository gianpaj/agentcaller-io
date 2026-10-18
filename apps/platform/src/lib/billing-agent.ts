import type { AgentPrincipal } from "@agentcaller/contracts";
import { calls, billingCallUsage } from "@agentcaller/database";
import { and, eq } from "drizzle-orm";
import { ApiError } from "./auth";
import { database } from "./database";
import { lockAgentConnection } from "./billing-store";
export async function getAgentCallStatus(
  principal: AgentPrincipal,
  id: string,
  db = database(),
) {
  await db.transaction((tx) =>
    lockAgentConnection(tx, principal, "calls:read"),
  );
  const [row] = await db
    .select({
      id: calls.id,
      state: calls.state,
      paymentState: calls.paymentState,
      scheduledFor: calls.scheduledFor,
      endedAt: calls.endedAt,
      outcome: calls.outcome,
      usageState: billingCallUsage.state,
      finalCents: billingCallUsage.finalCents,
    })
    .from(calls)
    .innerJoin(billingCallUsage, eq(billingCallUsage.callReference, calls.id))
    .where(
      and(
        eq(calls.id, id),
        eq(calls.clientId, principal.clientId),
        eq(billingCallUsage.connectionId, principal.connectionId!),
      ),
    );
  if (!row) throw new ApiError(404, "Call not found for this integration");
  return row;
}
