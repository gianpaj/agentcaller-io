import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel packages its own runtime output. Standalone output is for
  // self-hosted deployments and conflicts with Vercel's Next.js adapter.
  output: process.env.VERCEL ? undefined : "standalone",
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
