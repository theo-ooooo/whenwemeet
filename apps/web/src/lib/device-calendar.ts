// (#549) 휴대폰 캘린더에 일정 쓰기: 스냅샷 만들기, 설정 저장, 셸 응답 (docs/설계/앱.md 4.9, D-294).
// 셸 apps/mobile/src/device-calendar/snapshot.ts parseCalendarSnapshot 과 같은 계약. 매핑은 ICS 피드(캘린더-내보내기.md 3장)와 같은 규칙:
//   UID `e{id}@whenwemeet.day`, 반복 회차 `e{id}-{YYYYMMDD 원래 날짜}@…`, 종일은 KST 날짜와 배타 끝, 설명 첫 줄 "참여: …"(개인 팀은 없음),
//   메모는 넣지 않음(ICS includeMemo 기본 false), URL 은 웹 일정 상세. 반복은 API 가 펼친 회차 그대로(예외 반영)
// React 를 import 하지 않는다 (단위 테스트 대상). 브라우저 전용 함수(localStorage, window 이벤트)는 typeof 검사로 막는다.
import { APP_EVENT, BRIDGE_VERSION, postToApp, type BridgeMessage } from "./app-bridge";
import { addDays, dateKeyOf, kstToIso, type DateKey } from "./date";
import { participantsOf } from "./participants";
import { clip } from "./widget-snapshot";
import type { Event as WwmEvent, GroupSummary } from "./types";

/** 창: 오늘(KST) 기준 과거 30일 ~ 미래 180일 */
export const CALENDAR_PAST_DAYS = 30;
export const CALENDAR_FUTURE_DAYS = 180;
/** 일정 목록 API 한 번의 기간 상한 (api MAX_RANGE_DAYS) */
export const EVENTS_RANGE_MAX_DAYS = 62;
/** 셸 CALENDAR_MAX_EVENTS, CALENDAR_MESSAGE_MAX 와 같은 값 */
export const CALENDAR_MAX_EVENTS = 3000;
export const CALENDAR_MESSAGE_MAX = 1_500_000;
/** 한 번에 모으는 팀 수 상한 (팀마다 요청 4개) */
export const CALENDAR_MAX_GROUPS = 20;
export const UID_DOMAIN = "whenwemeet.day";

type Common = { uid: string; title: string; location?: string; notes?: string; url?: string };
export type CalendarSnapshotEvent = (Common & { allDay: true; start: DateKey; end: DateKey }) | (Common & { allDay: false; start: string; end: string });
export type CalendarSnapshot = { generatedAt: string; events: CalendarSnapshotEvent[] };

/* ---------- 창과 요청 나누기 ---------- */

/** [from, to) 날짜 키. to 는 마지막 날 다음 날 (배타) */
export function calendarWindow(now: number): { from: DateKey; to: DateKey } {
  const today = dateKeyOf(now);
  return { from: addDays(today, -CALENDAR_PAST_DAYS), to: addDays(today, CALENDAR_FUTURE_DAYS + 1) };
}

/** [from, to) 를 max 일 이하 조각으로 (일정 목록 API 62일 상한) */
export function rangeChunks(from: DateKey, to: DateKey, max = EVENTS_RANGE_MAX_DAYS): { from: DateKey; to: DateKey }[] {
  const out: { from: DateKey; to: DateKey }[] = [];
  for (let a = from; a < to; ) {
    const b = addDays(a, max) < to ? addDays(a, max) : to;
    out.push({ from: a, to: b });
    a = b;
  }
  return out;
}

/* ---------- 일정 → 스냅샷 ---------- */

export type CalendarSource = {
  /** 켠 팀 (숨김 팀은 뺀 것) */
  groups: GroupSummary[];
  /** 팀 id → 창 안 일정 (API 가 펼친 회차. 조각 경계에 걸친 일정은 두 번 올 수 있다) */
  events: Map<number, WwmEvent[]>;
};

/** ICS 와 같은 UID. 반복이면 원래 날짜(occurrence)로 */
export function eventUid(ev: Pick<WwmEvent, "id" | "repeat" | "occurrence">): string {
  return ev.repeat && ev.occurrence ? `e${ev.id}-${ev.occurrence.replace(/-/g, "")}@${UID_DOMAIN}` : `e${ev.id}@${UID_DOMAIN}`;
}

/** 종일 [시작, 끝) KST 날짜. 끝은 "끝 순간 바로 앞의 날짜 + 1일", 시작 다음 날보다 앞서지 않게 (api feed-items allDayDates 와 같음) */
export function allDayRange(startsAt: string, endsAt: string): { start: DateKey; end: DateKey } {
  const start = dateKeyOf(startsAt);
  const last = dateKeyOf(Date.parse(endsAt) - 1);
  return { start, end: addDays(last < start ? start : last, 1) };
}

