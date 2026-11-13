// (#203) 서비스 워커 요청 분류 규칙. 순수 함수만 두고 sw.js 가 importScripts 로 읽는다.
// 단위 테스트(src/lib/__tests__/sw-rules.test.ts)가 이 파일을 그대로 node:vm 에 올려 검사한다.
// 원칙: 인증이 걸릴 수 있는 응답(HTML 문서, RSC 페이로드, /api, /auth, /.well-known, /og, /join)은 절대 캐시에 넣지 않는다.
// 캐시는 해시가 붙은 /_next/static/*, 아이콘, /offline 뿐이다 (D-256).
(function (root) {
  "use strict";

  var CACHE_PREFIX = "wwm-static-";
  var OFFLINE_URL = "/offline";
  /** install 때 미리 넣는 것. /offline 화면이 쓰는 /_next/static 파일은 sw.js 가 HTML 에서 찾아 함께 넣는다 */
  var PRECACHE_URLS = [OFFLINE_URL, "/icon-192.png", "/logo-symbol.svg"];
  /** 해시가 없는 아이콘. 배포마다 캐시 이름이 바뀌어 새로 받는다 */
  var ICON_PATHS = [
    "/favicon-32.png",
    "/icon-192.png",
    "/icon-512.png",
    "/icon.png",
    "/icon-maskable-192.png",
    "/icon-maskable-512.png",
    "/apple-touch-icon.png",
    "/logo-symbol.svg",
    "/logo-horizontal.svg",
    "/logo-horizontal-dark.svg",
    "/logo-stacked.svg",
  ];
  /** 이 접두사로 시작하면 서비스 워커가 관여하지 않는다 (문서 이동이어도 브라우저 기본 동작) */
  var BYPASS_PREFIXES = ["/api/", "/auth/", "/.well-known/", "/og", "/join"];
  var BYPASS_EXACT = ["/api", "/auth", "/.well-known", "/sw.js", "/sw-rules.js"];

  function startsWithAny(path, list) {
    for (var i = 0; i < list.length; i++) if (path.indexOf(list[i]) === 0) return true;
    return false;
  }

  function header(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(name);
    var want = name.toLowerCase();
    for (var k in headers) if (k.toLowerCase() === want) return headers[k];
    return null;
  }

  /**
   * 요청 하나를 어떻게 다룰지. 위에서부터 처음 맞는 규칙.
   * @param {{ method: string, url: string, mode?: string, headers?: Headers | Record<string, string> }} req
   * @param {string} origin 서비스 워커의 출처 (self.location.origin)
   * @returns {"bypass" | "static" | "navigate" | "purge"}
   *   bypass: respondWith 하지 않는다 / static: cache-first 로 캐시 / navigate: 네트워크만, 실패하면 캐시의 /offline
   *   purge: 로그아웃(탈퇴 포함) 요청. 응답은 건드리지 않고 캐시만 비운다
   */
  function classifyRequest(req, origin) {
    var url;
    try {
      url = new URL(req.url);
    } catch {
      return "bypass";
    }
    if (url.origin !== origin) return "bypass";
    var path = url.pathname;
    var method = (req.method || "GET").toUpperCase();
    if (method !== "GET") return method === "POST" && path === "/auth/logout" ? "purge" : "bypass";
    if (BYPASS_EXACT.indexOf(path) !== -1 || startsWithAny(path, BYPASS_PREFIXES)) return "bypass";
    if (path.indexOf("opengraph-image") !== -1 || path.indexOf("twitter-image") !== -1) return "bypass";
    // RSC 페이로드(화면 이동, 프리페치, 서버 액션)는 사용자 데이터다. 오프라인이면 Next 가 문서 이동으로 바꾼다
    if (url.searchParams.has("_rsc")) return "bypass";
    if (header(req.headers, "rsc") || header(req.headers, "next-router-prefetch") || header(req.headers, "next-action")) {
      return "bypass";
    }
    if (path.indexOf("/_next/static/") === 0) return "static";
    if (ICON_PATHS.indexOf(path) !== -1) return "static";
    if (req.mode === "navigate") return "navigate";
    return "bypass";
  }

  /**
   * 캐시에 넣어도 되는 응답인지. classifyRequest 가 static 이어도 한 번 더 막는 안전장치.
   * HTML 은 /offline 만, RSC(text/x-component)와 JSON 은 언제나 거부
   * @param {string} url 요청 주소
   * @param {{ status: number, type?: string, headers?: Headers | Record<string, string> }} res
   * @param {string} origin
   */
  function isCacheableResponse(url, res, origin) {
    if (!res || res.status !== 200) return false;
    if (res.type && res.type !== "basic" && res.type !== "default") return false;
    var u;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (u.origin !== origin) return false;
    // 쿼리가 붙은 것은 /_next/static(배포 id ?dpl= 등)만 받는다. /offline, 아이콘은 쿼리 없는 주소만
    if (u.search && u.pathname.indexOf("/_next/static/") !== 0) return false;
    var cc = (header(res.headers, "cache-control") || "").toLowerCase();
    if (cc.indexOf("no-store") !== -1 || cc.indexOf("private") !== -1) return false;
    if (header(res.headers, "set-cookie")) return false;
    var type = (header(res.headers, "content-type") || "").toLowerCase();
    if (type.indexOf("text/x-component") !== -1 || type.indexOf("json") !== -1) return false;
    if (type.indexOf("text/html") !== -1) return u.pathname === OFFLINE_URL;
    if (u.pathname === OFFLINE_URL) return false;
    return u.pathname.indexOf("/_next/static/") === 0 || ICON_PATHS.indexOf(u.pathname) !== -1;
  }

  /** 등록 주소의 ?v= 가 캐시 이름. 배포마다 바뀌어 새 워커가 옛 캐시를 지운다 */
  function cacheNameFor(scriptUrl) {
    var v = "dev";
    try {
      v = new URL(scriptUrl).searchParams.get("v") || "dev";
    } catch {
      // 기본값
    }
    return CACHE_PREFIX + v.replace(/[^0-9A-Za-z._-]/g, "").slice(0, 64);
  }

  /** activate 때 지울 캐시: 우리 접두사인데 지금 이름이 아닌 것. 다른 출처 캐시나 남의 이름은 건드리지 않는다 */
  function staleCacheNames(names, current) {
    return names.filter(function (n) {
      return n.indexOf(CACHE_PREFIX) === 0 && n !== current;
    });
  }

  /** /offline HTML 이 쓰는 같은 출처 /_next/static 파일 주소 (중복 제거) */
  function staticAssetsInHtml(html) {
    var re = /\/_next\/static\/[^"'\s)<>\\]+/g;
    var seen = {};
    var out = [];
    var m;
    while ((m = re.exec(html))) {
      if (!seen[m[0]]) {
        seen[m[0]] = true;
        out.push(m[0]);
      }
    }
    return out;
  }

  root.wwmSwRules = {
    CACHE_PREFIX: CACHE_PREFIX,
    OFFLINE_URL: OFFLINE_URL,
    PRECACHE_URLS: PRECACHE_URLS,
    classifyRequest: classifyRequest,
    isCacheableResponse: isCacheableResponse,
    cacheNameFor: cacheNameFor,
    staleCacheNames: staleCacheNames,
    staticAssetsInHtml: staticAssetsInHtml,
  };
})(self);
