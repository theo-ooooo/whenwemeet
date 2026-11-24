import type { Member } from '../common/member.js';
import { addDays, dateToDay, kstDate, kstMidnight } from '../events/recurrence.js';
import type { EventAfter, EventTarget } from './assistant.types.js';
import {
  type NormalizeContext,
  NormalizeProblem,
  cardTitle,
  checkDate,
  cleanText,
  draftDate,
  hasUrl,
  kstToDate,
  MAX_EVENT_DAYS,
  MAX_KEYWORD,
  MAX_PLACE,
  minutesOf,
  truncate,
  weekdayIsName,
} from './normalize.js';
import { kstTime, kstWeekday } from './prompt.js';
import { MAX_TARGETS } from './tools.js';
import { NO_WHEN, resolvePeriod, resolveWhen, weekRange, type WhenArg } from './when.js';

/**
 * (#511) 볼까 일정 고치기, 지우기의 대상 찾기와 바꿀 값 정규화 (설계 AI-비서.md 4-5, D-283). 순수 함수.
 * 모델은 대상을 사용자가 말한 제목 말, 날짜 표현, 지금 시각으로만 주고 id 를 주지 않는다. 서버가 이 팀 일정에서 찾는다.
 * 바꿀 값은 draft_event 와 같은 규칙(시각 기본, 끝 <= 시작은 다음 날, 종일은 KST 자정 경계, 30일 상한)으로 정한다
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 날짜를 말하지 않았을 때 찾는 기간: 오늘 7일 전 ~ 60일 뒤 (양끝 포함) */
export const TARGET_LOOKBACK_DAYS = 7;
export const TARGET_AHEAD_DAYS = 60;

export interface TargetArgs {
  title: string | null;
  when: WhenArg;
  time: string | null;
}

export interface EditChangesArgs {
  title: string | null;
  date: WhenArg;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean | null;
  place: string | null;
}

export interface FindEditArgs extends TargetArgs {
  changes: EditChangesArgs;
}

export interface TargetSearch {
  /** 양끝 포함 KST 날짜 */
  fromDate: string;
  toDate: string;
  /** 제목 말 (정리, 20자). 없으면 null */
  keyword: string | null;
  /** 지금 시작 시각 'HH:mm'. 없으면 null */
  time: string | null;
}

const problem = (field: 'date' | 'which' | 'time' | 'change', subject?: string) =>
  new NormalizeProblem({ kind: 'clarify', field, ...(subject ? { subject } : {}) });

/** 그 자체로 기간인 표현 (주, 주말, 달) */
const RANGE_KINDS = new Set<WhenArg['kind']>(['week', 'weekend', 'month']);

/** 모델 글자에서 온 제목 말. 주소처럼 보이거나 비면 null */
export function targetKeyword(raw: string | null): string | null {
  if (raw === null) return null;
  const text = cleanText(raw);
  if (text.length === 0 || hasUrl(text)) return null;
  return truncate(text, MAX_KEYWORD);
}

/**
 * 찾을 기간과 거를 값. 날짜를 말하지 않았으면 오늘 7일 전 ~ 60일 뒤, 주, 주말, 달이면 그 기간, 하루 표현이면 그날.
 * 이름 첫 글자를 요일로 읽었으면(D-278 ①) 날짜를 말하지 않은 것으로. 제목 말도 날짜도 없으면 clarify(which)
 */
export function targetSearch(args: TargetArgs, context: NormalizeContext): TargetSearch {
  const today = kstDate(context.now);
  const keyword = targetKeyword(args.title);
  const when = weekdayIsName(args.when, context) ? NO_WHEN : args.when;
  let fromDate: string;
  let toDate: string;
  if (when.kind === null) {
    if (keyword === null) throw problem('which');
    fromDate = addDays(today, -TARGET_LOOKBACK_DAYS);
    toDate = addDays(today, TARGET_AHEAD_DAYS);
  } else if (RANGE_KINDS.has(when.kind)) {
    const period = resolvePeriod(when, NO_WHEN, today);
    if (period === null) throw problem('date');
    ({ fromDate, toDate } = period);
  } else {
    // 요일만 말했으면 오늘(지났어도)부터 가장 가까운 그 요일. 시각은 따지지 않는다 (지난 일정도 고칠 수 있다)
    const date = resolveWhen(when, { today });
    if (date === null) throw problem('date');
    fromDate = date;
    toDate = date;
  }
  checkDate(fromDate, today);
  checkDate(toDate, today);
  return { fromDate, toDate, keyword, time: args.time };
}

