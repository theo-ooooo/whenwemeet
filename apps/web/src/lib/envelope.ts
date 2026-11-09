// 응답 봉투의 모양을 아는 유일한 곳.
// 브라우저(lib/api.ts), 서버(lib/server-api.ts, lib/upstream.ts, app/api 프록시), 목(mocks/handler.ts) 모두 여기만 거친다.
// 현재 모양: 성공 { data } / 실패 { error: { code, message } } (docs/설계/api.md).
// 봉투가 바뀌면 이 파일만 고치면 된다. 훅과 화면은 봉투 모양을 모른다.

export type ApiErrorInfo = { code: string; message: string };

type Envelope<T> = { data?: T; error?: ApiErrorInfo };

/** 성공 본문 */
export function okBody<T>(data: T): unknown {
  return { data } satisfies Envelope<T>;
}

/** 실패 본문 */
export function errorBody(code: string, message: string): unknown {
  return { error: { code, message } } satisfies Envelope<never>;
}

/**
 * 상태 코드와 파싱된 본문에서 data / error 를 꺼낸다.
 * ok=false 면 실패. 본문에 error 가 없어도(빈 본문, 게이트웨이 오류) 실패로 본다. 기본 문구는 호출한 쪽이 정한다.
 */
export function readEnvelope<T>(
  status: number,
  body: unknown,
): { ok: boolean; data: T | undefined; error: ApiErrorInfo | null } {
  const json = (body ?? {}) as Envelope<T>;
  if (status >= 400 || json.error) {
    return { ok: false, data: undefined, error: json.error ?? null };
  }
  return { ok: true, data: json.data, error: null };
}
