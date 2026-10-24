export const dynamic = "force-static";

const authMarkdown = `# AgentCaller auth.md

AgentCaller serves AI agents and applications that place bounded calls through
https://agentcaller.io/api/v1/calls and the optional https://agentcaller.io/mcp
endpoint. The service is a pre-production prototype. Paid calling remains
disabled pending release acceptance.

## API-key access

Supported method: manual provisioning by an AgentCaller operator. Ask your
deployment operator to provision an API key for your enabled client profile
and deliver it through a private channel. Portal sign-in does not issue API
keys. There is no public API-key issuance endpoint.

API keys begin with \`ac_\`. Send your key in the HTTP Authorization header on
API-key requests:

\`\`\`http
GET /api/v1/calls HTTP/1.1
Host: agentcaller.io
Authorization: Bearer <your-ac_-prefixed-api-key>
\`\`\`

The key identifies the client that owns the calls. Unknown or revoked keys and
keys belonging to disabled clients return HTTP 401. Keep the key private; do not
put it in a URL. Ask the operator to revoke or replace a key when needed.

## Human-approved OAuth access

MCP onboarding requires deployment configuration and \`MCP_ENABLED=true\`.
It is disabled by default. The MCP transport and its Protected Resource Metadata
endpoint return HTTP 503 when onboarding is disabled or unconfigured.

On an enabled deployment, start with
https://agentcaller.io/.well-known/oauth-protected-resource/mcp. Read its
\`authorization_servers\` entry to discover the configured Supabase OAuth
issuer and its authorization-server metadata. Use authorization code with PKCE
and a client registration supported by that issuer. The human signs in at
https://agentcaller.io/login and approves tool access at the issuer-directed
https://agentcaller.io/oauth/consent flow. Approval can provision a client
profile for the verified human without an operator-created profile or copied
API key. Disabled profiles remain disabled.

Present the issued token in \`Authorization: Bearer <access-token>\`. The token
must have the configured issuer, OAuth client identity, verified human subject,
and the exact MCP resource audience: https://agentcaller.io/mcp for this origin.
Generic browser session tokens are not accepted as delegated API credentials.
Issuer resource binding and compatibility with a target MCP host still require
deployment acceptance tests.

Resource-bound OAuth supports the MCP tools, billing endpoints, call quotes,
\`stripe_postpaid\` call creation, and reading or cancelling the integration's
own calls. Listing calls, deleting calls, transcripts, recordings, and legacy
x402 or operator-funded creation require an API key. See the
[MCP onboarding guide](https://docs.agentcaller.io/mcp) for configuration,
connection, and revocation instructions.

## Spending and registration limits

Human tool-access consent does not approve spending or save a payment card.
Those steps require separate human approval. An API key must be explicitly
linked to an owned integration before it can spend. See
[saved-card billing](https://docs.agentcaller.io/billing) for enrollment
and release gates. Authentication alone does not authorize a call: task,
destination, funding, and call limits must also pass validation.

AgentCaller does not offer autonomous agent registration, anonymous credential
issuance, or an Auth.md \`agent_auth\` registration extension. OAuth access
requires the human connection flow above.

API documentation: https://docs.agentcaller.io
`;

export function GET() {
  return new Response(authMarkdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
