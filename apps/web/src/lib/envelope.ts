// 응답 봉투의 모양을 아는 유일한 곳.
// 브라우저(lib/api.ts), 서버(lib/server-api.ts, lib/upstream.ts, app/api 프록시), 목(mocks/handler.ts) 모두 여기만 거친다.
// 현재 모양 (docs/설계/api.md 1장, #27):
//   성공 { status, data, message: "OK" }
//   실패 { status, data: null, message, error: { code, details?: [{ field, message }] } }
// status 는 HTTP 상태 코드와 같은 값. 봉투가 바뀌면 이 파일만 고치면 된다. 훅과 화면은 봉투 모양을 모른다.

/** (#186) API 요청 제한(429 RATE_LIMITED) 의 화면 문구. 화면마다 다른 기본 문구 대신 이것 하나 */
export const RATE_LIMITED = "RATE_LIMITED";
export const RATE_LIMITED_MESSAGE = "잠시 후 다시 시도해 주세요";

/** 검증 실패 시 필드별 위반 한 줄 */
export type ApiErrorDetail = { field: string; message: string };

/** 봉투를 푼 뒤 호출한 쪽이 보는 오류. message 는 봉투 최상위 message 를 옮겨 담는다 */
export type ApiErrorInfo = { code: string; message: string; details?: ApiErrorDetail[] };

type OkEnvelope<T> = { status: number; data: T; message: "OK" };
type ErrorEnvelope = {
  status: number;
  data: null;
  message: string;
  error: { code: string; details?: ApiErrorDetail[] };
};

/** 성공 본문 */
export function okBody<T>(data: T, status = 200): unknown {
  return { status, data, message: "OK" } satisfies OkEnvelope<T>;
}

/** 실패 본문. details 가 없으면 키 자체를 넣지 않는다 (API 와 같음) */
export function errorBody(status: number, code: string, message: string, details?: ApiErrorDetail[]): unknown {
  const error: ErrorEnvelope["error"] = details ? { code, details } : { code };
  return { status, data: null, message, error } satisfies ErrorEnvelope;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * 상태 코드와 파싱된 본문에서 data / error 를 꺼낸다.
 * ok=false 면 실패. 본문에 error 가 없어도(빈 본문, 게이트웨이 오류) 실패로 본다. 기본 문구는 호출한 쪽이 정한다.
 */
export function readEnvelope<T>(status: number, body: unknown): { ok: boolean; data: T | undefined; error: ApiErrorInfo | null } {
  const json = isObject(body) ? body : {};
  const rawError = isObject(json.error) ? json.error : null;

  if (status >= 400 || rawError) {
    if (!rawError || typeof rawError.code !== "string") {
      return { ok: false, data: undefined, error: null };
    }
    const error: ApiErrorInfo = {
      code: rawError.code,
      message: typeof json.message === "string" ? json.message : "",
    };
    if (Array.isArray(rawError.details)) error.details = rawError.details as ApiErrorDetail[];
    return { ok: false, data: undefined, error };
  }
  return { ok: true, data: json.data as T | undefined, error: null };
}
