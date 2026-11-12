// (#197) 홈 화면 위젯 스냅샷: 검사와 화면 값 계산 (docs/설계/앱.md 4.7, D-187 ~ D-190).
// 웹이 widgetSnapshot 브리지로 보낸 "오늘부터 7일 요약 + 가까운 기념일" 을 검사하고, 어느 순간(now)의 위젯 화면 값을 만든다.
// RN 과 위젯 라이브러리를 import 하지 않는 순수 함수만 둔다 (jest 대상). 날짜는 모두 KST 고정(+09:00).

/** 스냅샷 JSON 문자열 최대 길이 (브리지 메시지 전체). 기획 "최대 16KB" */
export const WIDGET_MESSAGE_MAX = 16_384;
/** 스냅샷이 이보다 오래되면 "앱을 열면 새로 고쳐져요" */
export const WIDGET_STALE_MS = 24 * 60 * 60 * 1000;
/** 하루에 위젯이 보여 주는 일정 수 (중간 크기 3개) */
export const WIDGET_ROWS = 3;
/** 멤버 색 순번 개수 (웹 lib/colors.ts DISPLAY, --m1 ~ --m8, #350 D-216) */
export const WIDGET_COLOR_COUNT = 8;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export type SnapshotEvent = {
  /** 팀 id (groups 안에 있어야 한다) */
  g: number;
  /** 제목 (웹이 30자로 자름) */
  title: string;
  /** 그날 기준 시각 글자: "10:00", "종일", "~18:00" */
  time: string;
  /** (#350) 일정 색을 고른 일정만, 색 순번 0~7. 없으면 팀 색 */
  c?: number;
};

export type SnapshotDay = {
  /** KST 'YYYY-MM-DD' */
  date: string;
  /** 위젯에 보일 앞 3개 (종일 먼저, 시작 순) */
  events: SnapshotEvent[];
  /** 그날 일정 전체 수 (+N개 계산) */
  total: number;
};

/** (#311) code 는 누름 주소의 `?team=` 에 쓰는 팀 공개 코드 (소문자 영숫자 8자) */
export type SnapshotGroup = { id: number; name: string; /** 멤버 색 순번 0~7 (#350: 새 웹은 c, 옛 웹은 color 0~6) */ color: number; code: string };

export type SnapshotAnniversary = {
  g: number;
  /** "처음 만난 날 300일" 처럼 항목 이름 */
  title: string;
  /** 그 항목의 날짜 (KST 'YYYY-MM-DD', 오늘 이후) */
  date: string;
};

export type WidgetSnapshot = {
  /** 웹이 만든 시각 (ISO) */
  generatedAt: string;
  groups: SnapshotGroup[];
  /** 오늘부터 연속된 날 (최대 7개). 크기 제한으로 뒤쪽이 잘리면 짧아진다 */
  days: SnapshotDay[];
  /** 가까운 순 최대 3개 */
  anniversaries: SnapshotAnniversary[];
};

/* ---------- 검사 ---------- */

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 색 순번 0~7 이면 그 값, 아니면 null */
function colorIdx(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < WIDGET_COLOR_COUNT ? v : null;
}

/** 1~max 자, 제어문자 없음 */
function text(v: unknown, max: number): string | null {
  if (typeof v !== "string" || v.length < 1 || v.length > max) return null;
  return /[\u0000-\u001f\u007f\u2028\u2029]/.test(v) ? null : v;
}

function id(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
}

