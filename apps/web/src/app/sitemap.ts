// (#413) sitemap.xml. 공개 화면 목록은 lib/seo.ts
import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries(new Date());
}
