// (#203) 언제볼까 서비스 워커. 오프라인 안내 화면과 정적 자산 캐시만 한다 (D-256).
// - 문서 이동: 네트워크만. 실패하면 캐시의 /offline. 문서(HTML), RSC, /api, /auth 응답은 캐시에 넣지 않는다
// - /_next/static/*(해시 이름), 아이콘: cache-first
// - 캐시 이름은 등록 주소 ?v=(빌드마다 다름). 새 워커가 activate 때 옛 wwm-static-* 를 지운다
// - 로그아웃(POST /auth/logout): 캐시를 비우고 /offline 만 다시 넣는다
// 문제가 생기면 docs/운영/서비스워커.md 의 "자기 해제" sw.js 로 바꿔 배포한다.
importScripts("/sw-rules.js");

var rules = self.wwmSwRules;
var CACHE = rules.cacheNameFor(self.location.href);
var ORIGIN = self.location.origin;

/** 응답을 검사한 뒤에만 넣는다 (규칙의 두 번째 안전장치) */
function putSafe(cache, url, res) {
  if (!rules.isCacheableResponse(url, res, ORIGIN)) return Promise.resolve(false);
  return cache.put(url, res).then(function () {
    return true;
  });
}

/** /offline 과 그 화면의 정적 파일, 아이콘을 넣는다. 하나라도 실패하면 install 실패(옛 워커 유지) */
function precache() {
  return caches.open(CACHE).then(function (cache) {
    return Promise.all(
      rules.PRECACHE_URLS.map(function (path) {
        var url = new URL(path, ORIGIN).href;
        return fetch(url, { cache: "no-store", credentials: "omit" }).then(function (res) {
          if (path !== rules.OFFLINE_URL) return putSafe(cache, url, res);
          return res
            .clone()
            .text()
            .then(function (html) {
              var assets = rules.staticAssetsInHtml(html).map(function (p) {
                return new URL(p, ORIGIN).href;
              });
              return Promise.all([putSafe(cache, url, res)].concat(
                assets.map(function (a) {
                  return fetch(a, { credentials: "omit" }).then(function (r) {
                    return putSafe(cache, a, r);
                  });
                })
              ));
            })
            .then(function (results) {
              if (!results[0]) throw new Error("offline page not cacheable");
            });
        });
      })
    );
  });
}

function clearOurCaches() {
  return caches.keys().then(function (names) {
    return Promise.all(
      names
        .filter(function (n) {
          return n.indexOf(rules.CACHE_PREFIX) === 0;
        })
        .map(function (n) {
          return caches.delete(n);
        })
    );
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    precache().then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(rules.staleCacheNames(names, CACHE).map(function (n) {
          return caches.delete(n);
        }));
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

function cacheFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        var copy = res.clone();
        return putSafe(cache, request.url, copy)
          .catch(function () {
            return false;
          })
          .then(function () {
            return res;
          });
      });
    });
  });
}

function networkOrOffline(event) {
  return fetch(event.request).catch(function (err) {
    return caches.open(CACHE).then(function (cache) {
      return cache.match(rules.OFFLINE_URL).then(function (offline) {
        if (offline) return offline;
        throw err;
      });
    });
  });
}

self.addEventListener("fetch", function (event) {
  var kind = rules.classifyRequest(event.request, ORIGIN);
  if (kind === "static") event.respondWith(cacheFirst(event.request));
  else if (kind === "navigate") event.respondWith(networkOrOffline(event));
  else if (kind === "purge") {
    // 응답은 브라우저에 맡기고(respondWith 없음) 캐시만 비운 뒤 /offline 을 다시 넣는다
    event.waitUntil(
      clearOurCaches().then(function () {
        return precache().catch(function () {
          // 다시 넣기 실패는 다음 install 에서 채워진다
        });
      })
    );
  }
});
