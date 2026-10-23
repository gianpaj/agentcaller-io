import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel packages its own runtime output. Standalone output is for
  // self-hosted deployments and conflicts with Vercel's Next.js adapter.
  output: process.env.VERCEL ? undefined : "standalone",
  serverExternalPackages: ["postgres"],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          {
            key: "Link",
            value: [
              '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
              '</openapi.json>; rel="service-desc"; type="application/json"',
              '<https://docs.agentcaller.io/docs>; rel="service-doc"; type="text/html"',
              '</auth.md>; rel="describedby"; type="text/markdown"',
            ].join(", "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
