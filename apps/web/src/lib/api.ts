"use client";
// 브라우저용 fetch 래퍼. 항상 웹의 /api/<path> 프록시를 부르고 봉투를 푼다(모양은 lib/envelope.ts 만 안다).
// 화면/컴포넌트는 이 파일을 직접 쓰지 않고 src/hooks/use*.ts 를 통해서만 부른다 (agents/frontend.md 데이터 접근).
import { readEnvelope, type ApiErrorDetail } from "./envelope";
import { EXPIRED_PATH } from "./auth";
import { isOutage, MAINTENANCE_PATH, maintenanceUrl } from "./maintenance";

export class ApiError extends Error {
  code: string;
  status: number;
  details?: ApiErrorDetail[];
  constructor(status: number, code: string, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
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
  init: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    form?: FormData;
    signal?: AbortSignal;
    /** false 면 서버 장애여도 점검 화면으로 보내지 않는다. 점검 화면의 health 확인 전용 (무한 이동 방지, #54) */
    outageRedirect?: boolean;
  } = {},
): Promise<T> {
  let res: Response;
  // form 은 multipart 로 보낸다. Content-Type(boundary 포함) 은 브라우저가 붙인다
  const sendsJson = init.form === undefined && init.body !== undefined;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      headers: sendsJson ? { "Content-Type": "application/json" } : undefined,
      body: init.form ?? (sendsJson ? JSON.stringify(init.body) : undefined),
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
    // 세션이 끝났다. 쿠키(wwm_session, wwm_group)를 지우는 route handler 를 거쳐 로그인으로 보내고 돌아올 자리를 남긴다 (#37)
    const expired = new URL(EXPIRED_PATH, window.location.origin);
    expired.searchParams.set("next", currentPath());
    window.location.assign(expired.toString());
    throw new ApiError(401, "UNAUTHORIZED", env.error?.message ?? "");
  }
  if (res.status === 403) {
    // 그 팀 멤버가 아니게 된 경우. 홈으로 튕기면 남은 wwm_group 쿠키가 다시 이 팀으로 보내 무한 반복되므로
    // 화면은 그대로 두고 AppShell 에 알려 "접근할 수 없어요" 안내로 바꾼다 (#18)
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(GROUP_GONE_EVENT));
    throw new ApiError(403, "FORBIDDEN", env.error?.message ?? "");
  }
  if (!env.ok && isOutage(res.status, env.error?.code)) {
    // 서버 장애(프록시 연결 실패 502/504, API 500 INTERNAL). 화면을 스피너에 두지 않고 점검 화면으로 보낸다 (#54).
    // 기능 단위 503(STORAGE_NOT_CONFIGURED 등), 502 KAKAO_ERROR 는 isOutage 가 걸러 화면 안 안내로 남긴다
    if (init.outageRedirect !== false && window.location.pathname !== MAINTENANCE_PATH) {
      window.location.assign(maintenanceUrl(currentPath()));
    }
  }
  if (!env.ok) {
    throw new ApiError(res.status, env.error?.code ?? "INTERNAL", env.error?.message ?? "", env.error?.details);
  }
  // (#197) 팀, 일정, 기념일을 바꾸는 요청이 성공하면 위젯 스냅샷을 다시 보내게 알린다 (lib/useWidgetSync.ts 가 2초 모아서)
  if (init.method && init.method !== "GET" && isWidgetPath(path) && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WIDGET_DIRTY_EVENT));
  }
  return env.data as T;
}

/** (#197) 위젯 스냅샷을 다시 만들 때 window 에 쏘는 이벤트 */
export const WIDGET_DIRTY_EVENT = "wwm:widget-dirty";

/** 위젯 내용(팀 목록, 이름, 내 색, 일정, 기념일)에 닿는 변경 경로: /groups 아래 전부 (합류, 나가기, 팀 만들기 포함) */
export function isWidgetPath(path: string): boolean {
  return path === "/groups" || path.startsWith("/groups/") || path.startsWith("/groups?");
}

/**
 * (#245) 이메일 로그인 route handler(`/auth/email/<name>`) 호출. /api 프록시를 거치지 않는 웹 자신의 엔드포인트라
 * 401(가입 티켓 만료), 403, 5xx 에서 세션 만료나 점검 화면으로 보내지 않고 오류를 그대로 던진다 (이메일-로그인.md 6-6)
 */
export async function authEmailPost<T>(name: "request" | "code" | "signup", body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/auth/email/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "");
  }
  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  const env = readEnvelope<T>(res.status, json);
  if (!env.ok) throw new ApiError(res.status, env.error?.code ?? "INTERNAL", env.error?.message ?? "", env.error?.details);
  return env.data as T;
}
