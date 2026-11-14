// (#189) 약속 투표 화면 규칙 (설계 약속-투표.md 5장). React 를 import 하지 않는다 (단위 테스트 대상)
import { addDays, clockRangeText, clockText, dateKeyOf, formatDateKo, kstToIso, parseKey, todayKey, type DateKey } from "./date";
import { ceilToStep } from "./free-time";
import type { Poll, PollOption, PollOptionInput, PollSummary } from "./types";

/** 서버 규칙과 같은 값 (api.md 2.13) */
export const POLL_TITLE_MAX = 50;
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 5;

const MIN = 60_000;

const DAY = 24 * 60 * MIN;

/** 빈 시간 결과 한 줄 */
export type Slot = { startsAt: string; endsAt: string };

/** 결과 줄 키 (선택 상태) */
export const slotKey = (slot: Slot): string => `${slot.startsAt}|${slot.endsAt}`;

/**
 * 빈 시간 구간에서 후보 하나. 구간 안에서 minMinutes 길이로, 시작은 start(없으면 구간 시작).
 * 구간이 minMinutes 보다 짧으면 구간 그대로 (설계 5-1)
 */
export function candidateFromSlot(slot: Slot, minMinutes: number, start: string = slot.startsAt): PollOptionInput {
  const s = Date.parse(start);
  const end = Math.min(s + minMinutes * MIN, Date.parse(slot.endsAt));
  return { startsAt: new Date(s).toISOString(), endsAt: new Date(end).toISOString(), allDay: false };
}

/**
 * 구간 안에서 고를 수 있는 시작 시각(30분 단위, KST 하루 안 분). 첫 값은 구간 시작, 마지막은 끝 - minMinutes.
 * 하나뿐이면 피커를 그리지 않는다
 */
export function startRange(slot: Slot, minMinutes: number): { day: DateKey; from: number; to: number } {
  const day = dateKeyOf(slot.startsAt);
  const dayStart = Date.parse(kstToIso(day));
  const from = Math.round((Date.parse(slot.startsAt) - dayStart) / MIN);
  const lastStart = Date.parse(slot.endsAt) - minMinutes * MIN;
  const to = Math.max(from, Math.floor((lastStart - dayStart) / MIN / 30) * 30);
  return { day, from, to };
}

/** 후보 한 줄 "11월 22일 (토) 오후 7:00 ~ 9:00" (시각 표기는 일정 줄과 같다, lib/date.ts clockRangeText), 종일 "11월 22일 (토) 종일" (여러 날이면 "~11월 24일 (월)") */
export function optionLabel(option: Pick<PollOptionInput, "startsAt" | "endsAt" | "allDay">, today: DateKey = todayKey()): string {
  const key = dateKeyOf(option.startsAt);
  const withYear = parseKey(key).y !== parseKey(today).y;
  const date = formatDateKo(key, withYear);
  if (option.allDay) {
    const last = addDays(dateKeyOf(option.endsAt), -1);
    return last === key ? `${date} 종일` : `${date} ~ ${formatDateKo(last, parseKey(last).y !== parseKey(today).y)} 종일`;
  }
  const endKey = dateKeyOf(option.endsAt);
  if (endKey !== key) return `${date} ${clockText(option.startsAt)} ~ ${formatDateKo(endKey)} ${clockText(option.endsAt)}`;
  // 오전/오후가 같으면 끝 쪽은 숫자만 ("오후 7:00 ~ 9:00")
  return `${date} ${clockRangeText(option.startsAt, option.endsAt)}`;
}

/** 날짜 줄 "11월 22일 (토)" 과 시각 줄 "오후 7:00 ~ 9:00" 으로 나눈 것 (투표 화면 카드) */
export function optionParts(option: Pick<PollOptionInput, "startsAt" | "endsAt" | "allDay">, today: DateKey = todayKey()): { date: string; time: string } {
  const full = optionLabel(option, today);
  const key = dateKeyOf(option.startsAt);
  const date = formatDateKo(key, parseKey(key).y !== parseKey(today).y);
  return { date, time: full.slice(date.length + 1) };
}

/** 같은 구간 후보가 이미 있는가 */
export const hasOption = (list: readonly PollOptionInput[], option: PollOptionInput): boolean =>
  list.some((o) => o.startsAt === option.startsAt && o.endsAt === option.endsAt);

/** 만들기 전 검사. 문제가 없으면 null */
export function draftProblem(o: { title: string; options: readonly PollOptionInput[]; now?: number }): string | null {
  const title = o.title.trim();
  if (title.length === 0) return "제목을 적어 주세요";
  if (Array.from(title).length > POLL_TITLE_MAX) return `제목은 ${POLL_TITLE_MAX}자까지 쓸 수 있어요`;
  if (o.options.length < MIN_POLL_OPTIONS) return `후보를 ${MIN_POLL_OPTIONS}개 이상 골라 주세요`;
  if (o.options.length > MAX_POLL_OPTIONS) return `후보는 ${MAX_POLL_OPTIONS}개까지 고를 수 있어요`;
  const now = o.now ?? Date.now();
  if (o.options.some((option) => Date.parse(option.startsAt) <= now)) return "이미 지난 시간은 후보로 고를 수 없어요";
  return null;
}

