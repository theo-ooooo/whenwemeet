// 유니버설 링크(AASA)와 앱 링크(assetlinks) 본문 (docs/설계/앱.md 5.2, 5.3, D-54).
// 값은 웹 환경 변수에서 읽고 코드에 넣지 않는다. 값이 없으면 null → 라우트가 404.

/** 번들 ID 이자 Android 패키지명 (앱.md 6장) */
export const APP_ID = "day.whenwemeet.app";

/** 앱으로 여는 경로. 셸 links/urls.ts DEEP_LINK_PATHS, app.config intentFilters 와 같은 목록 (5.1) */
export const DEEP_LINK_COMPONENTS = [
  { "/": "/join/*", comment: "초대 링크" },
  { "/": "/g/*", comment: "팀 달력" },
] as const;

/**
 * (#271) 메일 로그인 링크 `/auth/email?token=` (D-113 확인 화면). 정확히 이 경로 + token 쿼리만 (D-177).
 * 셸 links/urls.ts EMAIL_LINK_PATH, app.config intentFilters `path` 와 같은 값.
 * AASA 경로는 앱 버전을 가리지 않아 1.1.0 이하 iOS 앱도 이 링크를 받는다. 그 셸은 /auth/email 을 몰라 링크를 버리고
 * 확인 화면이 안 열린다. 그래서 스위치(EMAIL_APP_LINK_ENABLED=1)가 켜졌을 때만 싣는다
 */
export const EMAIL_LINK_COMPONENT = {
  "/": "/auth/email",
  "?": { token: "?*" },
  comment: "메일 로그인 링크 (앱 1.1.1~)",
} as const;

/** EMAIL_APP_LINK_ENABLED (Vercel). "1" 일 때만 켠다 */
export function emailAppLinkEnabled(raw: string | null | undefined): boolean {
  return raw?.trim() === "1";
}

/** Apple Team ID: 영문 대문자와 숫자 10자 */
const TEAM_ID = /^[A-Z0-9]{10}$/;
/** SHA-256 지문: 콜론으로 나뉜 16진수 32바이트 */
const FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

export function buildAppleAppSiteAssociation(teamId: string | null | undefined, opts: { emailLink?: boolean } = {}) {
  const id = teamId?.trim().toUpperCase();
  if (!id || !TEAM_ID.test(id)) return null;
  const components = opts.emailLink ? [...DEEP_LINK_COMPONENTS, EMAIL_LINK_COMPONENT] : DEEP_LINK_COMPONENTS;
  return {
    applinks: {
      details: [{ appIDs: [`${id}.${APP_ID}`], components }],
    },
  };
}

/** 쉼표 구분 지문 목록. 형식이 틀린 값은 버리고, 남는 것이 없으면 빈 배열 */
export function parseFingerprints(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const list = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => FINGERPRINT.test(s));
  return [...new Set(list)];
}

export function buildAssetLinks(rawFingerprints: string | null | undefined) {
  const fingerprints = parseFingerprints(rawFingerprints);
  if (fingerprints.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: APP_ID, sha256_cert_fingerprints: fingerprints },
    },
  ];
}

/** 두 라우트 공통 응답. 리다이렉트 없이 200 application/json, 값 없으면 404 */
export function wellKnownResponse(body: unknown): Response {
  if (body === null) {
    return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
}
