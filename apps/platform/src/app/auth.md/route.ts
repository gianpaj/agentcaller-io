export const dynamic = "force-static";

const authMarkdown = `# AgentCaller auth.md

AgentCaller serves AI agents and applications that place bounded calls through
https://agentcaller.io/api/v1/calls. The service is a pre-production prototype;
access requires an enabled client profile and an operator-provisioned API key.

## Obtain credentials

Supported registration method: manual provisioning by an AgentCaller operator.
Ask your deployment operator to create or enable your client profile, provision
an API key for that profile, and deliver the key through a private channel.
There is no public registration or API-key issuance endpoint. Agents cannot
register anonymously or obtain credentials automatically.

Human users can sign in at https://agentcaller.io/login. Portal sign-in requires
an operator to link the verified identity to a client profile and does not issue
an API key.

## Use credentials

API keys begin with \`ac_\`. Send your key in the HTTP Authorization header on
requests to the call API:

\`\`\`http
GET /api/v1/calls HTTP/1.1
Host: agentcaller.io
Authorization: Bearer <your-ac_-prefixed-api-key>
\`\`\`

The key identifies the client that owns the calls. Unknown or revoked keys and
keys belonging to disabled clients return HTTP 401. Keep the key private; do not
put it in a URL. Ask the operator to revoke or replace a key when needed.
Authentication alone does not authorize a call: task, destination, funding, and
call limits must also pass validation.

## OAuth and automated registration

The call API uses API keys and does not implement OAuth access tokens or
automated agent registration. It does not publish OAuth Protected Resource
Metadata or OAuth Authorization Server metadata for this API.

API documentation: https://docs.agentcaller.io
`;

export function GET() {
  return new Response(authMarkdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
