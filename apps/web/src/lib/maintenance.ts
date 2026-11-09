// 서버 장애 시 '점검 중이에요' 화면(/maintenance)으로 보낼지 판정하고 경로를 만든다 (#54).
// 브라우저(lib/api.ts), 서버(lib/server-api.ts), 프록시(lib/upstream.ts) 가 함께 쓰므로 next/headers 를 import 하지 않는다.

export const MAINTENANCE_PATH = "/maintenance";

/** 프록시가 API 에 연결하지 못했을 때(연결 거부 502, 타임아웃 504) 싣는 코드 */
export const UPSTREAM_UNAVAILABLE = "UPSTREAM_UNAVAILABLE";

/**
 * 점검 화면으로 보낼 오류인지.
 * - 대상: 프록시 연결 실패(UPSTREAM_UNAVAILABLE), API 5xx INTERNAL, 봉투 없는 5xx(게이트웨이 HTML 등)
 * - 제외: 기능 단위 503 STORAGE_NOT_CONFIGURED, KAKAO_NOT_CONFIGURED, 502 KAKAO_ERROR 등 코드가 있는 5xx, 4xx 전부
 */
export function isOutage(status: number, code: string | null | undefined): boolean {
  if (code === UPSTREAM_UNAVAILABLE) return true;
  if (status < 500) return false;
  return !code || code === "INTERNAL";
}

/** from 은 같은 사이트의 경로(+쿼리)만 허용. 바깥 주소, `//host`, /maintenance 자신은 `/` */
export function safeFrom(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const base = "http://wwm.invalid";
    const u = new URL(raw, base);
    if (u.origin !== base) return "/";
    if (u.pathname === MAINTENANCE_PATH || u.pathname.startsWith(`${MAINTENANCE_PATH}/`)) return "/";
    return u.pathname + u.search;
  } catch {
    return "/";
  }
}

/** /maintenance?from=<경로> */
export function maintenanceUrl(from: string | null | undefined): string {
  const f = safeFrom(from);
  return f === "/" ? MAINTENANCE_PATH : `${MAINTENANCE_PATH}?from=${encodeURIComponent(f)}`;
}
