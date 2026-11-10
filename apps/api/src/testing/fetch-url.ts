/** fetch 목의 첫 인자(RequestInfo | URL) 에서 URL 문자열만 꺼낸다 (테스트 전용) */
export function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
