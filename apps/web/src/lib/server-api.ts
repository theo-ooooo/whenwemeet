// 서버 컴포넌트 전용 API 호출 (쿠키의 세션 토큰 포함). 봉투를 풀고 실패 시 null 과 오류를 돌려준다.
// 서버 컴포넌트가 받은 초기 데이터는 화면 훅의 `initialData` 로 넘긴다 (agents/frontend.md 데이터 접근).
// 서버 장애(API 연결 실패, 5xx INTERNAL)면 값을 돌려주지 않고 /maintenance?from=<from> 으로 보낸다 (#54).
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./auth";
import { clientIpOf } from "./email-login";
import { readEnvelope, type ApiErrorInfo } from "./envelope";
import { isOutage, maintenanceUrl } from "./maintenance";
import { upstream } from "./upstream";

const FALLBACK_ERROR: ApiErrorInfo = { code: "INTERNAL", message: "잠시 후 다시 시도해 주세요" };

export async function serverApi<T>(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    auth?: boolean;
    /** 점검 화면에서 [다시 시도] 로 돌아올 경로. 서버 컴포넌트는 현재 경로를 모르므로 부르는 쪽이 넘긴다 */
    from?: string;
  } = {},
): Promise<{ data: T | null; status: number; error: ApiErrorInfo | null }> {
  const token = init.auth === false ? null : ((await cookies()).get(SESSION_COOKIE)?.value ?? null);
  const [p, q] = path.split("?");
  const h = await headers();
  const res = await upstream({
    method: init.method ?? "GET",
    path: p,
    search: q ? `?${q}` : "",
    body: init.body === undefined ? null : JSON.stringify(init.body),
    token,
    // (#186) API 요청 제한이 사용자 IP 로 세도록
    internal: { clientIp: clientIpOf(h.get("x-forwarded-for"), h.get("x-real-ip")) },
    // (#532) 로그인한 요청의 기종 기록 (D-288)
    userAgent: h.get("user-agent"),
  });
  const env = readEnvelope<T>(res.status, res.body);
  if (!env.ok && isOutage(res.status, env.error?.code)) redirect(maintenanceUrl(init.from ?? "/"));
  if (!env.ok) {
    return { data: null, status: res.status, error: env.error ?? FALLBACK_ERROR };
  }
  return { data: env.data ?? null, status: res.status, error: null };
}
