// (#245) 이메일 로그인 순수 함수와 상수 (docs/설계/이메일-로그인.md 3장, 6장).
// 화면, route handler, 목이 같이 쓰므로 React, next/* 를 import 하지 않는다.
import type { ApiErrorDetail } from "./envelope";

/** 처음 가입 티켓 쿠키 (D-114). httpOnly, 30분 */
export const SIGNUP_COOKIE = "wwm_signup";
export const SIGNUP_MAX_AGE = 1800;

/** 메일 한 통의 쿨다운과 유효 시간 (API request 응답의 기본값과 같다) */
export const DEFAULT_COOLDOWN_SEC = 60;
export const DEFAULT_EXPIRES_SEC = 900;

export const EMAIL_MAX_LENGTH = 191;
export const OTP_LENGTH = 6;
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;

/** 웹 기능 스위치 (D-119). 운영은 `EMAIL_LOGIN_ENABLED=1` 일 때만. 목 모드(API_MOCK=1)는 `0` 으로 끄지 않는 한 켠다 */
export function emailLoginEnabled(flag: string | undefined, mock = false): boolean {
  if (flag === "1") return true;
  return mock && flag !== "0";
}

/** trim + 소문자 (D-110). 점, + 는 그대로 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// API IsEmail({ allow_utf8_local_part: false, require_tld: true }) 를 화면에서 대략 맞춘다. 최종 판정은 API
const EMAIL_SHAPE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

/** [메일 받기] 를 켤 모양인지 (정규화한 값으로) */
export function isEmailShape(raw: string): boolean {
  const e = normalizeEmail(raw);
  return e.length > 0 && e.length <= EMAIL_MAX_LENGTH && EMAIL_SHAPE.test(e);
}

/** 코드 칸 입력값: 숫자만, 6자까지. 붙여넣기 "123 456", "123-456" → "123456" */
export function normalizeOtp(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

/** 메일 링크 토큰 모양 (32바이트 base64url 43자) */
export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** 이메일 가리기 (6-4): 로컬 앞 2자(2자 이하면 1자) + *** + @도메인 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const keep = local.length <= 2 ? 1 : 2;
  return `${local.slice(0, keep)}***${email.slice(at)}`;
}

/** 남은 초 → "0:42" */
export function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** until(ms) 까지 남은 초 (올림, 0 이상) */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/** 닉네임 제출 가능 (앞뒤 공백 뺀 2~20자, D-114) */
export function nicknameOk(raw: string): boolean {
  const n = raw.trim().length;
  return n >= NICKNAME_MIN && n <= NICKNAME_MAX;
}

/* ---------- "메일을 보냈어요" 단계 기억 (sessionStorage, 6-3) ---------- */

export const EMAIL_STORAGE_KEY = "wwm_email_login";

export type SentState = { email: string; sentAt: number; cooldownUntil: number };

/** sessionStorage 값 읽기. 모양이 틀리거나 15분이 지났으면 null */
export function parseSentState(raw: string | null, now: number, expiresSec = DEFAULT_EXPIRES_SEC): SentState | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.email !== "string" || !o.email || typeof o.sentAt !== "number" || !Number.isFinite(o.sentAt)) return null;
    if (now - o.sentAt > expiresSec * 1000 || o.sentAt > now + 60_000) return null;
    const cooldownUntil = typeof o.cooldownUntil === "number" && Number.isFinite(o.cooldownUntil) ? o.cooldownUntil : o.sentAt;
    return { email: o.email, sentAt: o.sentAt, cooldownUntil };
  } catch {
    return null;
  }
}

/* ---------- 오류 (4-3, 6-6) ---------- */

export type EmailErrorInfo = {
  /** COOLDOWN | HOURLY | IP (EMAIL_RATE_LIMITED), INVALID | USED | EXPIRED (EMAIL_LINK_INVALID) */
  reason?: string;
  retryAfterSec?: number;
  attemptsLeft?: number;
};

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/**
 * error.details 를 읽는다. 설계 4-3 의 객체 `{ reason, retryAfterSec, attemptsLeft }` 와
 * 기존 봉투 모양(`[{ field, message }]`, field 가 키, message 가 값) 둘 다 받는다
 */
export function readEmailErrorDetails(details: unknown): EmailErrorInfo {
  let o: Record<string, unknown> = {};
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d && typeof d === "object" && typeof (d as ApiErrorDetail).field === "string") {
        o[(d as ApiErrorDetail).field] = (d as ApiErrorDetail).message;
      }
    }
  } else if (details && typeof details === "object") {
    o = details as Record<string, unknown>;
  }
  const info: EmailErrorInfo = {};
  if (typeof o.reason === "string") info.reason = o.reason;
  const r = num(o.retryAfterSec);
  if (r !== undefined) info.retryAfterSec = Math.max(0, Math.ceil(r));
  const a = num(o.attemptsLeft);
  if (a !== undefined) info.attemptsLeft = Math.max(0, Math.floor(a));
  return info;
}

