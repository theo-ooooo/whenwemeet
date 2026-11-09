// 훅이 화면에 돌려주는 오류 모양. 화면은 lib/api 의 ApiError 클래스를 모르고 이 평범한 객체만 본다
import { ApiError } from "@/lib/api";

export type ApiFailure = { status: number; code: string; message: string };

export function toFailure(e: unknown): ApiFailure {
  if (e instanceof ApiError) return { status: e.status, code: e.code, message: e.message };
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