const compact = (text: string): string => text.replace(/\s+/g, '').toLowerCase();

/** 제목 말의 낱말들. 끝의 "일정" 은 뗀다 ("회식 일정" → 회식) */
function keywordTokens(keyword: string): string[] {
  return keyword
    .split(/\s+/)
    .map((word) => compact(word).replace(/일정$/, ''))
    .filter((word) => word.length > 0);
}

/**
 * 제목 말로 거른다 (공백, 대소문자 무시). 낱말이 모두 제목에 들어 있으면 맞음 ("강남 회식" → "강남 팀 회식").
 * 하나도 맞지 않으면 제목이 말 안에 들어 있는 것 ("병원 예약" → "병원")
 */
export function matchesKeyword<T extends { title: string }>(list: readonly T[], keyword: string | null): T[] {
  if (keyword === null) return [...list];
  const tokens = keywordTokens(keyword);
  if (tokens.length === 0) return [...list];
  const byTokens = list.filter((item) => tokens.every((token) => compact(item.title).includes(token)));
  if (byTokens.length > 0) return byTokens;
  const said = compact(keyword);
  return list.filter((item) => {
    const title = compact(item.title);
    return title.length > 0 && said.includes(title);
  });
}

export interface TargetCandidate {
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}

/**
 * 기간 안 일정(반복은 회차로 펼친 것) → 기간과 겹치는 것 중 제목 말, 지금 시각으로 거른 뒤 지금과 가까운 순.
 * 시각을 말했으면 그 시각에 시작하는 종일 아닌 일정만
 */
export function matchTargets<T extends TargetCandidate>(list: readonly T[], search: TargetSearch, now: Date): T[] {
  // 기간과 겹치는 것만 (목록이 이미 기간으로 읽었어도 한 번 더, 실모델 평가의 고정 일정도 같은 규칙)
  const from = kstMidnight(search.fromDate).getTime();
  const to = kstMidnight(addDays(search.toDate, 1)).getTime();
  const inPeriod = list.filter((item) => item.startsAt.getTime() < to && item.endsAt.getTime() > from);
  let matched = matchesKeyword(inPeriod, search.keyword);
  if (search.time !== null) matched = matched.filter((item) => !item.allDay && kstTime(item.startsAt) === search.time);
  const distance = (item: T) => Math.abs(item.startsAt.getTime() - now.getTime());
  return [...matched].sort((a, b) => distance(a) - distance(b) || a.startsAt.getTime() - b.startsAt.getTime());
}

/** 고르기 카드에 싣는 앞 5개 */
export const firstTargets = <T>(list: readonly T[]): T[] => list.slice(0, MAX_TARGETS);

/** 일정 응답 모양(EventView) → 대상 카드 값 */
export function toTarget(view: {
  id: number;
  publicCode: string;
  occurrence: string | null;
  repeat: unknown;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  place: { text: string | null; query?: string | null } | null;
  participants: { members: Member[] };
}): EventTarget {
  const placeText = view.place ? (view.place.text ?? view.place.query ?? '').trim() : '';
  return {
    id: view.id,
    publicCode: view.publicCode,
    occurrence: view.occurrence,
    repeat: view.repeat !== null && view.repeat !== undefined,
    title: view.title,
    startsAt: view.startsAt.toISOString(),
    endsAt: view.endsAt.toISOString(),
    allDay: view.allDay,
    place: placeText ? { text: placeText } : null,
    members: view.participants.members,
  };
}

/** 사용자가 무엇이든 바꾸라고 했는가 (모든 값이 비면 되묻는다) */
export function hasChanges(changes: EditChangesArgs): boolean {
  const text = (raw: string | null) => raw !== null && cleanText(raw).length > 0;
  return text(changes.title) || changes.date.kind !== null || changes.startTime !== null || changes.endTime !== null || changes.allDay !== null || text(changes.place);
}

