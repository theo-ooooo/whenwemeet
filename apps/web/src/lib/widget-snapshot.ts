// (#197) 홈 화면 위젯 스냅샷 만들기 (docs/설계/앱.md 4.7). React 를 import 하지 않는다 (단위 테스트 대상).
// 셸 apps/mobile/src/widget/snapshot.ts parseWidgetSnapshot 과 같은 계약. 웹이 이미 쓰는 API 응답(팀, 일정, 기념일)만으로 만든다.
// - 날: 오늘(KST)부터 7일. 하루에 앞 3개 + 전체 수. 여러 날 일정은 걸친 날마다, 반복은 API 가 펼친 회차 그대로
// - 넣지 않는 것: 메모, 장소, 참여자, 만든 사람 (기획 "메모, 참여자, 장소는 넣지 않는다")
// - 크기: 브리지 메시지 전체가 16KB 를 넘으면 뒤쪽 날부터 뺀다
import { nextOccurrence, compareOccurrence, occurrenceTitle } from "./anniversary";
import { displayIndex } from "./colors";
import { addDays, dateKeyOf, timeOf, type DateKey } from "./date";
import { eventKey } from "./recurrence";
import { lastDayOf } from "./upcoming";
import { MEMBER_COLORS, type Anniversary, type Event, type GroupSummary } from "./types";

export const WIDGET_DAYS = 7;
export const WIDGET_DAY_ROWS = 3;
export const WIDGET_ANNIVERSARIES = 3;
/** 브리지 메시지(JSON 문자열) 최대 길이. 셸 WIDGET_MESSAGE_MAX 와 같은 값 */
export const WIDGET_MESSAGE_MAX = 16_384;
/** 한 번에 모으는 팀 수 상한 (팀마다 요청 2개) */
export const WIDGET_MAX_GROUPS = 10;

export type WidgetSnapshotEvent = { g: number; title: string; time: string };
export type WidgetSnapshotDay = { date: DateKey; events: WidgetSnapshotEvent[]; total: number };
export type WidgetSnapshot = {
  generatedAt: string;
  /** (#311) code 는 누름 주소의 `?team=` 에 쓰는 팀 공개 코드 */
  groups: { id: number; name: string; color: number; code: string }[];
  days: WidgetSnapshotDay[];
  anniversaries: { g: number; title: string; date: DateKey }[];
};

export type WidgetSource = {
  groups: GroupSummary[];
  /** 팀 id → 오늘 0시 ~ 7일 뒤 0시 일정 (API 가 반복을 펼친 목록) */
  events: Map<number, Event[]>;
  /** 팀 id → 기념일 목록 */
  anniversaries: Map<number, Anniversary[]>;
};

