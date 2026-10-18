import { ApiError } from "@/lib/auth";
import { authenticateMcpPrincipal } from "@/lib/mcp-auth";
import {
  getMcpConfig,
  isMcpEnabled,
  mcpChallenge,
  validateMcpOrigin,
} from "@/lib/mcp-config";
import { createAgentMcpHandler } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
  let config;
  try {
    if (!isMcpEnabled()) throw new Error("Disabled");
    config = getMcpConfig();
  } catch {
    return Response.json(
      { error: "MCP onboarding is not configured" },
      { status: 503, headers },
    );
  }
  if (!validateMcpOrigin(request, config))
    return Response.json(
      { error: "Untrusted MCP origin" },
      { status: 403, headers },
    );
  const origin = request.headers.get("origin");
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Expose-Headers"] =
      "WWW-Authenticate, MCP-Protocol-Version";
    headers.Vary = "Origin";
  }
  if (request.method === "OPTIONS") {
    const requested =
      request.headers.get("access-control-request-headers") ?? "";
    if (
      requested
        .split(",")
        .filter(Boolean)
        .some(
          (name) =>
            !/^(authorization|content-type|mcp-[a-z0-9-]+)$/i.test(name.trim()),
        )
    )
      return new Response(null, { status: 403, headers });
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": requested,
        Vary: "Origin, Access-Control-Request-Headers",
      },
    });
  }
  try {
    const principal = await authenticateMcpPrincipal(request, config);
    if (request.method !== "POST")
      return new Response(null, {
        status: 405,
        headers: { ...headers, Allow: "POST" },
      });
    const handler = createAgentMcpHandler(principal);
    try {
      const response = await handler.fetch(request);
      for (const [name, value] of Object.entries(headers))
        response.headers.set(name, value);
      return response;
    } finally {
      await handler.close();
    }
  } catch (error) {
    if (error instanceof ApiError)
      return Response.json(
        { error: error.message },
        {
          status: error.status,
          headers: {
            ...headers,
            ...(error.status === 401
              ? {
                  "WWW-Authenticate": mcpChallenge(
                    config,
                    request.headers.has("authorization"),
                  ),
                }
              : {}),
          },
        },
      );
    // OAuth failures can contain tokens or provider details. Return only a safe code.
    return Response.json(
      { error: "MCP request unavailable" },
      { status: 503, headers },
    );
  }
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
