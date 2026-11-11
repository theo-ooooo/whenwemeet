// 한국어 조사: 이름 끝 글자 받침 유무로 '이/가' 를 고른다 ("경원이 등록", "지우가 등록")
export function iGa(name: string): string {
  const last = name.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return `${name} 님이`; // 한글이 아니면 '님이' 로 둔다
  return code % 28 === 0 ? `${name}가` : `${name}이`;
}

/** 받침 유무로 조사 고르기 ("닉네임을", "팀 이름은"). 한글이 아니면 받침 없음 쪽 */
export function hasBatchim(word: string): boolean {
  const code = word.trim().slice(-1).charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}

/** '으로/로' 고르기 (받침 없음, ㄹ 받침은 '로'). 조사만 돌려준다 */
export function euroJosa(word: string): string {
  const code = word.trim().slice(-1).charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "로";
  const jong = code % 28;
  return jong === 0 || jong === 8 ? "로" : "으로";
}
export const eulReul = (w: string) => `${w}${hasBatchim(w) ? "을" : "를"}`;
export const eunNeun = (w: string) => `${w}${hasBatchim(w) ? "은" : "는"}`;

/** 이름 칸 공통 규칙 (닉네임, 팀 이름, 표시 이름 #171). 통과하면 null */
export function nameProblem(label: string, value: string, max: number, allowEmpty = false): string | null {
  const n = Array.from(value.trim()).length;
  if (n === 0 && !allowEmpty) return `${eulReul(label)} 입력해 주세요`;
  if (n > max) return `${eunNeun(label)} ${max}자까지 쓸 수 있어요`;
  return null;
}
