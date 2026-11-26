// (#549) 스냅샷 → 기기 일정 값, 내용 해시, 맞추기 계획 (앱.md 4.9, D-294). 순수 함수 (jest 대상).
import type { CalendarEvent } from "./snapshot";

export type DeviceOs = "ios" | "android";

/** 기기 캘린더에 넣는 값 (expo-calendar 의 Event 일부와 같은 이름) */
export type DeviceEventDetails = {
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  /** 없으면 넣지 않는다 (iOS 종일은 떠 있는 날짜라 시간대를 두지 않는다) */
  timeZone?: string;
  endTimeZone?: string;
  location: string;
  notes: string;
  url?: string;
};

/** 시간 일정의 시간대. 순간은 절대값이라 표시용일 뿐이지만 KST 서비스라 고정 */
export const EVENT_TIME_ZONE = "Asia/Seoul";

/**
 * 변환 규칙이 바뀌면 올린다. 해시에 섞여 있어 다음 맞추기에서 모든 일정을 다시 쓴다
 * (1: 첫 판)
 */
export const FORMAT_VERSION = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

function dateParts(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m, d];
}

/** 'YYYY-MM-DD' 의 n 일 뒤 (달력 날짜 계산, 시간대 무관) */
export function addDateKey(key: string, n: number): string {
  const [y, m, d] = dateParts(key);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 기기 시간대의 그 시각 (월은 0부터). 테스트는 고정 시차로 바꿔 넣는다 */
export type LocalDateFactory = (y: number, monthIndex: number, d: number, h: number, min: number, s: number) => Date;
const deviceLocal: LocalDateFactory = (y, mi, d, h, min, s) => new Date(y, mi, d, h, min, s, 0);

/**
 * 종일 일정의 기기 날짜. 스냅샷은 KST 날짜와 배타 끝 (ICS 와 같음)
 *   Android  CalendarContract 규칙: ALL_DAY=1 이면 EVENT_TIMEZONE=UTC, DTSTART/DTEND 는 UTC 자정, DTEND 배타.
 *            기기 시간대와 무관하게 그 날짜로 보인다
 *   iOS      EventKit 종일은 떠 있는 날짜(기기 시간대로 해석). 시작은 기기 시간대의 그날 0시, 끝은 마지막 날 23:59:59
 *            (EventKit 이 종일 일정을 돌려줄 때의 끝과 같은 값이라 하루 더 길어 보이지 않는다)
 * 기기 시간대가 KST 가 아니어도(해외) 날짜가 밀리지 않는다
 */
export function allDayDates(
  start: string,
  endExclusive: string,
  os: DeviceOs,
  local: LocalDateFactory = deviceLocal,
): { startDate: Date; endDate: Date; timeZone?: string; endTimeZone?: string } {
  if (os === "android") {
    const [sy, sm, sd] = dateParts(start);
    const [ey, em, ed] = dateParts(endExclusive);
    return { startDate: new Date(Date.UTC(sy, sm - 1, sd)), endDate: new Date(Date.UTC(ey, em - 1, ed)), timeZone: "UTC", endTimeZone: "UTC" };
  }
  const [sy, sm, sd] = dateParts(start);
  const [ly, lm, ld] = dateParts(addDateKey(endExclusive, -1));
  return { startDate: local(sy, sm - 1, sd, 0, 0, 0), endDate: local(ly, lm - 1, ld, 23, 59, 59) };
}

/** 메모 끝에 붙이는 상세 주소 (Android 는 일정에 URL 칸이 없다) */
function notesWithUrl(notes: string, url: string | undefined): string {
  if (!url) return notes;
  return notes ? `${notes}\n\n${url}` : url;
}

/** 스냅샷 일정 → 기기 일정 값. 상세 주소는 iOS 는 URL 칸, Android 는 메모 끝 줄 */
export function toDeviceEvent(ev: CalendarEvent, os: DeviceOs): DeviceEventDetails {
  const notes = ev.notes ?? "";
  const base =
    os === "ios"
      ? { title: ev.title, location: ev.location ?? "", notes, ...(ev.url ? { url: ev.url } : {}) }
      : { title: ev.title, location: ev.location ?? "", notes: notesWithUrl(notes, ev.url) };
  if (ev.allDay) return { ...base, allDay: true, ...allDayDates(ev.start, ev.end, os) };
  return {
    ...base,
    allDay: false,
    startDate: new Date(ev.start),
    endDate: new Date(ev.end),
    timeZone: EVENT_TIME_ZONE,
    ...(os === "android" ? { endTimeZone: EVENT_TIME_ZONE } : {}),
  };
}

/** FNV-1a 32비트 두 번(다른 시드)을 이어 16자 hex. 암호용이 아니라 "바뀌었나" 비교용 */
export function hashText(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** 일정 내용 해시 (UID 밖 모든 칸 + 변환 규칙 버전). 같으면 기기 일정을 건드리지 않는다 */
export function eventHash(ev: CalendarEvent): string {
  return hashText(JSON.stringify([FORMAT_VERSION, ev.title, ev.allDay, ev.start, ev.end, ev.location ?? "", ev.notes ?? "", ev.url ?? ""]));
}

/** 저장된 매핑 한 줄: 기기 일정 id 와 그때 쓴 내용 해시 */
export type MappedEvent = { id: string; h: string };
export type EventMapping = Record<string, MappedEvent>;

export type SyncPlan = {
  create: { ev: CalendarEvent; h: string }[];
  update: { ev: CalendarEvent; h: string; id: string }[];
  /** 지울 기기 일정 (우리 캘린더에 아직 있는 것만) */
  remove: { uid: string; id: string }[];
  /** 그대로 둘 매핑 (바뀌지 않음) */
  keep: Record<string, MappedEvent>;
};

/**
 * 맞추기 계획 (스냅샷이 전부: 없는 것은 지운다).
 * present 는 지금 우리 캘린더에 실제로 있는 기기 일정 id. 사용자가 휴대폰에서 지웠거나 다른 캘린더로 옮긴 일정은
 * present 에 없으므로 그 id 는 건드리지 않고(우리 캘린더 밖) 새로 만든다. null 이면 매핑을 그대로 믿는다
 */
export function planSync(events: readonly CalendarEvent[], mapping: EventMapping, present: ReadonlySet<string> | null): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], remove: [], keep: {} };
  const isPresent = (id: string) => present === null || present.has(id);
  const wanted = new Set<string>();
  for (const ev of events) {
    wanted.add(ev.uid);
    const h = eventHash(ev);
    const m = mapping[ev.uid];
    if (!m || !isPresent(m.id)) plan.create.push({ ev, h });
    else if (m.h !== h) plan.update.push({ ev, h, id: m.id });
    else plan.keep[ev.uid] = m;
  }
  for (const [uid, m] of Object.entries(mapping)) {
    if (!wanted.has(uid) && isPresent(m.id)) plan.remove.push({ uid, id: m.id });
  }
  return plan;
}

/** 한 번에 count 개씩 돌린다. 하나가 실패해도 나머지는 계속 (결과는 각 작업이 스스로 기록) */
export async function runPool<T>(items: readonly T[], count: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(count, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  });
  await Promise.all(lanes);
}