/** 웹 일정 상세 주소 (#311, D-198. ICS URL 과 같음) */
export function eventDetailUrl(origin: string, ev: Pick<WwmEvent, "publicCode" | "repeat" | "occurrence">, groupCode: string): string {
  const params = new URLSearchParams({ team: groupCode });
  if (ev.repeat && ev.occurrence) params.set("occurrence", ev.occurrence);
  return `${origin}/events/${ev.publicCode}?${params.toString()}`;
}

/** 여러 줄 글자: 탭 밖 제어문자는 띄어쓰기, 줄 끝 공백 정리, max 자 */
function multiline(s: string, max: number): string {
  const clean = s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, " ")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * 설명: (켠 팀이 둘 이상이면) "팀: 가족", "참여: 민지, 지훈"(모두면 "참여: 모두", 참여자 없음이면 줄 없음, 개인 팀은 줄 없음).
 * 메모는 넣지 않는다 (ICS 기본값과 같음)
 */
export function eventNotes(ev: Pick<WwmEvent, "creator" | "participants">, group: Pick<GroupSummary, "type" | "name">, multiTeam: boolean): string {
  const lines: string[] = [];
  if (multiTeam) lines.push(`팀: ${group.name}`);
  if (group.type !== "PERSONAL") {
    const p = participantsOf(ev);
    const names = p.all ? "모두" : p.members.map((m) => m.displayName).join(", ");
    if (names) lines.push(`참여: ${names}`);
  }
  return multiline(lines.join("\n"), 2000);
}

/** (#199) 장소 글자: 사용자가 적은 것, 없으면 고를 때 검색어 (ICS LOCATION 의 다시 찾기 전 값과 같음) */
export function eventLocation(ev: Pick<WwmEvent, "place">): string {
  return clip(ev.place?.text || ev.place?.query || "", 300, "");
}

export function toSnapshotEvent(ev: WwmEvent, group: GroupSummary, origin: string, multiTeam: boolean): CalendarSnapshotEvent {
  const title = clip(ev.title, 200, "(제목 없음)");
  const location = eventLocation(ev);
  const notes = eventNotes(ev, group, multiTeam);
  const common: Common = {
    uid: eventUid(ev),
    title,
    ...(location ? { location } : {}),
    ...(notes ? { notes } : {}),
    url: eventDetailUrl(origin, ev, group.publicCode),
  };
  if (ev.allDay) return { ...common, allDay: true, ...allDayRange(ev.startsAt, ev.endsAt) };
  return { ...common, allDay: false, start: new Date(ev.startsAt).toISOString(), end: new Date(ev.endsAt).toISOString() };
}

/** 시작 순간 (정렬용). 종일은 KST 자정 */
function startMs(e: CalendarSnapshotEvent): number {
  return e.allDay ? Date.parse(kstToIso(e.start)) : Date.parse(e.start);
}

/**
 * 스냅샷. 팀 + UID 로 한 번만(조각 경계 중복), 창 [from, to) 와 겹치는 것만, 시작 순.
 * 일정이 3000개를 넘으면 먼 미래부터 뺀다
 */
export function buildCalendarSnapshot(src: CalendarSource, now: number, origin: string): CalendarSnapshot {
  const { from, to } = calendarWindow(now);
  const lo = Date.parse(kstToIso(from));
  const hi = Date.parse(kstToIso(to));
  const multiTeam = src.groups.length > 1;
  const seen = new Set<string>();
  const out: CalendarSnapshotEvent[] = [];
  for (const g of src.groups) {
    for (const ev of src.events.get(g.id) ?? []) {
      const s = Date.parse(ev.startsAt);
      const e = Date.parse(ev.endsAt);
      if (!(e > s) || e <= lo || s >= hi) continue;
      const item = toSnapshotEvent(ev, g, origin, multiTeam);
      if (seen.has(item.uid)) continue;
      seen.add(item.uid);
      out.push(item);
    }
  }
  out.sort((a, b) => startMs(a) - startMs(b) || a.uid.localeCompare(b.uid));
  return { generatedAt: new Date(now).toISOString(), events: out.slice(0, CALENDAR_MAX_EVENTS) };
}

/** 보낼 메시지 길이 (셸이 보는 그 문자열) */
export function calendarMessageLength(s: CalendarSnapshot, id = "c0000000000000"): number {
  return JSON.stringify({ v: BRIDGE_VERSION, type: "calendarSync", snapshot: s, id }).length;
}

