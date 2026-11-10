// 한국어 조사: 이름 끝 글자 받침 유무로 '이/가' 를 고른다 ("경원이 등록", "지우가 등록")
export function iGa(name: string): string {
  const last = name.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return `${name} 님이`; // 한글이 아니면 '님이' 로 둔다
  return code % 28 === 0 ? `${name}가` : `${name}이`;
}
