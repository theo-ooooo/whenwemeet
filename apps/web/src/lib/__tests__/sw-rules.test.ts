// (#203) 서비스 워커 규칙 (D-256). 배포되는 public/sw-rules.js 를 그대로 vm 에 올려 검사한다
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type Kind = "bypass" | "static" | "navigate" | "purge";
type Req = { method: string; url: string; mode?: string; headers?: Record<string, string> };
type Res = { status: number; type?: string; headers?: Record<string, string> };
type Rules = {
  CACHE_PREFIX: string;
  OFFLINE_URL: string;
  PRECACHE_URLS: string[];
  classifyRequest: (req: Req, origin: string) => Kind;
  isCacheableResponse: (url: string, res: Res, origin: string) => boolean;
  cacheNameFor: (scriptUrl: string) => string;
  staleCacheNames: (names: string[], current: string) => string[];
  staticAssetsInHtml: (html: string) => string[];
};

function load(file: string): Record<string, unknown> {
  const src = readFileSync(fileURLToPath(new URL(`../../../public/${file}`, import.meta.url)), "utf8");
  const self: Record<string, unknown> = {};
  vm.runInNewContext(src, { self, URL });
  return self;
}

const rules = load("sw-rules.js").wwmSwRules as Rules;
const O = "https://whenwemeet.day";
const nav = (path: string, extra: Partial<Req> = {}): Req => ({ method: "GET", url: O + path, mode: "navigate", ...extra });
const get = (path: string, extra: Partial<Req> = {}): Req => ({ method: "GET", url: O + path, mode: "cors", ...extra });
const kind = (req: Req) => rules.classifyRequest(req, O);

describe("classifyRequest", () => {
  it("해시 붙은 /_next/static 과 아이콘만 static", () => {
    expect(kind(get("/_next/static/chunks/app-abc123.js"))).toBe("static");
    expect(kind(get("/_next/static/css/0f1e.css"))).toBe("static");
    expect(kind(get("/_next/static/media/font.woff2"))).toBe("static");
    expect(kind(get("/_next/static/chunks/x.js?dpl=dpl_123"))).toBe("static");
    expect(kind(get("/icon-192.png"))).toBe("static");
    expect(kind(get("/favicon-32.png"))).toBe("static");
    expect(kind(get("/logo-symbol.svg"))).toBe("static");
    expect(kind(get("/apple-touch-icon.png"))).toBe("static");
  });

  it("문서 이동은 navigate (네트워크만, 실패 시 /offline)", () => {
    expect(kind(nav("/calendar"))).toBe("navigate");
    expect(kind(nav("/"))).toBe("navigate");
    expect(kind(nav("/events/12?date=2026-11-13"))).toBe("navigate");
    expect(kind(nav("/offline"))).toBe("navigate");
    expect(kind(nav("/me"))).toBe("navigate");
    expect(kind(nav("/login"))).toBe("navigate");
  });

  it("인증이 걸린 경로는 문서 이동이어도 관여하지 않는다", () => {
    for (const p of [
      "/api/groups",
      "/api/me",
      "/api",
      "/auth/callback?token=x",
      "/auth/kakao",
      "/auth/logout",
      "/auth",
      "/.well-known/apple-app-site-association",
      "/.well-known/assetlinks.json",
      "/og",
      "/og/join/ABC123",
      "/opengraph-image",
      "/twitter-image",
      "/join/ABC123/opengraph-image",
      "/join",
      "/join/ABC123",
      "/join/e/secret-token",
      "/sw.js",
      "/sw.js?v=1",
      "/sw-rules.js",
    ]) {
      expect(kind(nav(p)), p).toBe("bypass");
      expect(kind(get(p)), p).toBe("bypass");
    }
  });

  it("RSC 페이로드(?_rsc=, RSC 헤더, 프리페치, 서버 액션)는 관여하지 않는다", () => {
    expect(kind(get("/calendar?_rsc=1a2b3"))).toBe("bypass");
    expect(kind(get("/calendar", { headers: { RSC: "1" } }))).toBe("bypass");
    expect(kind(get("/calendar", { headers: { rsc: "1", "Next-Router-Prefetch": "1" } }))).toBe("bypass");
    expect(kind(get("/calendar", { headers: { "next-router-prefetch": "1" } }))).toBe("bypass");
    expect(kind(get("/calendar", { headers: { "Next-Action": "abc" } }))).toBe("bypass");
    // 문서 이동이라도 RSC 표시가 있으면 손대지 않는다
    expect(kind(nav("/calendar?_rsc=x"))).toBe("bypass");
    // Headers 객체도 받는다
    expect(kind({ ...get("/calendar"), headers: new Headers({ RSC: "1" }) as unknown as Record<string, string> })).toBe("bypass");
  });

  it("GET 이 아니면 관여하지 않고, 로그아웃 POST 만 purge", () => {
    expect(kind({ method: "POST", url: O + "/auth/logout", mode: "navigate" })).toBe("purge");
    expect(kind({ method: "post", url: O + "/auth/logout" })).toBe("purge");
    expect(kind({ method: "GET", url: O + "/auth/logout", mode: "navigate" })).toBe("bypass");
    expect(kind({ method: "POST", url: O + "/api/groups/1/events" })).toBe("bypass");
    expect(kind({ method: "POST", url: O + "/calendar", mode: "navigate" })).toBe("bypass");
    expect(kind({ method: "PUT", url: O + "/_next/static/x.js" })).toBe("bypass");
    expect(kind({ method: "HEAD", url: O + "/icon-192.png" })).toBe("bypass");
    expect(kind({ method: "POST", url: "https://evil.example/auth/logout" })).toBe("bypass");
  });

  it("다른 출처(글꼴 CDN, 카카오, API 도메인)는 관여하지 않는다", () => {
    expect(kind({ method: "GET", url: "https://cdn.jsdelivr.net/_next/static/x.js" })).toBe("bypass");
    expect(kind({ method: "GET", url: "https://api.whenwemeet.day/v1/me" })).toBe("bypass");
    expect(kind({ method: "GET", url: "https://images.whenwemeet.day/a.png", mode: "navigate" })).toBe("bypass");
    expect(kind({ method: "GET", url: "http://whenwemeet.day/_next/static/x.js" })).toBe("bypass");
  });

  it("그 밖의 하위 요청(이미지, manifest, 데이터)은 관여하지 않는다", () => {
    expect(kind(get("/manifest.webmanifest"))).toBe("bypass");
    expect(kind(get("/calendar"))).toBe("bypass");
    expect(kind(get("/icon-192.png.map"))).toBe("bypass");
    expect(kind(get("/_next/image?url=x"))).toBe("bypass");
    expect(kind(get("/_next/data/x.json"))).toBe("bypass");
    expect(kind({ method: "GET", url: "not a url" })).toBe("bypass");
  });
});

