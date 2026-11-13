/**
 * (#193) iCalendar(RFC 5545) 본문 만들기. 외부 캘린더 구독 피드가 쓰는 순수 함수 (설계 캘린더-내보내기.md 3장).
 * - 줄 끝 CRLF, 한 줄 75 옥텟을 넘으면 접는다 (3.1). UTF-8 글자 중간에서 자르지 않는다
 * - TEXT 값의 `\` `;` `,` 줄바꿈 이스케이프 (3.3.11)
 * - 시간 일정은 UTC(`...Z`)라 VTIMEZONE 이 필요 없다. 종일은 `VALUE=DATE`, 끝은 배타 (3.8.2.2)
 */

export const ICS_PRODID = '-//whenwemeet.day//whenwemeet calendar feed 1.0//KO';
/** 한 줄 최대 옥텟 (줄 끝 CRLF 제외) */
export const ICS_LINE_OCTETS = 75;
const CRLF = '\r\n';

/** 시각 하나. 종일은 KST 날짜 'YYYY-MM-DD', 시간 일정은 UTC 순간 */
export type IcsTime = { allDay: true; date: string } | { allDay: false; at: Date };

export interface IcsEvent {
  uid: string;
  /** 이 정보의 마지막 개정 시각. 본문이 같으면 같은 값이어야 ETag 가 맞는다 (요청 시각을 쓰지 않는다) */
  dtstamp: Date;
  lastModified: Date;
  sequence: number;
  start: IcsTime;
  /** 배타 끝. 종일이면 마지막 날 다음 날 */
  end: IcsTime;
  summary: string;
  description?: string | null;
  url?: string | null;
  /** true 면 바쁨으로 세지 않는다 (기념일) */
  transparent?: boolean;
}

export interface IcsCalendar {
  /** X-WR-CALNAME, NAME */
  name: string;
  /** IANA 이름. 표시용 힌트 (시각은 모두 UTC) */
  timezone: string;
  /** 새로고침 힌트 ISO 8601 기간 (`PT1H`). RFC 7986 REFRESH-INTERVAL 과 X-PUBLISHED-TTL */
  refreshInterval: string;
  events: readonly IcsEvent[];
}

/** TEXT 값 이스케이프. 제어 문자(탭 제외)는 TEXT 에 쓸 수 없어 지운다 */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * 한 줄을 75 옥텟 단위로 접는다. 이어지는 줄은 공백 하나로 시작하므로 내용은 74 옥텟.
 * 글자(코드 포인트) 단위로 세어 한글(3바이트), 이모지(4바이트)를 가르지 않는다
 */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= ICS_LINE_OCTETS) return line;
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  let limit = ICS_LINE_OCTETS;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
      limit = ICS_LINE_OCTETS - 1;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** UTC 형식 `20261122T090000Z` (초 아래 버림) */
export function formatUtc(at: Date): string {
  return (
    `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  );
}

/** 'YYYY-MM-DD' → `YYYYMMDD` */
export function formatDate(date: string): string {
  return date.replace(/-/g, '');
}

function timeLine(name: 'DTSTART' | 'DTEND', time: IcsTime): string {
  return time.allDay ? `${name};VALUE=DATE:${formatDate(time.date)}` : `${name}:${formatUtc(time.at)}`;
}

function eventLines(event: IcsEvent): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${formatUtc(event.dtstamp)}`,
    timeLine('DTSTART', event.start),
    timeLine('DTEND', event.end),
    `SUMMARY:${escapeText(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push(`LAST-MODIFIED:${formatUtc(event.lastModified)}`, `SEQUENCE:${event.sequence}`);
  if (event.transparent) lines.push('TRANSP:TRANSPARENT');
  lines.push('END:VEVENT');
  return lines;
}

/** VCALENDAR 본문. 모든 줄을 접고 CRLF 로 잇는다 (마지막 줄도 CRLF 로 끝남) */
export function buildIcs(calendar: IcsCalendar): string {
  const name = escapeText(calendar.name);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${name}`,
    `NAME:${name}`,
    `X-WR-TIMEZONE:${calendar.timezone}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${calendar.refreshInterval}`,
    `X-PUBLISHED-TTL:${calendar.refreshInterval}`,
    ...calendar.events.flatMap(eventLines),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
