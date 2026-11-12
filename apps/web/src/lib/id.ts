// 숫자 ID 파싱 (api.md 1장: 모든 ID 는 양의 정수). 옛 경로(/g/<id>), 쿠키에서 받은 문자열을 검사한다 (#311 부터 새 주소에는 번호가 없다)

/** 양의 정수 문자열이면 숫자, 아니면 null. '01', '1e3', '1.0', 안전 정수 범위 밖은 거부 */
export function parseId(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
