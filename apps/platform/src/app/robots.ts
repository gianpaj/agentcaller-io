import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/app$",
        "/app/",
        "/api/",
        "/auth/",
        "/billing/",
        "/oauth/",
        "/mcp$",
        "/login",
        "/forgot-password",
        "/reset-password",
      ],
    },
    sitemap: "https://agentcaller.io/sitemap.xml",
  };
}
