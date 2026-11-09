// 서버 전용. 웹 → API 호출의 단일 통로.
// API_MOCK=1 이면 메모리 목(src/mocks)으로, 아니면 `${API_URL}/v1/<path>` 로 전달한다.
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./auth";

export type UpstreamResult = { status: number; body: unknown };

export const isMock = () => process.env.API_MOCK === "1";

export function apiUrl(): string {
  const url = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new Error("API_URL 환경변수가 없어요");
  return url.replace(/\/+$/, "");
}

export async function upstream(opts: {
  method: string;
  path: string; // '/groups' (prefix /v1 제외)
  search?: string; // '?from=...'
  body?: string | null; // JSON 문자열
  token: string | null;
}): Promise<UpstreamResult> {
  const { method, path, search = "", body = null, token } = opts;

  if (isMock()) {
    const { mockHandle, mockUserFromToken } = await import("@/mocks/handler");
    let parsed: Record<string, unknown> | null = null;
    if (body) {
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        return { status: 400, body: { error: { code: "VALIDATION_FAILED", message: "본문을 읽을 수 없어요" } } };
      }
    }
    return mockHandle({
      method,
      path,
      query: new URLSearchParams(search),
      body: parsed,
      userId: mockUserFromToken(token),
    });
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  try {
    const res = await fetch(`${apiUrl()}/v1${path}${search}`, {
      method,
      headers,
      body,
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: { code: "INTERNAL", message: "잠시 후 다시 시도해 주세요" } };
      }
    }
    return { status: res.status, body: json };
  } catch {
    return {
      status: 502,
      body: { error: { code: "INTERNAL", message: "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요" } },
    };
  }
}

/** 서버 컴포넌트에서 쓰는 호출. 봉투를 풀고 실패 시 null 과 오류를 돌려준다 */
export async function serverApi<T>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<{ data: T | null; status: number; error: { code: string; message: string } | null }> {
  const token = init.auth === false ? null : ((await cookies()).get(SESSION_COOKIE)?.value ?? null);
  const [p, q] = path.split("?");
  const res = await upstream({
    method: init.method ?? "GET",
    path: p,
    search: q ? `?${q}` : "",
    body: init.body === undefined ? null : JSON.stringify(init.body),
    token,
  });
  const body = (res.body ?? {}) as { data?: T; error?: { code: string; message: string } };
  if (res.status >= 400 || body.error) {
    return {
      data: null,
      status: res.status,
      error: body.error ?? { code: "INTERNAL", message: "잠시 후 다시 시도해 주세요" },
    };
  }
  return { data: body.data ?? null, status: res.status, error: null };
}