describe("isCacheableResponse", () => {
  const ok = (type: string, extra: Record<string, string> = {}): Res => ({
    status: 200,
    type: "basic",
    headers: { "content-type": type, ...extra },
  });
  const can = (path: string, res: Res) => rules.isCacheableResponse(O + path, res, O);

  it("정적 파일과 /offline HTML 만 받는다", () => {
    expect(can("/_next/static/chunks/a.js", ok("application/javascript"))).toBe(true);
    expect(can("/_next/static/css/a.css", ok("text/css"))).toBe(true);
    expect(can("/_next/static/chunks/a.js?dpl=1", ok("application/javascript"))).toBe(true);
    expect(can("/icon-192.png", ok("image/png"))).toBe(true);
    expect(can("/offline", ok("text/html; charset=utf-8"))).toBe(true);
  });

  it("HTML 은 /offline 말고는 어디서 와도 거부", () => {
    expect(can("/calendar", ok("text/html"))).toBe(false);
    expect(can("/_next/static/chunks/a.js", ok("text/html"))).toBe(false);
    expect(can("/icon-192.png", ok("text/html"))).toBe(false);
    expect(can("/offline?x=1", ok("text/html"))).toBe(false);
  });

  it("RSC, JSON 은 언제나 거부, /offline 이 HTML 이 아니어도 거부", () => {
    expect(can("/_next/static/chunks/a.js", ok("text/x-component"))).toBe(false);
    expect(can("/_next/static/a.json", ok("application/json"))).toBe(false);
    expect(can("/api/me", ok("application/json"))).toBe(false);
    expect(can("/offline", ok("text/x-component"))).toBe(false);
  });

  it("오류, 리다이렉트, 불투명 응답, 쿠키, no-store, private 는 거부", () => {
    expect(can("/_next/static/a.js", { ...ok("application/javascript"), status: 404 })).toBe(false);
    expect(can("/_next/static/a.js", { ...ok("application/javascript"), status: 0, type: "opaque" })).toBe(false);
    expect(can("/_next/static/a.js", { ...ok("application/javascript"), type: "opaqueredirect" })).toBe(false);
    expect(can("/_next/static/a.js", { ...ok("application/javascript"), type: "cors" })).toBe(false);
    expect(can("/_next/static/a.js", ok("application/javascript", { "set-cookie": "wwm_session=x" }))).toBe(false);
    expect(can("/offline", ok("text/html", { "cache-control": "private, no-cache" }))).toBe(false);
    expect(can("/_next/static/a.js", ok("application/javascript", { "Cache-Control": "no-store" }))).toBe(false);
    expect(rules.isCacheableResponse("https://cdn.jsdelivr.net/_next/static/a.js", ok("text/css"), O)).toBe(false);
    expect(rules.isCacheableResponse("bad", ok("text/css"), O)).toBe(false);
    expect(rules.isCacheableResponse(O + "/_next/static/a.js", undefined as unknown as Res, O)).toBe(false);
  });
});

