import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT, type JWTPayload } from "jose";
import {
  getMcpConfig,
  isMcpEnabled,
  mcpResourceMetadata,
  validateMcpOrigin,
} from "./mcp-config";
import { verifyMcpToken, authenticateMcpPrincipal } from "./mcp-auth";

const config = getMcpConfig({
  NEXT_PUBLIC_APP_URL: "https://agentcaller.example",
  SUPABASE_URL: "https://issuer.example",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable",
});
const now = new Date("2026-10-18T12:00:00Z");
const timestamp = now.getTime() / 1000;
const claims = {
  iss: config.issuer,
  aud: config.resource,
  sub: "11111111-1111-4111-8111-111111111111",
  client_id: "22222222-2222-4222-8222-222222222222",
  role: "authenticated",
  exp: timestamp + 300,
  iat: timestamp - 60,
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  keys = await generateKeyPair("ES256");
});
afterEach(() => {
  vi.useRealTimers();
});
async function token(overrides: JWTPayload = {}) {
  return new SignJWT({ ...claims, ...overrides })
    .setProtectedHeader({ alg: "ES256" })
    .sign(keys.privateKey);
}

describe("MCP OAuth resource boundary", () => {
  it("accepts the signed subject/client tuple for this resource", async () => {
    expect(
      await verifyMcpToken(await token(), config, () => keys.publicKey, now),
    ).toMatchObject({ sub: claims.sub, client_id: claims.client_id });
  });
  it.each([
    { aud: "authenticated" },
    { aud: "https://other.example/mcp" },
    { iss: "https://other.example/auth/v1" },
    { exp: timestamp },
    { exp: undefined },
    { client_id: undefined },
    { client_id: "claimed-client" },
    { sub: "claimed-human" },
    { iat: timestamp + 61 },
    { iat: undefined },
    { role: "service_role" },
    { nbf: timestamp + 30 },
  ])("rejects invalid token claims %j", async (overrides) => {
    await expect(
      verifyMcpToken(await token(overrides), config, () => keys.publicKey, now),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("tolerates small issuer clock skew in the issue time", async () => {
    expect(
      await verifyMcpToken(
        await token({ iat: timestamp + 30 }),
        config,
        () => keys.publicKey,
        now,
      ),
    ).toMatchObject({ sub: claims.sub });
  });
  it.each([
    [30, true],
    [90, false],
  ])(
    "compares issue time to consent with skew tolerance (consent %is later)",
    async (consentDelay, accepted) => {
      vi.useFakeTimers({ toFake: ["Date"], now });
      const connection = {
        id: "connection",
        clientId: "own-profile",
        operations: ["billing:read"],
        revokedAt: null,
        consentedAt: new Date((claims.iat + consentDelay) * 1000),
      };
      const chain = {
        select: () => chain,
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        limit: async () => [{ connection }],
      };
      const result = authenticateMcpPrincipal(
        new Request(config.resource, {
          headers: { authorization: `Bearer ${await token()}` },
        }),
        config,
        chain as never,
        () => keys.publicKey,
      );
      if (accepted)
        await expect(result).resolves.toMatchObject({
          connectionId: "connection",
        });
      else await expect(result).rejects.toMatchObject({ status: 403 });
    },
  );
  it("rejects a token signed by another key", async () => {
    const other = await generateKeyPair("ES256");
    await expect(
      verifyMcpToken(await token(), config, () => other.publicKey, now),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("rejects an API key or missing credential before querying a database", async () => {
    await expect(
      authenticateMcpPrincipal(new Request(config.resource), config),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateMcpPrincipal(
        new Request(config.resource, {
          headers: { authorization: "Bearer ac_synthetic" },
        }),
        config,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("MCP deployment configuration", () => {
  it("defaults off and publishes only configured identity", () => {
    expect(isMcpEnabled({})).toBe(false);
    expect(() => isMcpEnabled({ MCP_ENABLED: "yes" })).toThrow();
    expect(mcpResourceMetadata(config)).toMatchObject({
      resource: config.resource,
      authorization_servers: [config.issuer],
    });
  });
  it.each([
    "http://public.example",
    "https://user:password@example.test",
    "https://example.test/path",
    "https://example.test/?token=secret",
  ])("rejects an unsafe canonical URL %s", (url) => {
    expect(() =>
      getMcpConfig({
        NEXT_PUBLIC_APP_URL: url,
        SUPABASE_URL: "https://issuer.example",
        SUPABASE_PUBLISHABLE_KEY: "test",
      }),
    ).toThrow();
  });
  it("allows loopback development and pins both Host and Origin", () => {
    expect(
      getMcpConfig({
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        SUPABASE_URL: "http://localhost:54321",
        SUPABASE_PUBLISHABLE_KEY: "test",
      }).resource,
    ).toBe("http://localhost:3000/mcp");
    expect(validateMcpOrigin(new Request(config.resource), config)).toBe(true);
    expect(
      validateMcpOrigin(
        new Request(config.resource, {
          headers: { origin: "https://attacker.example" },
        }),
        config,
      ),
    ).toBe(false);
    expect(
      validateMcpOrigin(
        new Request(config.resource, { headers: { host: "attacker.example" } }),
        config,
      ),
    ).toBe(false);
    expect(
      validateMcpOrigin(new Request("https://attacker.example/mcp"), config),
    ).toBe(false);
  });
});