/**
 * 새 날짜. 말하지 않았으면 지금 날짜. "다음 주로"처럼 주만 말했으면 그 주의 같은 요일.
 * 그 밖은 일정 초안과 같은 규칙(요일만이면 가장 가까운 그 요일, 지난 "이번 주 X요일"은 되묻기)
 */
function newDate(when: WhenArg, current: string, startTime: string | null, context: NormalizeContext): string {
  if (when.kind === null) return current;
  if (when.kind === 'week') {
    const [sunday] = weekRange(kstDate(context.now), when.which ?? 'this');
    return checkDate(addDays(sunday, kstWeekday(current)), kstDate(context.now));
  }
  return draftDate(when, context, startTime);
}

/**
 * 대상 + 바꿀 값 → 고친 뒤 값. 지금 값과 같으면 null (바꿀 것이 없음).
 * - 제목: 새 제목(1~50자, 주소면 형식 실패), 장소: 새 장소(100자), 없으면 그대로
 * - 종일: allDay 를 말하지 않았으면 시각을 말했을 때 시각 일정, 아니면 지금 그대로. 종일은 새 날짜부터 지금 일 수만큼 (시각 일정을 종일로 바꾸면 하루)
 * - 시각: 새 시작 ?? 지금 시작(종일이던 일정이면 되묻기). 새 끝이 있으면 그 시각(시작보다 이르거나 같으면 다음 날), 없으면 지금 길이 그대로(종일이던 일정은 1시간)
 */
export function normalizeEdit(target: EventTarget, changes: EditChangesArgs, context: NormalizeContext): EventAfter | null {
  const title = changes.title !== null && cleanText(changes.title).length > 0 ? cardTitle(changes.title) : target.title;
  let place = target.place;
  if (changes.place !== null) {
    const text = cleanText(changes.place);
    if (hasUrl(text)) throw new NormalizeProblem({ kind: 'invalid' });
    if (text.length > 0) place = { text: truncate(text, MAX_PLACE) };
  }
  const startsAt0 = new Date(target.startsAt);
  const endsAt0 = new Date(target.endsAt);
  const currentDate = kstDate(startsAt0);
  // 시각을 말했으면 종일이 아니다 ("여행 10시로")
  const allDay = changes.allDay ?? (changes.startTime !== null ? false : target.allDay);
  const dateWhen = weekdayIsName(changes.date, context) ? NO_WHEN : changes.date;

  let startsAt: Date;
  let endsAt: Date;
  if (allDay) {
    const date = newDate(dateWhen, currentDate, null, context);
    const days = target.allDay ? Math.max(1, dateToDay(kstDate(new Date(endsAt0.getTime() - 1))) - dateToDay(currentDate) + 1) : 1;
    startsAt = kstMidnight(date);
    endsAt = kstMidnight(addDays(date, days));
  } else {
    const startTime = changes.startTime ?? (target.allDay ? null : kstTime(startsAt0));
    if (startTime === null) throw problem('time', title);
    const date = newDate(dateWhen, currentDate, startTime, context);
    startsAt = kstToDate(date, startTime);
    if (changes.endTime !== null) {
      endsAt = kstToDate(minutesOf(changes.endTime) <= minutesOf(startTime) ? addDays(date, 1) : date, changes.endTime);
    } else {
      endsAt = new Date(startsAt.getTime() + (target.allDay ? HOUR_MS : endsAt0.getTime() - startsAt0.getTime()));
    }
  }
  const length = endsAt.getTime() - startsAt.getTime();
  if (length <= 0 || length > MAX_EVENT_DAYS * DAY_MS) throw problem('time', title);

  const after: EventAfter = { title, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), allDay, place };
  const same =
    after.title === target.title &&
    after.startsAt === target.startsAt &&
    after.endsAt === target.endsAt &&
    after.allDay === target.allDay &&
    (after.place?.text ?? null) === (target.place?.text ?? null);
  return same ? null : after;
}