/** 1.5MB 를 넘으면 먼 미래부터 뺀다 */
export function fitCalendarSnapshot(s: CalendarSnapshot): CalendarSnapshot {
  let events = s.events;
  let size = calendarMessageLength(s);
  while (size > CALENDAR_MESSAGE_MAX && events.length > 0) {
    // 넘친 비율만큼 한 번에 줄인다 (하나씩 빼며 매번 직렬화하지 않게)
    const keep = Math.max(0, Math.floor(events.length * (CALENDAR_MESSAGE_MAX / size)) - 1);
    events = events.slice(0, keep);
    size = calendarMessageLength({ ...s, events });
  }
  return { ...s, events };
}

/** 내용 비교 키 (만든 시각은 뺀다). 같으면 다시 보내지 않는다 */
export function snapshotKey(s: CalendarSnapshot): string {
  return JSON.stringify(s.events);
}

/* ---------- 설정 (이 기기에만, localStorage) ---------- */

/** teams 가 null 이면 내 팀 전부 (나중에 생긴 팀도). enabled 는 셸 상태를 비춘 값 (꺼져 있으면 요청하지 않으려고) */
export type CalendarSettings = { userId: number; enabled: boolean; teams: number[] | null };

export const SETTINGS_KEY = "wwm.device-calendar";

export function defaultSettings(userId: number): CalendarSettings {
  return { userId, enabled: false, teams: null };
}

/** 저장된 설정. 다른 사용자 것이거나 깨졌으면 기본값 */
export function readCalendarSettings(userId: number, storage: Pick<Storage, "getItem"> | null = safeStorage()): CalendarSettings {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SETTINGS_KEY) ?? null;
  } catch {
    // 저장소를 못 쓰는 브라우저
  }
  return parseCalendarSettings(raw, userId);
}

/** 저장 문자열 → 설정. 다른 사용자 것이거나 깨졌으면 기본값 */
export function parseCalendarSettings(raw: string | null, userId: number): CalendarSettings {
  try {
    if (!raw) return defaultSettings(userId);
    const o = JSON.parse(raw) as Partial<CalendarSettings>;
    if (o.userId !== userId || typeof o.enabled !== "boolean") return defaultSettings(userId);
    const teams = Array.isArray(o.teams) ? o.teams.filter((t): t is number => Number.isSafeInteger(t) && t > 0) : null;
    return { userId, enabled: o.enabled, teams };
  } catch {
    return defaultSettings(userId);
  }
}

/** 설정이 바뀌면 window 에 쏘는 이벤트 (useDeviceCalendarSync 가 다시 맞춘다) */
export const CALENDAR_SETTINGS_EVENT = "wwm:device-calendar-settings";

export function writeCalendarSettings(s: CalendarSettings, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // 저장소를 못 쓰는 브라우저: 이번 화면에서만
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CALENDAR_SETTINGS_EVENT));
}

/** 이 기기에 켠 설정이 하나라도 있나 (사용자 확인 전. 없으면 /me 도 부르지 않는다) */
export function storedCalendarEnabled(storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Partial<CalendarSettings>).enabled === true : false;
  } catch {
    return false;
  }
}

/** 화면용 (useSyncExternalStore): 저장 문자열 그대로 (같은 값이면 같은 문자열이라 다시 그리지 않는다) */
export function rawCalendarSettings(): string | null {
  try {
    return safeStorage()?.getItem(SETTINGS_KEY) ?? null;
  } catch {
    return null;
  }
}

