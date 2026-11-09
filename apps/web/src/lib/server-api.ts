// 서버 컴포넌트 전용 API 호출 (쿠키의 세션 토큰 포함). 봉투를 풀고 실패 시 null 과 오류를 돌려준다.
// 서버 컴포넌트가 받은 초기 데이터는 화면 훅의 `initialData` 로 넘긴다 (agents/frontend.md 데이터 접근).
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./auth";
import { readEnvelope, type ApiErrorInfo } from "./envelope";
import { upstream } from "./upstream";

const FALLBACK_ERROR: ApiErrorInfo = { code: "INTERNAL", message: "잠시 후 다시 시도해 주세요" };

export async function serverApi<T>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<{ data: T | null; status: number; error: ApiErrorInfo | null }> {
  const token = init.auth === false ? null : ((await cookies()).get(SESSION_COOKIE)?.value ?? null);
  const [p, q] = path.split("?");
  const res = await upstream({
    method: init.method ?? "GET",
    path: p,
    search: q ? `?${q}` : "",
    body: init.body === undefined ? null : JSON.stringify(init.body),
    token,
  });
  const env = readEnvelope<T>(res.status, res.body);
  if (!env.ok) {
    return { data: null, status: res.status, error: env.error ?? FALLBACK_ERROR };
  }
  return { data: env.data ?? null, status: res.status, error: null };
}