/** 제어문자는 띄어쓰기로, max(UTF-16 길이)를 넘으면 잘라 "…". 빈 값은 fallback */
export function clip(s: string, max: number, fallback: string): string {
  const clean = s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").trim();
  if (!clean) return fallback;
  if (clean.length <= max) return clean;
  let out = "";
  for (const ch of clean) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

/** 서버 색(hex) → 멤버 색 순번 0~6 (lib/colors.ts memberColor 와 같은 규칙). 팔레트 밖은 마지막(슬레이트) */
export function colorIndex(hex: string | null | undefined): number {
  const i = MEMBER_COLORS.findIndex((c) => c.toUpperCase() === (hex ?? "").toUpperCase());
  return displayIndex(i < 0 ? MEMBER_COLORS.length - 1 : i);
}

/** 그날 기준 시각 글자. 종일(또는 그날을 통째로 걸친 일정) "종일", 전날 시작해 그날 끝 "~18:00", 그 밖은 시작 "10:00" */
export function widgetTimeText(ev: Pick<Event, "startsAt" | "endsAt" | "allDay">, day: DateKey): string {
  if (ev.allDay) return "종일";
  const started = dateKeyOf(ev.startsAt) < day;
  if (!started) return timeOf(ev.startsAt);
  return lastDayOf(ev) > day ? "종일" : `~${timeOf(ev.endsAt)}`;
}

/** 그날에 걸친 일정인가 (시작한 날 ~ 마지막 날) */
function covers(ev: Pick<Event, "startsAt" | "endsAt" | "allDay">, day: DateKey): boolean {
  return dateKeyOf(ev.startsAt) <= day && lastDayOf(ev) >= day;
}

/** 스냅샷 만들기 (크기 제한 전). now 는 ms */
export function buildWidgetSnapshot(src: WidgetSource, now: number): WidgetSnapshot {
  const today = dateKeyOf(now);
  const groups = src.groups.slice(0, WIDGET_MAX_GROUPS);
  const ids = new Set(groups.map((g) => g.id));

  // 팀 + 회차 키로 한 번만 (같은 회차가 두 번 와도)
  const seen = new Set<string>();
  const all: Event[] = [];
  for (const g of groups) {
    for (const ev of src.events.get(g.id) ?? []) {
      const k = `${g.id}:${eventKey(ev)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      all.push({ ...ev, groupId: g.id });
    }
  }

  const days: WidgetSnapshotDay[] = [];
  for (let i = 0; i < WIDGET_DAYS; i++) {
    const day = addDays(today, i);
    const list = all
      .filter((ev) => covers(ev, day))
      .map((ev) => ({ ev, time: widgetTimeText(ev, day) }))
      // 종일(걸친 일정 포함) 먼저, 그다음 시작 순, 같으면 제목
      .sort(
        (a, b) =>
          Number(b.time === "종일") - Number(a.time === "종일") ||
          a.ev.startsAt.localeCompare(b.ev.startsAt) ||
          a.ev.title.localeCompare(b.ev.title, "ko"),
      );
    days.push({
      date: day,
      events: list.slice(0, WIDGET_DAY_ROWS).map(({ ev, time }) => ({ g: ev.groupId, title: clip(ev.title, 30, "제목 없음"), time })),
      total: Math.min(list.length, 999),
    });
  }

  const occ = groups
    .flatMap((g) => (src.anniversaries.get(g.id) ?? []).map((a) => nextOccurrence({ ...a, groupId: g.id }, today)))
    .filter((o): o is NonNullable<typeof o> => o !== null && ids.has(o.anniversary.groupId))
    .sort(compareOccurrence)
    .slice(0, WIDGET_ANNIVERSARIES);

  return {
    generatedAt: new Date(now).toISOString(),
    groups: groups.map((g) => ({ id: g.id, name: clip(g.name, 20, "팀"), color: colorIndex(g.me.color), code: g.publicCode })),
    days,
    anniversaries: occ.map((o) => ({ g: o.anniversary.groupId, title: clip(occurrenceTitle(o), 40, "기념일"), date: o.date })),
  };
}

/** 브리지 메시지로 감쌌을 때 길이 (app-bridge encodeBridgeMessage 와 같은 모양) */
export function widgetMessageLength(s: WidgetSnapshot): number {
  return JSON.stringify({ v: 1, type: "widgetSnapshot", snapshot: s }).length;
}

/** 16KB 안으로: 뒤쪽 날부터 뺀다. 오늘 하나만 남겨도 넘으면 null (보내지 않는다) */
export function fitWidgetSnapshot(s: WidgetSnapshot, max = WIDGET_MESSAGE_MAX): WidgetSnapshot | null {
  let cur = s;
  while (widgetMessageLength(cur) > max) {
    if (cur.days.length <= 1) return null;
    cur = { ...cur, days: cur.days.slice(0, -1) };
  }
  return cur;
}

/** 일정을 받을 범위 (KST 오늘 0시 ~ 7일 뒤 0시) */
export function widgetRange(now: number): { from: DateKey; to: DateKey } {
  const today = dateKeyOf(now);
  return { from: today, to: addDays(today, WIDGET_DAYS) };
}
