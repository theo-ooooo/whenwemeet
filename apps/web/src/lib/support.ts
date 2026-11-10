// 고객 지원 연락처 (#148). 지원 페이지, 개인정보처리방침이 같은 값을 쓴다
export const SUPPORT_EMAIL = "kkwondev@gmail.com";

/** 제목을 미리 채운 mailto 링크 */
export function supportMailto(subject: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`[언제볼까] ${subject}`)}`;
}