describe("캐시 이름과 정리", () => {
  it("등록 주소 ?v= 가 캐시 이름이고, 없으면 dev, 이상한 글자는 지운다", () => {
    expect(rules.cacheNameFor(O + "/sw.js?v=abc123def456")).toBe("wwm-static-abc123def456");
    expect(rules.cacheNameFor(O + "/sw.js")).toBe("wwm-static-dev");
    expect(rules.cacheNameFor(O + "/sw.js?v=a/b<c>")).toBe("wwm-static-abc");
    expect(rules.cacheNameFor("bad")).toBe("wwm-static-dev");
  });

  it("activate 는 우리 접두사의 옛 캐시만 지운다", () => {
    expect(rules.staleCacheNames(["wwm-static-old", "wwm-static-new", "other-cache", "wwm-other"], "wwm-static-new")).toEqual(["wwm-static-old"]);
  });

  it("미리 넣는 것은 /offline 과 아이콘뿐", () => {
    expect(rules.PRECACHE_URLS).toEqual(["/offline", "/icon-192.png", "/logo-symbol.svg"]);
    for (const p of rules.PRECACHE_URLS) {
      const res = { status: 200, type: "basic", headers: { "content-type": p === "/offline" ? "text/html" : "image/png" } };
      expect(rules.isCacheableResponse(O + p, res, O), p).toBe(true);
    }
  });

  it("/offline HTML 에서 같은 출처 정적 파일 주소를 중복 없이 찾는다", () => {
    const html =
      '<link rel="stylesheet" href="/_next/static/css/a1.css"/><script src="/_next/static/chunks/b2.js" async></script>' +
      '<script src="/_next/static/chunks/b2.js"></script><script>self.__next_f.push([1,"0:[\\"/_next/static/chunks/c3.js\\"]"])</script>' +
      '<link href="https://cdn.jsdelivr.net/x.css"/>';
    expect(rules.staticAssetsInHtml(html)).toEqual(["/_next/static/css/a1.css", "/_next/static/chunks/b2.js", "/_next/static/chunks/c3.js"]);
  });
});

describe("sw.js", () => {
  it("규칙 파일을 읽고 install, activate, fetch 를 단다", () => {
    const listeners: Record<string, unknown> = {};
    const imported: string[] = [];
    const self: Record<string, unknown> = {
      location: new URL(O + "/sw.js?v=build1"),
      addEventListener: (t: string, fn: unknown) => (listeners[t] = fn),
    };
    const src = readFileSync(fileURLToPath(new URL("../../../public/sw.js", import.meta.url)), "utf8");
    const rulesSrc = readFileSync(fileURLToPath(new URL("../../../public/sw-rules.js", import.meta.url)), "utf8");
    vm.runInNewContext(src, {
      self,
      URL,
      importScripts: (p: string) => {
        imported.push(p);
        vm.runInNewContext(rulesSrc, { self, URL });
      },
    });
    expect(imported).toEqual(["/sw-rules.js"]);
    expect(Object.keys(listeners).sort()).toEqual(["activate", "fetch", "install"]);
  });
});