/** 마감 고르기: 없음 / 내일 이맘때(30분 올림) / 직접 */
export type DeadlineMode = "none" | "tomorrow" | "custom";

export function tomorrowDeadline(now: number = Date.now()): string {
  return new Date(ceilToStep(now + DAY)).toISOString();
}

/** 마감 ISO. 직접은 날짜 + 'HH:mm' */
export function deadlineOf(mode: DeadlineMode, custom: { date: DateKey; time: string }, now: number = Date.now()): string | null {
  if (mode === "none") return null;
  if (mode === "tomorrow") return tomorrowDeadline(now);
  return kstToIso(custom.date, custom.time);
}

/** "11월 14일 (토) 오후 9:00" (올해가 아니면 연도) */
export function instantLabel(iso: string, today: DateKey = todayKey()): string {
  const key = dateKeyOf(iso);
  return `${formatDateKo(key, parseKey(key).y !== parseKey(today).y)} ${clockText(iso)}`;
}

/** 카드, 머리줄의 마감 한 줄 */
export function deadlineText(p: Pick<Poll, "status" | "deadline" | "expired">, today: DateKey = todayKey()): string | null {
  if (p.status === "CLOSED") return null;
  if (p.expired) return "투표가 끝났어요";
  return p.deadline ? `${instantLabel(p.deadline, today)}까지` : null;
}

/** "3명 중 2명 답했어요". 아무도 안 했으면 "아직 아무도 답하지 않았어요" */
export function responseText(s: Pick<PollSummary, "voterCount" | "targetCount">): string {
  if (s.voterCount === 0) return "아직 아무도 답하지 않았어요";
  return `${s.targetCount}명 중 ${s.voterCount}명 답했어요`;
}

/** 대상 중 한 후보라도 가능이라고 한 사람 수 (투표 화면 머리줄) */
export function voterCountOf(poll: Pick<Poll, "options" | "participants">): number {
  const targets = new Set(poll.participants.members.map((m) => m.userId));
  const voters = new Set(poll.options.flatMap((o) => o.voters.map((v) => v.userId)).filter((id) => targets.has(id)));
  return voters.size;
}

/** 표가 가장 많은 후보들 (0표면 없음). 지난 후보는 빼고 센다 */
export function topOptionIds(options: readonly Pick<PollOption, "id" | "voters" | "past">[]): number[] {
  const live = options.filter((o) => !o.past);
  const max = Math.max(0, ...live.map((o) => o.voters.length));
  return max === 0 ? [] : live.filter((o) => o.voters.length === max).map((o) => o.id);
}

/** 정하기 기본 선택: 표가 가장 많은 후보가 하나면 그것, 아니면 없음 */
export function defaultPick(poll: Pick<Poll, "options" | "status">): number | null {
  if (poll.status !== "OPEN") return null;
  const top = topOptionIds(poll.options);
  return top.length === 1 ? top[0] : null;
}

/** 내 표에서 하나를 켜고 끈 결과 (전체 교체 PUT 본문) */
export function toggledVotes(current: readonly number[], optionId: number, on: boolean): number[] {
  const set = new Set(current);
  if (on) set.add(optionId);
  else set.delete(optionId);
  return [...set].sort((a, b) => a - b);
}

/** 새 소식 문구 (#189): "{이름}님이 " 뒤. 정한 시각은 둘째 줄(pollActivitySubline) */
export function pollActivityPhrase(type: "POLL_CREATED" | "POLL_CLOSED", payload: { title?: string }): string {
  // 새 소식 활동 문구라 news-copy 의 이름 따옴표(‘…’)와 같게 쓴다
  const title = `‘${payload.title ?? ""}’`;
  return type === "POLL_CREATED" ? `${title} 투표를 열었어요` : `${title} 시간을 정했어요`;
}

/** 새 소식 둘째 줄: 정한 시간 "11월 22일 (일) 오후 7:00~9:00". 열림이나 값이 없으면 null */
export function pollActivitySubline(payload: { startsAt?: string; endsAt?: string; allDay?: boolean }, today: DateKey = todayKey()): string | null {
  if (!payload.startsAt || !payload.endsAt) return null;
  return optionLabel({ startsAt: payload.startsAt, endsAt: payload.endsAt, allDay: Boolean(payload.allDay) }, today);
}

/** 직접 추가 후보. 종일은 그날 KST 00:00 ~ 다음 날 00:00 */
export function manualOption(o: { date: DateKey; allDay: boolean; start: string; end: string }): PollOptionInput {
  if (o.allDay) return { startsAt: kstToIso(o.date), endsAt: kstToIso(addDays(o.date, 1)), allDay: true };
  // 끝이 시작보다 이르면 다음 날로 넘어간 것 ("24:00" 은 문자열 비교로 늘 뒤라 그날 자정)
  const endDay = o.end <= o.start ? addDays(o.date, 1) : o.date;
  return { startsAt: kstToIso(o.date, o.start), endsAt: kstToIso(endDay, o.end), allDay: false };
}

/** 시작 순 정렬 (같으면 끝 순) */
export function sortOptions<T extends PollOptionInput>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || Date.parse(a.endsAt) - Date.parse(b.endsAt));
}
