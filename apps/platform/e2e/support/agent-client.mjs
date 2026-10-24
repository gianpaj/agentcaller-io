import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";

export async function agentRequest(token, method, params = {}) {
  const response = await fetch(process.env.NEXT_PUBLIC_APP_URL + "/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "MCP-Method": method,
      ...(params.name ? { "Mcp-Name": params.name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
          [CLIENT_INFO_META_KEY]: { name: "e2e-agent", version: "1" },
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    }),
  });
  const body = await response.json();
  if (!response.ok || body.error)
    throw new Error(
      "Agent request rejected: " +
        response.status +
        " " +
        JSON.stringify(body.error ?? body),
    );
  return body.result;
}
export async function callTool(token, name, args = {}) {
  const result = await agentRequest(token, "tools/call", {
    name,
    arguments: args,
  });
  const detail = result.structuredContent ?? JSON.parse(result.content[0].text);
  return { ...detail, ...(result.isError ? { isError: true } : {}) };
}
