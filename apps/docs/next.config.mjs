import { createMDX } from "fumadocs-mdx/next";

export default createMDX()({
  reactStrictMode: true,
  // Pages moved from /docs/* to the site root; keep old links working.
  async redirects() {
    return [
      { source: "/docs", destination: "/", permanent: true },
      { source: "/docs/:path*", destination: "/:path*", permanent: true },
    ];
  },
});
