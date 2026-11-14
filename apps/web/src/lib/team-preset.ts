// (#278) 팀 만들기 쓰임(프리셋)과 첫 단계. React 를 import 하지 않는 순수 함수 (단위 테스트 대상)
// 쓰임은 서버에 저장하지 않는다 (D-250). 만들기 화면 → 첫 단계 화면(`/groups/start?preset=`) 주소와 이 기기의 안내 상태(lib/start-guide.ts)로만 넘긴다.
// 코드 키에 커플 전용 용어를 쓰지 않는다 (CLAUDE.md 금지): 커플 = `two`
import { addDays, dowOf, formatDateKo, keyOf, kstToIso, parseKey, todayKey, toKst, type DateKey } from "./date";
import { DAY_MILESTONES, dayNumber } from "./anniversary";
import { ANNIVERSARIES_PATH, ME_BIRTHDAY_PATH, NEW_EVENT_PATH, calendarHref, teamHref, todosHref } from "./routes";
import type { AnniversaryInput, EventInput } from "./types";

export const PRESET_KEYS = ["two", "family", "friends", "study"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

/** 만들기 화면 칩. 마지막 "직접 정하기" 는 쓰임 없음(null) = 지금 흐름 그대로 */
export const PRESET_CHIPS: { key: PresetKey | null; label: string; sampleName: string }[] = [
  { key: "two", label: "커플", sampleName: "우리 둘" },
  { key: "family", label: "가족", sampleName: "우리 가족" },
  { key: "friends", label: "친구", sampleName: "친구들" },
  { key: "study", label: "스터디", sampleName: "목요 스터디" },
  { key: null, label: "직접 정하기", sampleName: "" },
];

export function parsePreset(raw: string | string[] | null | undefined): PresetKey | null {
  return typeof raw === "string" && (PRESET_KEYS as readonly string[]).includes(raw) ? (raw as PresetKey) : null;
}

/** 칩을 바꿀 때 이름 칸: 비었거나 앞 칩의 예시 이름 그대로면 새 예시로, 사용자가 고쳤으면 그대로 둔다 */
export function nameForChip(current: string, prev: PresetKey | null, next: PresetKey | null): string {
  const sample = (k: PresetKey | null) => PRESET_CHIPS.find((c) => c.key === k)?.sampleName ?? "";
  const untouched = current.trim() === "" || (prev !== null && current === sample(prev));
  return untouched ? sample(next) : current;
}

export const START_PATH = "/groups/start";

/** 첫 단계 화면. from=calendar 면 끝나고 달력으로(달력 안내에서 다시 연 경우), 아니면 초대 화면으로 */
export function startHref(preset: PresetKey, opts: { fromCalendar?: boolean } = {}): string {
  return `${START_PATH}?preset=${preset}${opts.fromCalendar ? "&from=calendar" : ""}`;
}

/** 첫 단계를 끝내거나 건너뛴 뒤 갈 곳 */
export function afterStartHref(fromCalendar: boolean): string {
  return fromCalendar ? calendarHref() : teamHref({ invite: true });
}

/* ---------- 커플: 처음 만난 날 ---------- */

export const FIRST_MEET_NAME = "처음 만난 날";

/** 처음 만난 날 기념일. 이름을 비우면 기본 이름, 함께한 날 세기(COUNT_UP) */
export function firstMeetInput(name: string, date: DateKey): AnniversaryInput {
  return { name: name.trim() || FIRST_MEET_NAME, date, kind: "COUNT_UP" };
}

/**
 * 미리보기 한 줄. 지난 날(또는 오늘)이면 "오늘이 412일째예요. 500일은 2027년 3월 2일 (화)",
 * 미래면 "D-5, 그날이 1일째예요". 다음 N일은 1년 넘게 남아도 그대로 보인다
 */
export function firstMeetPreview(date: DateKey, today: DateKey = todayKey()): string {
  const n = dayNumber(date, today);
  if (n < 1) return `D-${1 - n}, 그날부터 1일째로 세요`;
  const next = DAY_MILESTONES.find((m) => m > n);
  if (!next) return `오늘이 ${n.toLocaleString("ko-KR")}일째예요`;
  const nextKey = addDays(date, next - 1);
  const withYear = parseKey(nextKey).y !== parseKey(today).y;
  return `오늘이 ${n.toLocaleString("ko-KR")}일째예요. ${next.toLocaleString("ko-KR")}일은 ${formatDateKo(nextKey, withYear)}`;
}

/* ---------- 스터디: 정기 모임 ---------- */

export const MEETING_TITLE = "정기 모임";

export type WeeklyMeeting = { title: string; dow: number; start: string; end: string };

/** 시작이 끝보다 앞이어야 저장할 수 있다 ('HH:mm' 문자열 비교) */
export const meetingValid = (m: WeeklyMeeting) => m.start !== "" && m.end !== "" && m.start < m.end && m.title.trim().length <= 50;

/**
 * 첫 회차 날짜 (KST). 오늘이 그 요일이고 시작 시각이 아직 안 지났으면 오늘, 아니면 다가오는 그 요일
 */
export function firstMeetingDate(dow: number, start: string, now: Date = new Date()): DateKey {
  const k = toKst(now);
  const base = keyOf(k.y, k.m, k.d);
  const diff = (dow - dowOf(base) + 7) % 7;
  if (diff > 0) return addDays(base, diff);
  const nowHm = `${String(k.h).padStart(2, "0")}:${String(k.min).padStart(2, "0")}`;
  return nowHm < start ? base : addDays(base, 7);
}

/** 매주 반복 일정. 참여자는 생략(= 만든 사람). 팀을 막 만든 때라 멤버는 나뿐이다. (#442) "ALL" 로 보내지 않는다 */
export function weeklyMeetingInput(m: WeeklyMeeting, now: Date = new Date()): EventInput {
  const day = firstMeetingDate(m.dow, m.start, now);
  return {
    title: m.title.trim() || MEETING_TITLE,
    startsAt: kstToIso(day, m.start),
    endsAt: kstToIso(day, m.end),
    allDay: false,
    repeat: "WEEKLY",
  };
}

/* ---------- 달력 위 시작 안내 ---------- */

export type StartStepIcon = "heart" | "calendar" | "free" | "todo" | "pin";

export type StartStep = {
  /** 이 기기 안내 상태에 남기는 이름 */
  id: string;
  label: string;
  href: string;
  icon: StartStepIcon;
  /** 첫 단계 화면에서 저장해야 끝나는 단계. 누르기만 해서는 끝나지 않는다 */
  saves?: boolean;
};

/** 쓰임별 안내 줄. 첫 줄이 첫 단계 (저장해야 끝나는 것은 첫 단계 화면으로 다시 간다) */
export function presetSteps(preset: PresetKey): StartStep[] {
  const feed: StartStep = { id: "feed", label: "다른 캘린더 앱에서 보기", href: teamHref({ feed: true }), icon: "calendar" };
  switch (preset) {
    case "two":
      return [
        { id: "first", label: "처음 만난 날 넣기", href: startHref("two", { fromCalendar: true }), icon: "heart", saves: true },
        { id: "todos", label: "같이 할 일 목록 만들기", href: todosHref({ create: true }), icon: "todo" },
        feed,
      ];
    case "family":
      // (#305) 가족 생일은 기념일로 받지 않고 각자 내 정보의 생일로 (팀 달력에 매년 뜬다)
      return [
        { id: "birthday", label: "내 생일 넣기", href: ME_BIRTHDAY_PATH, icon: "heart" },
        { id: "anniversary", label: "가족 기념일 넣기", href: ANNIVERSARIES_PATH, icon: "heart" },
        feed,
      ];
    case "friends":
      return [
        { id: "free", label: "빈 시간 찾고 투표로 정하기", href: "/free", icon: "free" },
        { id: "place", label: "장소 넣어 모임 일정 만들기", href: NEW_EVENT_PATH, icon: "pin" },
        { id: "todos", label: "챙길 것 목록 만들기", href: todosHref({ create: true }), icon: "todo" },
      ];
    case "study":
      return [
        { id: "first", label: "정기 모임 넣기", href: startHref("study", { fromCalendar: true }), icon: "calendar", saves: true },
        { id: "week", label: "주 보기로 한 주 보기", href: calendarHref({ view: "week" }), icon: "calendar" },
        { id: "todos", label: "준비할 것 목록 만들기", href: todosHref({ create: true }), icon: "todo" },
      ];
  }
}

/** 아직 안 한 안내 줄 */
export function remainingSteps(preset: PresetKey, done: readonly string[]): StartStep[] {
  return presetSteps(preset).filter((s) => !done.includes(s.id));
}
