import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel packages its own runtime output. Standalone output is for
  // self-hosted deployments and conflicts with Vercel's Next.js adapter.
  output: process.env.VERCEL ? undefined : "standalone",
  async headers() {
    return [
      {
        source: "/billing/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
