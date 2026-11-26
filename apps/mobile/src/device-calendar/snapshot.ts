// (#549) 휴대폰 캘린더 스냅샷 검사 (docs/설계/앱.md 4.9, D-294).
// 웹이 calendarSync 브리지로 보낸 "켠 팀들의 일정 창(과거 30일 ~ 미래 180일, 반복은 회차마다)" 을 검사해 쓰는 칸만 새 객체로 옮긴다.
// 매핑 규칙은 ICS 피드(docs/설계/캘린더-내보내기.md 3장)와 같다: UID, 제목, 참여자 줄, 종일은 KST 날짜와 배타 끝.
// RN 과 expo-calendar 를 import 하지 않는 순수 함수만 둔다 (jest 대상).

/** calendarSync 메시지(JSON 문자열) 최대 길이. 웹 lib/device-calendar.ts CALENDAR_MESSAGE_MAX 와 같은 값 */
export const CALENDAR_MESSAGE_MAX = 1_500_000;
/** 스냅샷 일정 수 상한 (웹이 넘으면 먼 미래부터 뺀다) */
export const CALENDAR_MAX_EVENTS = 3000;
/** 일정 한 건 길이 상한. 서버 일정 길이 30일(D-15) + 종일 배타 끝 여유 */
const MAX_EVENT_MS = 32 * 24 * 60 * 60 * 1000;
/** generatedAt 기준 이 범위 밖 일정은 받지 않는다 (셸이 우리 캘린더를 훑는 범위 안에 들어오게) */
export const CALENDAR_SPAN_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ICS 와 같은 UID: 일정 `e{id}@…`, 회차 `e{id}-{YYYYMMDD}@…`. 기념일(a), 생일(b)은 아직 보내지 않지만 같은 모양을 받는다 */
const UID_RE = /^[eab][0-9]{1,12}(-[0-9]{8})?@whenwemeet\.day$/;

type Common = {
  uid: string;
  /** 제목 (예외 제목 반영) */
  title: string;
  location?: string;
  /** "참여: 민지, 지훈" (+ 메모) */
  notes?: string;
  /** 웹 일정 상세 주소 (웹 오리진만) */
  url?: string;
};

/** 종일: KST 날짜 'YYYY-MM-DD', end 는 배타 (ICS DTEND;VALUE=DATE 와 같음) */
export type AllDayEvent = Common & { allDay: true; start: string; end: string };
/** 시간 일정: ISO 순간 */
export type TimedEvent = Common & { allDay: false; start: string; end: string };
export type CalendarEvent = AllDayEvent | TimedEvent;

export type CalendarSnapshot = {
  /** 웹이 만든 시각 (ISO) */
  generatedAt: string;
  events: CalendarEvent[];
};

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 1~max 자. 줄바꿈 허용 여부에 따라 제어문자 검사 */
function text(v: unknown, max: number, multiline = false): string | null {
  if (typeof v !== "string" || v.length < 1 || v.length > max) return null;
  const bad = multiline ? /[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/ : /[\u0000-\u001f\u007f\u2028\u2029]/;
  return bad.test(v) ? null : v;
}

/** 없으면 undefined, 있으면 검사 (틀리면 false) */
function optText(v: unknown, max: number, multiline = false): string | undefined | false {
  if (v === undefined || v === null) return undefined;
  return text(v, max, multiline) ?? false;
}

/** 'YYYY-MM-DD' 이고 실제로 있는 날 */
export function isDateKey(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** KST 날짜 키의 자정 (UTC ms) */
export function kstMidnight(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
}

/** ISO 순간 (Z 또는 ±hh:mm 이 붙은 것만). 아니면 null */
function instant(v: unknown): number | null {
  if (typeof v !== "string" || v.length > 40) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** 웹 오리진의 https 주소만 */
function webUrl(v: unknown, webOrigin: string): string | undefined | false {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length > 512) return false;
  try {
    const u = new URL(v);
    return u.origin === webOrigin ? v : false;
  } catch {
    return false;
  }
}

/**
 * 브리지 메시지의 snapshot 을 검사한다. 하나라도 어긋나면 통째로 null (부분 스냅샷으로 기기 일정을 지우지 않는다).
 * 출처(웹 오리진)와 전체 길이는 parseBridgeMessage 가 먼저 본다
 */
export function parseCalendarSnapshot(v: unknown, webOrigin: string): CalendarSnapshot | null {
  const o = record(v);
  if (!o) return null;
  const generated = instant(o.generatedAt);
  if (generated === null) return null;
  if (!Array.isArray(o.events) || o.events.length > CALENDAR_MAX_EVENTS) return null;
  const lo = generated - CALENDAR_SPAN_DAYS * DAY_MS;
  const hi = generated + CALENDAR_SPAN_DAYS * DAY_MS;

  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  for (const raw of o.events) {
    const r = record(raw);
    if (!r) return null;
    const uid = typeof r.uid === "string" && UID_RE.test(r.uid) ? r.uid : null;
    const title = text(r.title, 200);
    const location = optText(r.location, 300);
    const notes = optText(r.notes, 2000, true);
    const url = webUrl(r.url, webOrigin);
    if (!uid || seen.has(uid) || !title || location === false || notes === false || url === false) return null;
    seen.add(uid);

    let startMs: number;
    let endMs: number;
    if (r.allDay === true) {
      if (!isDateKey(r.start) || !isDateKey(r.end)) return null;
      startMs = kstMidnight(r.start);
      endMs = kstMidnight(r.end);
    } else if (r.allDay === false) {
      const s = instant(r.start);
      const e = instant(r.end);
      if (s === null || e === null) return null;
      startMs = s;
      endMs = e;
    } else {
      return null;
    }
    if (endMs <= startMs || endMs - startMs > MAX_EVENT_MS || startMs < lo || endMs > hi) return null;

    const common = {
      uid,
      title,
      ...(location ? { location } : {}),
      ...(notes ? { notes } : {}),
      ...(url ? { url } : {}),
    };
    events.push(
      r.allDay === true
        ? { ...common, allDay: true, start: r.start as string, end: r.end as string }
        : { ...common, allDay: false, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() },
    );
  }
  return { generatedAt: new Date(generated).toISOString(), events };
}
