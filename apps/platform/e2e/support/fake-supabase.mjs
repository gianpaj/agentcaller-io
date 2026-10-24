import { randomUUID, createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT, jwtVerify } from "jose";

const json = (body, status = 200) => Response.json(body, { status });

/** Only the issuer interactions used by our application; not a Supabase emulator. */
export async function createIdentityFake(appUrl, origin) {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "e2e-key",
    alg: "ES256",
    use: "sig",
  };
  let human, authorization, agentCode;
  const codes = new Map();
  const users = new Map();
  async function token(user, agent = false, overrides = {}) {
    return new SignJWT({
      role: "authenticated",
      email: user.email,
      aal: "aal1",
      session_id: randomUUID(),
      ...(agent ? { client_id: authorization.client.id } : {}),
      ...overrides,
    })
      .setProtectedHeader({ alg: "ES256", kid: jwk.kid })
      .setIssuer(origin() + "/auth/v1")
      .setSubject(user.id)
      .setAudience(agent ? appUrl + "/mcp" : "authenticated")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  }
  function newHuman() {
    const id = randomUUID();
    human = {
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
    users.set(id, human);
    return human;
  }
  function prepare() {
    authorization = {
      authorization_id: randomUUID(),
      redirect_uri: origin() + "/agent/callback",
      client: { id: randomUUID(), name: "E2E agent" },
      user: { id: human.id },
      scope: "openid",
      approved: false,
    };
    return snapshot();
  }
  function snapshot() {
    return {
      userId: human.id,
      email: human.email,
      authorizationId: authorization.authorization_id,
      clientId: authorization.client.id,
      consentUrl:
        appUrl +
        "/oauth/consent?authorization_id=" +
        authorization.authorization_id,
      approved: authorization.approved,
      agentCode,
    };
  }
  function reset() {
    users.clear();
    codes.clear();
    agentCode = undefined;
    newHuman();
    return prepare();
  }
  reset();
  return {
    reset,
    snapshot,
    async control(action, input = {}) {
      if (action === "new-human") {
        newHuman();
        return prepare();
      }
      if (action === "prepare") return prepare();
      if (action === "token") {
        if (!authorization.approved)
          throw new Error("Issuer has no approved agent authorization");
        return {
          access_token: await token(
            users.get(input.userId ?? human.id),
            true,
            input.claims,
          ),
        };
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
        codes.set(code, {
          user: human,
          challenge: url.searchParams.get("code_challenge"),
        });
        callback.searchParams.set("code", code);
        return Response.redirect(callback, 302);
      }
      if (path === "/auth/v1/token") {
        const body = await request.json();
        const entry = codes.get(body.auth_code);
        codes.delete(body.auth_code);
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
        if (
          !agentCode ||
          body.code !== agentCode ||
          body.client_id !== authorization.client.id ||
          !authorization.approved
        )
          return json({ error: "invalid_grant" }, 400);
        agentCode = undefined;
        return json({
          access_token: await token(users.get(authorization.user.id), true),
          refresh_token: randomUUID(),
          token_type: "bearer",
          expires_in: 3600,
        });
      }
      if (path === "/agent/callback")
        return new Response("<h1>Agent connected</h1>", {
          headers: { "content-type": "text/html" },
        });
      let claims;
      try {
        ({ payload: claims } = await jwtVerify(
          (request.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
          publicKey,
        ));
      } catch {
        return json({ message: "Invalid test session" }, 401);
      }
      const user = users.get(claims.sub);
      if (!user) return json({ message: "Unknown test human" }, 401);
      if (path === "/auth/v1/user") return json(user);
      if (path === "/auth/v1/logout") return json({});
      if (
        path ===
        "/auth/v1/oauth/authorizations/" + authorization.authorization_id
      )
        return json({ ...authorization, user: { id: user.id } });
      if (
        path ===
        "/auth/v1/oauth/authorizations/" +
          authorization.authorization_id +
          "/consent"
      ) {
        const body = await request.json();
        authorization.approved = body.action === "approve";
        const callback = new URL(authorization.redirect_uri);
        if (authorization.approved) {
          agentCode = randomUUID();
          callback.searchParams.set("code", agentCode);
        } else callback.searchParams.set("error", "access_denied");
        return json({ redirect_url: callback.href });
      }
      if (path.startsWith("/auth/v1/user/oauth/grants/")) return json({});
      return json({ error: "Unsupported identity fixture request", path }, 501);
    },
  };
}
