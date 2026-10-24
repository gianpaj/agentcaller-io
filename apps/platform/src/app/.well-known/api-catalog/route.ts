export const dynamic = "force-static";

export function GET() {
  return Response.json(
    {
      linkset: [
        {
          anchor: "https://agentcaller.io/api/v1/calls",
          "service-desc": [
            {
              href: "https://agentcaller.io/openapi.json",
              type: "application/json",
            },
          ],
          "service-doc": [
            { href: "https://docs.agentcaller.io", type: "text/html" },
          ],
          status: [
            {
              href: "https://agentcaller.io/api/health",
              type: "application/json",
            },
          ],
        },
      ],
    },
    {
      headers: {
        "Content-Type":
          'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
      },
    },
  );
}
