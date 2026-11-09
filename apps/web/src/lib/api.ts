"use client";
// 브라우저용 fetch 래퍼. 항상 웹의 /api/<path> 프록시를 부르고 봉투를 푼다(모양은 lib/envelope.ts 만 안다).
// 화면/컴포넌트는 이 파일을 직접 쓰지 않고 src/hooks/use*.ts 를 통해서만 부른다 (agents/frontend.md 데이터 접근).
import { readEnvelope } from "./envelope";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** 팀 접근 권한이 사라졌을 때(403) window 에 쏘는 이벤트. AppShell 이 hooks/useGroupGone 으로 받아 안내 화면으로 바꾼다 (#18) */
export const GROUP_GONE_EVENT = "wwm:group-gone";

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
}

export async function api<T>(
  path: string,
  init: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK", "");
  }

  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  const env = readEnvelope<T>(res.status, json);

  if (res.status === 401) {
    // 세션이 끝났다. 로그인으로 보내고 돌아올 자리를 남긴다
    const login = new URL("/login", window.location.origin);
    login.searchParams.set("next", currentPath());
    window.location.assign(login.toString());
    throw new ApiError(401, "UNAUTHORIZED", env.error?.message ?? "");
  }
  if (res.status === 403) {
    // 그 팀 멤버가 아니게 된 경우. 홈으로 튕기면 남은 wwm_group 쿠키가 다시 이 팀으로 보내 무한 반복되므로
    // 화면은 그대로 두고 AppShell 에 알려 "접근할 수 없어요" 안내로 바꾼다 (#18)
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(GROUP_GONE_EVENT));
    throw new ApiError(403, "FORBIDDEN", env.error?.message ?? "");
  }
  if (!env.ok) {
    throw new ApiError(res.status, env.error?.code ?? "INTERNAL", env.error?.message ?? "");
  }
  return env.data as T;
}
