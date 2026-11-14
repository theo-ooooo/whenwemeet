// (#413) robots.txt. 규칙은 lib/seo.ts
import type { MetadataRoute } from "next";
import { robotsRules } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return robotsRules(process.env.VERCEL_ENV);
}