/** 'YYYY-MM-DD' 이고 실제로 있는 날 */
export function isDateKey(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * 브리지 메시지의 snapshot 을 검사해 쓰는 칸만 새 객체로 옮긴다. 하나라도 어긋나면 통째로 null.
 * 출처(웹 오리진)와 전체 길이는 parseBridgeMessage 가 먼저 본다
 */
export function parseWidgetSnapshot(v: unknown): WidgetSnapshot | null {
  const o = record(v);
  if (!o) return null;
  if (typeof o.generatedAt !== "string" || o.generatedAt.length > 40 || Number.isNaN(Date.parse(o.generatedAt))) return null;

  if (!Array.isArray(o.groups) || o.groups.length > 50) return null;
  const groups: SnapshotGroup[] = [];
  for (const raw of o.groups) {
    const r = record(raw);
    const gid = r && id(r.id);
    const name = r && text(r.name, 20);
    // (#350) 새 웹은 c(0~7, 핑크 포함)도 싣는다. 옛 셸 호환으로 color 는 0~6 그대로 온다
    const base = colorIdx(r?.color);
    const color = colorIdx(r?.c) ?? base;
    const code = r?.code;
    if (!gid || !name || base === null || color === null) return null;
    if (typeof code !== "string" || !/^[a-z0-9]{8}$/.test(code)) return null;
    groups.push({ id: gid, name, color, code });
  }
  const known = new Set(groups.map((g) => g.id));
  const groupRef = (x: unknown) => {
    const gid = id(x);
    return gid && known.has(gid) ? gid : null;
  };

  if (!Array.isArray(o.days) || o.days.length > 7) return null;
  const days: SnapshotDay[] = [];
  for (const raw of o.days) {
    const r = record(raw);
    if (!r || !isDateKey(r.date) || !Array.isArray(r.events) || r.events.length > WIDGET_ROWS) return null;
    // 날은 오늘부터 하루씩 이어져야 한다 (위젯이 날짜로 바로 찾는다)
    if (days.length > 0 && r.date !== addDays(days[days.length - 1].date, 1)) return null;
    const events: SnapshotEvent[] = [];
    for (const e of r.events) {
      const er = record(e);
      const g = er && groupRef(er.g);
      const title = er && text(er.title, 30);
      const time = er && text(er.time, 16);
      if (!g || !title || !time) return null;
      // (#350) 일정 색. 모르는 값은 버리고 팀 색으로 (스냅샷 전체를 버리지 않는다)
      const c = colorIdx(er.c);
      events.push(c === null ? { g, title, time } : { g, title, time, c });
    }
    const total = r.total;
    if (typeof total !== "number" || !Number.isInteger(total) || total < events.length || total > 999) return null;
    days.push({ date: r.date, events, total });
  }

  if (!Array.isArray(o.anniversaries) || o.anniversaries.length > 3) return null;
  const anniversaries: SnapshotAnniversary[] = [];
  for (const raw of o.anniversaries) {
    const r = record(raw);
    const g = r && groupRef(r.g);
    const title = r && text(r.title, 40);
    if (!g || !title || !isDateKey(r.date)) return null;
    anniversaries.push({ g, title, date: r.date });
  }

  return { generatedAt: new Date(Date.parse(o.generatedAt)).toISOString(), groups, days, anniversaries };
}

/* ---------- 날짜 (KST) ---------- */

const pad = (n: number) => String(n).padStart(2, "0");

/** 순간 → KST 날짜 키 */
export function kstDateKey(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** KST 날짜 키의 자정 (UTC ms) */
export function kstMidnight(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
}

export function addDays(key: string, n: number): string {
  return kstDateKey(kstMidnight(key) + n * DAY_MS);
}

/** b - a (일) */
function daysBetween(a: string, b: string): number {
  return Math.round((kstMidnight(b) - kstMidnight(a)) / DAY_MS);
}

/** "11월 12일 목" */
export function dateText(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${m}월 ${d}일 ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
}

/* ---------- 누름 주소 (셸 parseSchemeLink → 화면 주소 + ?team=<팀 코드>, 앱.md 5.1, #311 D-199) ---------- */

/** 그날 상세가 열린 달력 (웹 lib/calendar-url.ts: ?date=&day=1). 팀은 공개 코드로 (웹이 쿠키를 바꾸고 주소에서 뗀다) */
export const dayLink = (groupCode: string, date: string) => `whenwemeet://calendar?date=${date}&day=1&team=${groupCode}`;
export const anniversaryLink = (groupCode: string) => `whenwemeet://anniversaries?team=${groupCode}`;
/** 갈 팀이 없을 때: 앱만 연다 (셸이 모르는 경로라 웹뷰는 지금 화면 그대로) */
export const APP_LINK = "whenwemeet://";

/* ---------- 위젯 화면 값 ---------- */

export type WidgetRow = {
  title: string;
  time: string;
  /** 색 순번 0~7 (위젯이 라이트/다크 값으로 바꾼다). 일정 색이 있으면 그 색, 없으면 팀 색 */
  color: number;
  /** 팀이 둘 이상일 때만 팀 이름 */
  team: string | null;
};

export type WidgetProps = {
  /** signedOut: 스냅샷 없음(로그인 전, 로그아웃, 탈퇴) */
  kind: "signedOut" | "today";
  /** "11월 12일 목" */
  dateText: string;
  rows: WidgetRow[];
  /** 보이지 않는 나머지 일정 수 */
  more: number;
  /** 오늘이 스냅샷 범위 안인지. 아니면 일정 칸에 "앱을 열면 새로 고쳐져요" */
  known: boolean;
  /** 가장 가까운 기념일 (오늘 포함) */
  anniversary: { title: string; dday: string; url: string } | null;
  /** 스냅샷이 24시간 넘게 오래됨 */
  stale: boolean;
  /** 위젯 전체 누름 */
  url: string;
};

export const SIGNED_OUT_PROPS: WidgetProps = {
  kind: "signedOut",
  dateText: "",
  rows: [],
  more: 0,
  known: false,
  anniversary: null,
  stale: false,
  url: APP_LINK,
};

/** D-day 글자. diff = 기념일 - 오늘 (0 이상) */
export function ddayText(diff: number): string {
  return diff === 0 ? "D-day" : `D-${diff}`;
}

/** now 순간의 위젯 화면 값. 스냅샷이 없으면 로그인 안내 */
export function widgetProps(s: WidgetSnapshot | null, now: number): WidgetProps {
  if (!s) return SIGNED_OUT_PROPS;
  const today = kstDateKey(now);
  const groups = new Map(s.groups.map((g) => [g.id, g]));
  const multi = s.groups.length > 1;
  const day = s.days.find((d) => d.date === today) ?? null;

  const rows: WidgetRow[] = (day?.events ?? []).map((e) => {
    const g = groups.get(e.g);
    return { title: e.title, time: e.time, color: e.c ?? g?.color ?? 0, team: multi && g ? g.name : null };
  });

  const codeOf = (g: number) => groups.get(g)?.code ?? null;
  const ann = s.anniversaries.find((a) => a.date >= today) ?? null;
  const annCode = ann ? codeOf(ann.g) : null;
  const anniversary = ann && annCode ? { title: ann.title, dday: ddayText(daysBetween(today, ann.date)), url: anniversaryLink(annCode) } : null;

  // 누르면: 오늘 첫 일정의 팀 달력 그날 → 아무 팀 그날 → 기념일 → 앱만
  const firstCode = codeOf(day?.events[0]?.g ?? s.groups[0]?.id ?? 0);
  const url = firstCode ? dayLink(firstCode, today) : (anniversary?.url ?? APP_LINK);

  return {
    kind: "today",
    dateText: dateText(today),
    rows,
    more: day ? Math.max(0, day.total - rows.length) : 0,
    known: day !== null,
    anniversary,
    stale: now - Date.parse(s.generatedAt) > WIDGET_STALE_MS,
    url,
  };
}

/**
 * iOS 타임라인 항목 시각 (UTC ms, 오름차순). 지금, 스냅샷 날마다의 KST 자정, 범위 끝 다음 자정, 오래됨 기준 시각.
 * 위젯은 다음 항목 시각에 그 항목의 값으로 바뀐다 (앱을 열지 않아도 자정에 날짜가 넘어간다)
 */
export function timelineTimes(s: WidgetSnapshot, now: number): number[] {
  const set = new Set<number>([now]);
  const today = kstDateKey(now);
  const last = s.days.length > 0 ? s.days[s.days.length - 1].date : today;
  for (let k = addDays(today, 1); k <= addDays(last, 1); k = addDays(k, 1)) set.add(kstMidnight(k));
  const staleAt = Date.parse(s.generatedAt) + WIDGET_STALE_MS + 1;
  if (staleAt > now) set.add(staleAt);
  return [...set].sort((a, b) => a - b);
}

/** iOS 타임라인 항목 (시각마다 그 순간의 화면 값) */
export function timelineEntries(s: WidgetSnapshot, now: number): { date: Date; props: WidgetProps }[] {
  return timelineTimes(s, now).map((t) => ({ date: new Date(t), props: widgetProps(s, t) }));
}
