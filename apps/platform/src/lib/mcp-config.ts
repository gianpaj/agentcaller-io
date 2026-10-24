import { z } from "zod";
import { getSupabaseEnv } from "./env";

type Environment = Record<string, string | undefined>;

function trustedUrl(value: string) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "MCP URLs require HTTPS, or HTTP on loopback, without credentials, query or fragment",
    );
  return url;
}

export function isMcpEnabled(env: Environment = process.env) {
  return (
    z.enum(["true", "false"]).default("false").parse(env.MCP_ENABLED) === "true"
  );
}

export function getMcpConfig(env: Environment = process.env) {
  const origin = trustedUrl(z.string().min(1).parse(env.NEXT_PUBLIC_APP_URL));
  if (origin.pathname !== "/")
    throw new Error("NEXT_PUBLIC_APP_URL must be an origin");
  const supabase = trustedUrl(getSupabaseEnv(env).SUPABASE_URL);
  if (supabase.pathname !== "/")
    throw new Error("SUPABASE_URL must be an origin");
  const resource = new URL("/mcp", origin).href;
  const issuer = new URL("/auth/v1", supabase).href;
  const allowedOrigins = [
    origin.origin,
    ...(env.MCP_ALLOWED_ORIGINS?.split(",")
      .filter(Boolean)
      .map((value) => {
        const url = trustedUrl(value.trim());
        if (url.pathname !== "/")
          throw new Error("MCP_ALLOWED_ORIGINS must contain origins");
        return url.origin;
      }) ?? []),
  ];
  return {
    resource,
    issuer,
    allowedOrigins,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    metadataUrl: new URL("/.well-known/oauth-protected-resource/mcp", origin)
      .href,
  };
}
export type McpConfig = ReturnType<typeof getMcpConfig>;

export function mcpResourceMetadata(config = getMcpConfig()) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    resource_name: "AgentCaller",
  };
}

export function mcpChallenge(config: McpConfig, invalidToken = false) {
  return `Bearer resource_metadata="${config.metadataUrl}"${invalidToken ? ', error="invalid_token"' : ""}`;
}

export function validateMcpOrigin(request: Request, config: McpConfig) {
  const url = new URL(request.url);
  const expected = new URL(config.resource);
  const host = request.headers.get("host");
  if (
    url.origin !== expected.origin ||
    (host !== null && host !== expected.host)
  )
    return false;
  const origin = request.headers.get("origin");
  return origin === null || config.allowedOrigins.includes(origin);
}
