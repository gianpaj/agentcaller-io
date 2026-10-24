import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // The API catalog advertises /api/health as its status link.
      allow: ["/", "/api/health"],
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
