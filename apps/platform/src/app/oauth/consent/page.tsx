import { redirect } from "next/navigation";
import { authorizationIdSchema } from "@agentcaller/contracts";
import { ApiError } from "@/lib/auth";
import { getLoginUrl } from "@/lib/auth-redirect";
import { isMcpEnabled } from "@/lib/mcp-config";
import { issuerRedirect, verifyOAuthAuthorization } from "@/lib/oauth-consent";
import { requireHumanSession } from "@/lib/portal";
import { decideOAuthConsent } from "./actions";

export const dynamic = "force-dynamic";

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const id = authorizationIdSchema.safeParse(
    (await searchParams).authorization_id,
  );
  if (!isMcpEnabled() || !id.success)
    return (
      <main className="p-8">
        <h1>Connection unavailable</h1>
        <p>Start a new connection from your agent.</p>
      </main>
    );
  let session;
  try {
    session = await requireHumanSession();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect(getLoginUrl(`/oauth/consent?authorization_id=${id.data}`));
    throw error;
  }
  const { data, error } =
    await session.supabase.auth.oauth.getAuthorizationDetails(id.data);
  if (error || !data)
    return (
      <main className="p-8">
        <h1>Connection expired</h1>
        <p>Start a new connection from your agent.</p>
      </main>
    );
  if ("redirect_url" in data) redirect(issuerRedirect(data.redirect_url));
  const details = verifyOAuthAuthorization(data, session.user.id, id.data);
  return (
    <main className="mx-auto grid min-h-svh max-w-lg content-center gap-6 px-6 py-12 font-sans text-(--ink)">
      <h1 className="text-3xl font-semibold">Connect {details.client.name}</h1>
      <p>
        Signed in as {session.user.email}. The integration name is supplied by
        its developer.
      </p>
      <p>
        This integration can request calls, read its call results, and start
        billing setup. Calling requires your separate spending approval and a
        saved card.
      </p>
      <p>
        Requested identity access: {details.scope || "Basic authentication"}.
      </p>
      <p>Return address: {new URL(details.redirect_uri).origin}</p>
      <form action={decideOAuthConsent} className="grid gap-4">
        <input type="hidden" name="authorization_id" value={id.data} />
        <label className="flex gap-3">
          <input type="checkbox" name="consent" value="yes" />
          Allow this integration to use these tools. This does not approve
          charges.
        </label>
        <button
          type="submit"
          name="decision"
          value="approve"
          className="min-h-12 rounded-md bg-(--signal) px-4 py-3 font-semibold text-(--void)"
        >
          Allow tool access
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          className="min-h-12 rounded-md border border-(--line) px-4 py-3"
        >
          Deny
        </button>
      </form>
    </main>
  );
}
