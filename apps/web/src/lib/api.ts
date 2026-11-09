"use client";
// 브라우저용 fetch 래퍼. 항상 웹의 /api/<path> 프록시를 부르고 봉투 { data } 를 푼다.
import type { ApiErrorBody } from "./types";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const FORBIDDEN_TOAST_KEY = "wwm_toast";

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

  let json: { data?: T } & Partial<ApiErrorBody> = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    json = {};
  }

  if (res.status === 401) {
    // 세션이 끝났다. 로그인으로 보내고 돌아올 자리를 남긴다
    const login = new URL("/login", window.location.origin);
    login.searchParams.set("next", currentPath());
    window.location.assign(login.toString());
    throw new ApiError(401, "UNAUTHORIZED", json.error?.message ?? "");
  }
  if (res.status === 403) {
    // 그 팀 멤버가 아니게 된 경우. 토스트를 남기고 홈으로
    try {
      sessionStorage.setItem(FORBIDDEN_TOAST_KEY, "이 팀에 더 이상 속해 있지 않아요");
    } catch {}
    window.location.assign(new URL("/", window.location.origin).toString());
    throw new ApiError(403, "FORBIDDEN", json.error?.message ?? "");
  }
  if (!res.ok || json.error) {
    throw new ApiError(res.status, json.error?.code ?? "INTERNAL", json.error?.message ?? "");
  }
  return json.data as T;
}

/** 오류 객체에서 사용자에게 보여줄 문구. API message 우선, 없으면 fallback */
export function messageOf(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.message) return e.message;
  return fallback;
}
