import {
  getMcpConfig,
  isMcpEnabled,
  mcpResourceMetadata,
} from "@/lib/mcp-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    if (!isMcpEnabled()) throw new Error("Disabled");
    return Response.json(mcpResourceMetadata(getMcpConfig()), {
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return Response.json(
      { error: "MCP onboarding is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
