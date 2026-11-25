import { describe, expect, it } from "vitest";
import { ROBOTS_DISALLOW, robotsRules, sitemapEntries } from "../seo";

describe("robots (#413)", () => {
  it("운영만 열고 sitemap 을 알린다", () => {
    const r = robotsRules("production");
    expect(r.rules.allow).toBe("/");
    expect(r.sitemap).toBe("https://whenwemeet.day/sitemap.xml");
  });
  it("미리보기, 로컬은 전부 막는다", () => {
    expect(robotsRules("preview").rules.disallow).toBe("/");
    expect(robotsRules(undefined).rules.disallow).toBe("/");
  });
  it("미리보기 이미지와 초대 링크는 막지 않는다 (메신저 수집기)", () => {
    expect(ROBOTS_DISALLOW.some((p) => "/og".startsWith(p) || "/og/join/ABC".startsWith(p))).toBe(false);
    expect(ROBOTS_DISALLOW.some((p) => "/join/ABCD12".startsWith(p))).toBe(false);
  });
  it("로그인 뒤 화면은 막는다", () => {
    for (const p of ["/calendar", "/me/accounts", "/events/1", "/api/v1/me", "/auth/kakao"]) {
      expect(ROBOTS_DISALLOW.some((d) => p.startsWith(d))).toBe(true);
    }
  });
});

describe("sitemap (#413)", () => {
  it("맨 / 와 공개 안내 화면", () => {
    expect(sitemapEntries(new Date(0)).map((e) => e.url)).toEqual([
      "https://whenwemeet.day",
      "https://whenwemeet.day/notices",
      "https://whenwemeet.day/support",
      "https://whenwemeet.day/terms",
      "https://whenwemeet.day/privacy",
    ]);
  });

  it("(#515) 공지 목록은 자주 바뀌어 weekly, 관리자 화면은 막는다", () => {
    expect(sitemapEntries(new Date(0)).find((e) => e.url.endsWith("/notices"))?.changeFrequency).toBe("weekly");
    expect(ROBOTS_DISALLOW.some((d) => "/admin/notices".startsWith(d))).toBe(true);
    expect(ROBOTS_DISALLOW.some((d) => "/notices/3".startsWith(d))).toBe(false);
  });
});