export function subscribeCalendarSettings(cb: () => void): () => void {
  window.addEventListener(CALENDAR_SETTINGS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CALENDAR_SETTINGS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** 켠 팀 (숨김 팀 제외, 앞 20개). teams 가 null 이면 전부, 고른 팀 중 없어진 것은 무시 */
export function pickTeams(groups: readonly GroupSummary[], teams: readonly number[] | null): GroupSummary[] {
  const visible = groups.filter((g) => !g.hidden);
  const picked = teams === null ? visible : visible.filter((g) => teams.includes(g.id));
  return picked.slice(0, CALENDAR_MAX_GROUPS);
}

/* ---------- 셸 응답 (wwm:app calendarStatus) ---------- */

export type CalendarPermission = "granted" | "denied" | "undetermined";

export type CalendarStatus = {
  id: string;
  permission: CalendarPermission;
  canAskAgain: boolean;
  enabled: boolean;
  lastSyncedAt: string | null;
  count: number;
  failed: boolean;
};

const PERMISSIONS: readonly CalendarPermission[] = ["granted", "denied", "undetermined"];

/** wwm:app detail 을 calendarStatus 로 읽는다. 다른 type, 틀린 모양이면 null */
export function decodeCalendarStatus(detail: unknown): CalendarStatus | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const o = detail as Record<string, unknown>;
  if (o.v !== BRIDGE_VERSION || o.type !== "calendarStatus") return null;
  if (typeof o.id !== "string" || o.id.length < 1 || o.id.length > 40) return null;
  if (!PERMISSIONS.includes(o.permission as CalendarPermission)) return null;
  if (typeof o.enabled !== "boolean") return null;
  const count = typeof o.count === "number" && Number.isInteger(o.count) && o.count >= 0 ? o.count : 0;
  const last = typeof o.lastSyncedAt === "string" && !Number.isNaN(Date.parse(o.lastSyncedAt)) ? o.lastSyncedAt : null;
  return {
    id: o.id,
    permission: o.permission as CalendarPermission,
    canAskAgain: o.canAskAgain === true,
    enabled: o.enabled,
    lastSyncedAt: last,
    count,
    failed: o.failed === true,
  };
}

/** 받은 상태를 화면에 알리는 이벤트 (설정 화면이 상태 줄을 바꾼다) */
export const CALENDAR_STATUS_EVENT = "wwm:device-calendar-status";

/** 응답 기다리는 시간: 상태 5초, 권한 창 60초(사람이 고르는 동안), 끄기 30초, 맞추기 120초(처음엔 수백 개를 쓴다) */
export const CALENDAR_TIMEOUT_MS = {
  calendarSyncStatus: 5_000,
  calendarSyncEnable: 60_000,
  calendarSyncDisable: 30_000,
  calendarSync: 120_000,
} as const;

let seq = 0;
function nextId(): string {
  seq = (seq + 1) % 1_000_000;
  return `c${Date.now().toString(36)}${seq.toString(36)}`;
}

type CalendarRequest =
  | { type: "calendarSyncStatus" | "calendarSyncEnable" | "calendarSyncDisable" }
  | { type: "calendarSync"; snapshot: CalendarSnapshot };

/**
 * 셸에 보내고 같은 id 의 calendarStatus 를 기다린다. 보내기 실패, 시간 초과면 null.
 * 받은 상태는 CALENDAR_STATUS_EVENT 로도 알린다. 호출부가 셸 능력(appSupportsDeviceCalendar)을 먼저 본다
 */
export function requestCalendar(req: CalendarRequest): Promise<CalendarStatus | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const id = nextId();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (v: CalendarStatus | null) => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener(APP_EVENT, onEvent);
      if (v) window.dispatchEvent(new CustomEvent(CALENDAR_STATUS_EVENT, { detail: v }));
      resolve(v);
    };
    const onEvent = (e: Event) => {
      const s = decodeCalendarStatus((e as CustomEvent).detail);
      if (s && s.id === id) done(s);
    };
    window.addEventListener(APP_EVENT, onEvent);
    timer = setTimeout(() => done(null), CALENDAR_TIMEOUT_MS[req.type]);
    const msg: BridgeMessage = req.type === "calendarSync" ? { type: "calendarSync", snapshot: req.snapshot, id } : { type: req.type, id };
    if (!postToApp(msg)) done(null);
  });
}

/* ---------- 화면 글자 ---------- */

/** "오늘 15:12" / "어제 21:03" / "11월 24일 09:30" (KST) */
export function syncedAtText(iso: string, now: number): string {
  const t = Date.parse(iso);
  const day = dateKeyOf(t);
  const today = dateKeyOf(now);
  const time = new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(11, 16);
  if (day === today) return `오늘 ${time}`;
  if (day === addDays(today, -1)) return `어제 ${time}`;
  const [, m, d] = day.split("-").map(Number);
  return `${m}월 ${d}일 ${time}`;
}

/** 상태 줄. 켜져 있을 때만 쓴다 */
export function statusLine(s: Pick<CalendarStatus, "lastSyncedAt" | "count" | "failed">, now: number): string {
  if (s.failed) return "일부 일정을 휴대폰 캘린더에 넣지 못했어요. 앱을 다시 열면 다시 맞춰요";
  if (!s.lastSyncedAt) return "아직 맞추지 않았어요. 잠시 뒤 일정이 들어가요";
  return `마지막으로 맞춘 시각 ${syncedAtText(s.lastSyncedAt, now)}, 일정 ${s.count}개`;
}
