import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  // Add or remove entries when indexable public pages change.
  return [{ url: "https://agentcaller.io/" }];
}
