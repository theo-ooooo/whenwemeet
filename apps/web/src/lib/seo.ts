// (#413) 검색 노출. robots.txt(app/robots.ts), sitemap.xml(app/sitemap.ts) 이 이 값을 쓴다. 단위 테스트 대상이라 Next 를 import 하지 않는다
import { SITE_URL } from "./site";

/** 검색에 올릴 공개 화면. 맨 / 는 로그인 안 한 방문자에게 소개 페이지를 그린다 (proxy.ts) */
export const SITEMAP_PATHS = ["/", "/support", "/terms", "/privacy"] as const;

/** 로그인 뒤 화면과 내부 경로. /og 와 /join 은 막지 않는다: 메신저 미리보기 수집기가 robots 를 따르면 카드가 빈다.
 *  초대, 일정 공유 화면은 페이지에서 noindex 로 뺀다 */
export const ROBOTS_DISALLOW = [
  "/api/",
  "/auth/",
  "/calendar",
  "/upcoming",
  "/free",
  "/anniversaries",
  "/todos",
  "/news",
  "/team",
  "/events",
  "/search",
  "/polls",
  "/g/",
  "/groups",
  "/me",
  "/maintenance",
  "/offline",
];

export type RobotsRules = { rules: { userAgent: string; allow?: string; disallow: string | string[] }; sitemap?: string; host?: string };

/** 운영(Vercel production)만 열고, 미리보기 배포와 로컬은 전부 막는다 (미리보기는 목 데이터라 검색에 남으면 안 된다) */
export function robotsRules(vercelEnv: string | undefined): RobotsRules {
  if (vercelEnv !== "production") return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: ROBOTS_DISALLOW }, sitemap: `${SITE_URL}/sitemap.xml`, host: SITE_URL };
}

export function sitemapEntries(now: Date): { url: string; lastModified: Date; changeFrequency: "weekly" | "monthly"; priority: number }[] {
  return SITEMAP_PATHS.map((p) => ({
    url: p === "/" ? SITE_URL : `${SITE_URL}${p}`,
    lastModified: now,
    changeFrequency: p === "/" ? "weekly" : "monthly",
    priority: p === "/" ? 1 : 0.5,
  }));
}
