// (#515) 공지 표시 규칙 (D-285). 본문은 일반 텍스트: 빈 줄로 문단을 나누고 https 주소만 링크로 그린다.
// HTML 로 해석하지 않으므로 화면은 조각을 글자와 <a> 로만 그린다 (dangerouslySetInnerHTML 금지)
import { dateKeyOf, formatDateKo } from "./date";
import type { NoticeKind } from "./types";

export const NOTICE_KIND_LABEL: Record<NoticeKind, string> = { notice: "공지", update: "업데이트", maintenance: "점검" };

export const NOTICE_KINDS: NoticeKind[] = ["notice", "update", "maintenance"];

/** 제목 상한 (API 와 같다) */
export const NOTICE_TITLE_MAX = 100;
export const NOTICE_BODY_MAX = 20_000;

export type NoticeSegment = { type: "text"; text: string } | { type: "link"; href: string };

// 주소는 URL 에 쓰는 ASCII 문자까지만 (#519: "(https://a.b)과" 처럼 한글이 바로 붙어도 거기서 끊는다).
// 주소 끝의 문장 부호(마침표, 쉼표, 닫는 괄호 등)는 링크에서 뺀다
const URL_RE = /https:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%()]+/g;
const TRAILING = /[.,!?;:)\]}'"”’。、]+$/;

/** 한 문단을 글자와 링크 조각으로. https 만 링크 (http, javascript: 등은 글자 그대로) */
export function noticeSegments(paragraph: string): NoticeSegment[] {
  const out: NoticeSegment[] = [];
  let last = 0;
  for (const m of paragraph.matchAll(URL_RE)) {
    const raw = m[0];
    const href = raw.replace(TRAILING, "");
    const start = m.index ?? 0;
    if (href.length <= "https://".length) continue;
    if (start > last) out.push({ type: "text", text: paragraph.slice(last, start) });
    out.push({ type: "link", href });
    last = start + href.length;
  }
  if (last < paragraph.length) out.push({ type: "text", text: paragraph.slice(last) });
  return out;
}

/** 본문 → 문단 목록. 빈 줄(공백만 있는 줄 포함)로 나누고 앞뒤 공백 줄은 버린다. 문단 안 한 줄 바꿈은 화면이 그대로 둔다 */
export function noticeParagraphs(body: string): NoticeSegment[][] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n(?:[ \t]*\n)+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.trim() !== "")
    .map(noticeSegments);
}

/** 게시일 "2026년 11월 25일 (수)". 초안은 "초안" */
export function noticeDate(publishedAt: string | null): string {
  return publishedAt ? formatDateKo(dateKeyOf(publishedAt), true) : "초안";
}

/**
 * (#538) 달력 위 새 공지 띠를 이 기기에서 감추는 안내 키 (lib/hint.ts). 공지마다 따로라 더 새 공지가 오면 다시 보인다 (D-291).
 * 띠의 ×, 띠를 눌러 연 상세, 같은 공지의 팝업을 닫을 때, 공지 상세를 열 때 감춘다
 */
export function noticeBannerKey(id: number): string {
  return `notice.${id}`;
}