/** 웹 봉투로 옮길 details (`[{ field, message }]`). 브라우저 쪽 lib/api.ts 는 배열만 읽는다 */
export function toDetailArray(info: EmailErrorInfo): ApiErrorDetail[] | undefined {
  const out: ApiErrorDetail[] = [];
  if (info.reason !== undefined) out.push({ field: "reason", message: info.reason });
  if (info.retryAfterSec !== undefined) out.push({ field: "retryAfterSec", message: String(info.retryAfterSec) });
  if (info.attemptsLeft !== undefined) out.push({ field: "attemptsLeft", message: String(info.attemptsLeft) });
  return out.length ? out : undefined;
}

export const GENERIC_ERROR = "잠시 후 다시 시도해 주세요";

/** 요청(①, ② 다시 보내기) 오류 문구. COOLDOWN 은 호출부가 카운트다운으로 따로 다룬다 */
export function requestErrorMessage(code: string, info: EmailErrorInfo): string {
  if (code === "EMAIL_RATE_LIMITED") {
    if (info.reason === "COOLDOWN") {
      return `방금 메일을 보냈어요. ${info.retryAfterSec ?? DEFAULT_COOLDOWN_SEC}초 뒤에 다시 보낼 수 있어요`;
    }
    if (info.reason === "HOURLY") {
      const m = Math.max(1, Math.ceil((info.retryAfterSec ?? 3600) / 60));
      return `메일은 1시간에 5번까지 보낼 수 있어요. ${m}분 뒤에 다시 시도해 주세요`;
    }
    return "요청이 너무 많아요. 잠시 후 다시 시도해 주세요";
  }
  if (code === "EMAIL_NOT_CONFIGURED") return "지금은 이메일로 로그인할 수 없어요. 다른 방법으로 로그인해 주세요";
  if (code === "VALIDATION_FAILED") return "이메일 주소를 다시 확인해 주세요";
  return GENERIC_ERROR;
}

/** 코드 입력(②) 오류 문구 */
export function codeErrorMessage(code: string, info: EmailErrorInfo): string {
  switch (code) {
    case "EMAIL_CODE_INVALID":
      return info.attemptsLeft !== undefined ? `코드가 맞지 않아요. ${info.attemptsLeft}번 더 입력할 수 있어요` : "코드가 맞지 않아요";
    case "EMAIL_CODE_LOCKED":
      return "코드를 5번 틀렸어요. [다시 보내기]로 새 메일을 받아 주세요";
    case "EMAIL_CODE_EXPIRED":
      return "코드가 만료됐거나 이미 사용됐어요. 새 메일을 받아 주세요";
    case "EMAIL_NOT_CONFIGURED":
      return "지금은 이메일로 로그인할 수 없어요. 다른 방법으로 로그인해 주세요";
    case "VALIDATION_FAILED":
      return "코드 6자리를 다시 확인해 주세요";
    default:
      return GENERIC_ERROR;
  }
}

/** /login/email?error= 로 들어오는 문구 */
export const ENTRY_ERRORS: Record<string, string> = {
  SIGNUP_TOKEN_INVALID: "가입 시간이 지났어요. 이메일을 다시 입력해 주세요",
  EMAIL_NOT_CONFIGURED: "지금은 이메일로 로그인할 수 없어요. 다른 방법으로 로그인해 주세요",
};

/* ---------- 링크 확인 화면 (6-4) ---------- */

export type LinkView = "valid" | "expired" | "used" | "unavailable" | "off";

/** inspect 상태 또는 POST 실패 reason → 화면 */
export function linkViewOf(state: string | null | undefined): LinkView {
  if (state === "VALID") return "valid";
  if (state === "USED") return "used";
  if (state === "EXPIRED" || state === "INVALID") return "expired";
  if (state === "EMAIL_NOT_CONFIGURED") return "off";
  return "unavailable";
}

/* ---------- route handler 결과 (6-1) ---------- */

export type AuthResult = { kind: "SESSION"; token: string; next: string } | { kind: "SIGNUP"; signupToken: string; next: string };

/** API AuthResult 모양 확인 */
export function readAuthResult(data: unknown): AuthResult | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const next = typeof o.next === "string" ? o.next : "/";
  if (o.kind === "SESSION" && typeof o.token === "string" && o.token) return { kind: "SESSION", token: o.token, next };
  if (o.kind === "SIGNUP" && typeof o.signupToken === "string" && o.signupToken) {
    return { kind: "SIGNUP", signupToken: o.signupToken, next };
  }
  return null;
}

export const EMAIL_LOGIN_PATH = "/login/email";

/** 이메일 로그인 화면 주소 (next 가 / 면 생략) */
export function emailLoginHref(next: string): string {
  return next && next !== "/" ? `${EMAIL_LOGIN_PATH}?next=${encodeURIComponent(next)}` : EMAIL_LOGIN_PATH;
}

/** X-Client-IP 로 실을 값: x-forwarded-for 첫 값, 없으면 x-real-ip, 없으면 "unknown" (4-1) */
export function clientIpOf(forwardedFor: string | null, realIp: string | null): string {
  const first = forwardedFor?.split(",")[0]?.trim();
  if (first) return first.slice(0, 64);
  const real = realIp?.trim();
  return real ? real.slice(0, 64) : "unknown";
}
