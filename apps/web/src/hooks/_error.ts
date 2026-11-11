// 훅이 화면에 돌려주는 오류 모양. 화면은 lib/api 의 ApiError 클래스를 모르고 이 평범한 객체만 본다
import { ApiError } from "@/lib/api";
import { RATE_LIMITED, RATE_LIMITED_MESSAGE, type ApiErrorDetail } from "@/lib/envelope";

// details: 검증 실패(400 VALIDATION_FAILED) 시 필드별 위반 목록. 없으면 키가 없다
export type ApiFailure = { status: number; code: string; message: string; details?: ApiErrorDetail[] };

export function toFailure(e: unknown): ApiFailure {
  if (e instanceof ApiError) {
    // (#186) 요청 제한은 어느 화면이든 같은 문구 (토스트, 칸 아래 오류 모두 message 를 쓴다)
    const message = e.code === RATE_LIMITED ? RATE_LIMITED_MESSAGE : e.message;
    const f: ApiFailure = { status: e.status, code: e.code, message };
    if (e.details) f.details = e.details;
    return f;
  }
  return { status: 0, code: "INTERNAL", message: "" };
}

/** 사용자에게 보여줄 문구. API message 우선, 없으면 fallback */
export function messageOf(e: ApiFailure | null | undefined, fallback: string): string {
  return e?.message || fallback;
}

/** 쿼리스트링 조립 (undefined 는 뺀다) */
export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
