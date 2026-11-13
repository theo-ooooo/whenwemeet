// 글자 수는 서버와 같이 유니코드 코드포인트로 센다 (#63). input maxLength 는 UTF-16 단위라 이모지가 2로 세진다
export function charCount(s: string): number {
  return Array.from(s).length;
}

/** 앞에서부터 max 코드포인트까지만 남긴다 */
export function clampChars(s: string, max: number): string {
  const arr = Array.from(s);
  return arr.length > max ? arr.slice(0, max).join("") : s;
}

/** (#378) 글자 수 표시는 거의 다 찼을 때만 (상한의 80% 이상). 이름, 제목, 메모 칸 공통 */
export function nearLimit(count: number, max: number): boolean {
  return count >= Math.ceil(max * 0.8);
}
