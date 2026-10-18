import { agentConnections } from "@agentcaller/database";
import { eq } from "drizzle-orm";
import { database } from "@/lib/database";
import { ensureClientProfileForUser, requireHumanSession } from "@/lib/portal";
import { disconnectAgent } from "./actions";

export default async function ConnectionsPage() {
  const { user } = await requireHumanSession();
  const profile = await ensureClientProfileForUser(user.id);
  const connections = await database()
    .select()
    .from(agentConnections)
    .where(eq(agentConnections.clientId, profile.id));
  return (
    <section className="grid gap-6">
      <h1 className="text-3xl font-semibold">Connected integrations</h1>
      <p>
        Tool access and permission to spend are separate. Paid calling is
        unavailable during setup.
      </p>
      {connections.length === 0 && <p>No integrations connected.</p>}
      {connections.map((connection) => (
        <article
          key={connection.id}
          className="grid gap-3 rounded-md border border-(--line) p-5"
        >
          <h2 className="text-xl font-semibold">{connection.name}</h2>
          <p>
            {connection.status === "active"
              ? "Tool access allowed"
              : "Disconnected"}
          </p>
          {connection.status === "active" && (
            <form action={disconnectAgent}>
              <input type="hidden" name="connection_id" value={connection.id} />
              <button
                className="min-h-12 rounded-md border border-(--line) px-4 py-3"
                type="submit"
              >
                Disconnect
              </button>
            </form>
          )}
        </article>
      ))}
    </section>
  );
}
