import { randomUUID, createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT, jwtVerify } from "jose";

const json = (body, status = 200) => Response.json(body, { status });

/** The issuer interactions this application uses; not a Supabase emulator. */
export async function createIdentityFake(appUrl, origin) {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "e2e-key",
    alg: "ES256",
    use: "sig",
  };
  const users = new Map();
  const authorizations = new Map();
  const loginCodes = new Map();
  const agentCodes = new Map();
  const refreshTokens = new Map();
  const revokedGrants = new Set();
  let selectedHuman, currentAuthorization;
  const grantKey = (userId, clientId) => userId + ":" + clientId;

  async function token(user, authorization, overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: origin() + "/auth/v1",
      sub: user.id,
      aud: authorization ? appUrl + "/mcp" : "authenticated",
      role: "authenticated",
      email: user.email,
      aal: "aal1",
      session_id: randomUUID(),
      iat: now,
      exp: now + 3600,
      ...(authorization ? { client_id: authorization.client.id } : {}),
      ...overrides,
    })
      .setProtectedHeader({ alg: "ES256", kid: jwk.kid })
      .sign(privateKey);
  }
  function newHuman() {
    const id = randomUUID();
    selectedHuman = {
      id,
      email: id + "@example.test",
      email_confirmed_at: new Date().toISOString(),
      aud: "authenticated",
      role: "authenticated",
      created_at: new Date().toISOString(),
      app_metadata: { provider: "github", providers: ["github"] },
      user_metadata: {},
      identities: [],
      is_anonymous: false,
    };
    users.set(id, selectedHuman);
    return selectedHuman;
  }
  function prepare(input = {}) {
    const user = users.get(input.userId ?? selectedHuman.id);
    if (!user) throw new Error("Unknown fixture human");
    currentAuthorization = {
      authorization_id: randomUUID(),
      redirect_uri: origin() + "/agent/callback",
      client: {
        id: input.clientId ?? randomUUID(),
        name: input.name ?? "E2E agent",
      },
      user: { id: user.id },
      scope: "openid",
      approved: false,
    };
    authorizations.set(
      currentAuthorization.authorization_id,
      currentAuthorization,
    );
    return snapshot();
  }
  function snapshot() {
    const owner = users.get(currentAuthorization.user.id);
    return {
      userId: owner.id,
      selectedUserId: selectedHuman.id,
      email: owner.email,
      authorizationId: currentAuthorization.authorization_id,
      clientId: currentAuthorization.client.id,
      consentUrl:
        appUrl +
        "/oauth/consent?authorization_id=" +
        currentAuthorization.authorization_id,
      approved: currentAuthorization.approved,
      revokedGrants: [...revokedGrants],
    };
  }
  function reset() {
    for (const map of [
      users,
      authorizations,
      loginCodes,
      agentCodes,
      refreshTokens,
    ])
      map.clear();
    revokedGrants.clear();
    newHuman();
    return prepare();
  }
  async function agentSession(authorization) {
    const refresh = randomUUID();
    refreshTokens.set(refresh, authorization);
    return {
      access_token: await token(
        users.get(authorization.user.id),
        authorization,
      ),
      refresh_token: refresh,
      token_type: "bearer",
      expires_in: 3600,
    };
  }
  reset();
  return {
    reset,
    snapshot,
    async control(action, input = {}) {
      if (action === "new-human") {
        newHuman();
        return prepare(input);
      }
      if (action === "prepare") return prepare(input);
      if (action === "select-human") {
        selectedHuman = users.get(input.userId);
        if (!selectedHuman) throw new Error("Unknown fixture human");
        return snapshot();
      }
      if (action === "token") {
        const authorization = authorizations.get(
          input.authorizationId ?? currentAuthorization.authorization_id,
        );
        if (!authorization?.approved)
          throw new Error("Issuer has no approved agent authorization");
        const user = users.get(input.userId ?? authorization.user.id);
        if (!user) throw new Error("Unknown fixture human");
        return { access_token: await token(user, authorization, input.claims) };
      }
      throw new Error("Unknown identity fixture operation");
    },
    async handle(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === "/auth/v1/.well-known/jwks.json")
        return json({ keys: [jwk] });
      if (path === "/.well-known/oauth-authorization-server/auth/v1")
        return json({
          issuer: origin() + "/auth/v1",
          authorization_endpoint: origin() + "/auth/v1/oauth/authorize",
          token_endpoint: origin() + "/auth/v1/oauth/token",
          jwks_uri: origin() + "/auth/v1/.well-known/jwks.json",
        });
      if (path === "/auth/v1/authorize") {
        const callback = new URL(url.searchParams.get("redirect_to"));
        if (
          callback.origin !== appUrl ||
          callback.pathname !== "/auth/callback"
        )
          return json({ error: "bad_redirect" }, 400);
        const code = randomUUID();
        loginCodes.set(code, {
          user: selectedHuman,
          challenge: url.searchParams.get("code_challenge"),
        });
        callback.searchParams.set("code", code);
        return Response.redirect(callback, 302);
      }
      if (path === "/auth/v1/token") {
        const body = await request.json();
        const entry = loginCodes.get(body.auth_code);
        loginCodes.delete(body.auth_code);
        if (
          !entry ||
          createHash("sha256")
            .update(body.code_verifier ?? "")
            .digest("base64url") !== entry.challenge
        )
          return json({ error: "invalid_grant" }, 400);
        return json({
          access_token: await token(entry.user),
          refresh_token: randomUUID(),
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: entry.user,
        });
      }
      if (path === "/auth/v1/oauth/token") {
        const body = request.headers
          .get("content-type")
          ?.includes("application/json")
          ? await request.json()
          : Object.fromEntries(new URLSearchParams(await request.text()));
        let authorization;
        if (body.grant_type === "refresh_token") {
          authorization = refreshTokens.get(body.refresh_token);
          refreshTokens.delete(body.refresh_token);
        } else {
          authorization = agentCodes.get(body.code);
          agentCodes.delete(body.code);
        }
        if (
          !authorization?.approved ||
          body.client_id !== authorization.client.id ||
          revokedGrants.has(
            grantKey(authorization.user.id, authorization.client.id),
          )
        )
          return json({ error: "invalid_grant" }, 400);
        return json(await agentSession(authorization));
      }
      if (path === "/agent/callback")
        return new Response(
          url.searchParams.has("error")
            ? "<h1>Agent connection denied</h1>"
            : "<h1>Agent connected</h1>",
          { headers: { "content-type": "text/html" } },
        );
      let claims;
      try {
        ({ payload: claims } = await jwtVerify(
          (request.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
          publicKey,
          { issuer: origin() + "/auth/v1" },
        ));
      } catch {
        return json({ message: "Invalid test session" }, 401);
      }
      const user = users.get(claims.sub);
      if (!user) return json({ message: "Unknown test human" }, 401);
      if (path === "/auth/v1/user") return json(user);
      if (path === "/auth/v1/logout") return json({});
      if (
        path === "/auth/v1/user/oauth/grants" &&
        request.method === "DELETE"
      ) {
        if (claims.client_id)
          return json({ message: "Human session required" }, 403);
        revokedGrants.add(grantKey(user.id, url.searchParams.get("client_id")));
        return new Response(null, { status: 204 });
      }
      const match = path.match(
        /^\/auth\/v1\/oauth\/authorizations\/([^/]+)(\/consent)?$/,
      );
      if (match) {
        const authorization = authorizations.get(match[1]);
        if (!authorization)
          return json({ message: "Unknown authorization" }, 404);
        if (claims.client_id || authorization.user.id !== user.id)
          return json(
            { message: "Authorization belongs to another human" },
            403,
          );
        if (!match[2]) return json(authorization);
        const body = await request.json();
        authorization.approved = body.action === "approve";
        const callback = new URL(authorization.redirect_uri);
        if (authorization.approved) {
          revokedGrants.delete(grantKey(user.id, authorization.client.id));
          const code = randomUUID();
          agentCodes.set(code, authorization);
          callback.searchParams.set("code", code);
        } else callback.searchParams.set("error", "access_denied");
        return json({ redirect_url: callback.href });
      }
      return json({ error: "Unsupported identity fixture request", path }, 501);
    },
  };
}
