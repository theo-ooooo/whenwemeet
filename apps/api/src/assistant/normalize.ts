import type { Member } from '../common/member.js';
import { ApiException } from '../common/errors.js';
import { isCalendarDate } from '../common/validation.js';
import { addDays, dateToDay, kstDate, kstMidnight } from '../events/recurrence.js';
import { checkOptions } from '../polls/poll-rules.js';
import type { Interval } from '../free-slots/slots.js';
import type { ClarifyField, DaysFilter, EventDraftCard, PollDraft } from './assistant.types.js';
import { kstWeekday } from './prompt.js';

/**
 * (#450) 모델 인자 검사, 정규화 (설계 AI-비서.md 4-1, D-268). 순수 함수.
 * 날짜와 시각은 KST 글자로 받아 ISO UTC 로 바꾸고, 사람은 이름으로 받아 지금 팀 멤버 안에서만 찾는다.
 * 고칠 수 없는 값은 NormalizeProblem 으로 던진다 (되묻기, 형식 실패, 못 하는 일)
 */

export type Problem =
  | { kind: 'clarify'; field: ClarifyField; name?: string; choices?: Member[] }
  | { kind: 'invalid' }
  | { kind: 'unsupported'; action: 'team_only' };

export class NormalizeProblem extends Error {
  constructor(readonly problem: Problem) {
    super(`볼까 인자 정규화: ${problem.kind}`);
    this.name = 'NormalizeProblem';
  }
}

const clarify = (field: ClarifyField, extra: { name?: string; choices?: Member[] } = {}) => new NormalizeProblem({ kind: 'clarify', field, ...extra });
const invalid = () => new NormalizeProblem({ kind: 'invalid' });

export const MAX_TITLE = 50;
export const MAX_PLACE = 100;
export const MAX_NAME = 20;
export const MAX_KEYWORD = 20;
/** 일정 길이 상한 (D-15) */
export const MAX_EVENT_DAYS = 30;
/** 빈 시간, 일정 찾기 기간 상한 (일) */
export const MAX_SEARCH_DAYS = 31;
/** 기념일 찾기 기간 상한 (일). 기본은 오늘부터 1년 */
export const MAX_ANNIVERSARY_DAYS = 731;
export const DEFAULT_DAY_START = '09:00';
export const DEFAULT_DAY_END = '23:00';
export const DEFAULT_MIN_MINUTES = 120;
export const MIN_MINUTES_RANGE = [30, 720] as const;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 비서가 보는 팀 멤버 한 명 */
export interface TeamMember {
  userId: number;
  /** Membership.displayName ?? User.nickname */
  displayName: string;
  nickname: string;
  member: Member;
}

export interface NormalizeContext {
  now: Date;
  /** 요청자 */
  userId: number;
  /** 지금 팀 멤버, 가입순 */
  members: TeamMember[];
  personal: boolean;
}

// ---------- 글자 ----------

/** 앞뒤 공백, 줄바꿈, 제어 문자를 지운다 (가운데 줄바꿈, 제어 문자는 공백 하나로) */
export function cleanText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 주소처럼 보이는 글자 (http, www.) */
export const hasUrl = (text: string): boolean => /http|www\./i.test(text);

/** 글자 수(코드 포인트) 기준으로 자른다 */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

// ---------- 날짜, 시각 ----------

/** 있는 날짜인가 ('2026-02-30' 은 아님) */
export function isRealDate(date: string): boolean {
  return isCalendarDate(date);
}

/** 날짜는 오늘 1년 전 ~ 2년 뒤만. 아니면 clarify(date) */
export function checkDate(date: string, today: string): string {
  if (!isRealDate(date) || date < addDays(today, -365) || date > addDays(today, 730)) throw clarify('date');
  return date;
}

/** KST 날짜 + 'HH:mm'(24:00 은 다음 날 00:00) → UTC 순간 (+09:00 고정) */
export function kstToDate(date: string, time: string): Date {
  if (time === '24:00') return kstMidnight(addDays(date, 1));
  return new Date(`${date}T${time}:00.000+09:00`);
}

export const minutesOf = (time: string): number => (time === '24:00' ? 24 * 60 : Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)));

// ---------- 사람 ----------

const SELF_WORDS = new Set(['나', '저', '내', '내가', '제가']);
const EVERYONE_WORDS = new Set(['모두', '다같이', '전원', '우리', '다']);
const key = (text: string): string => text.replace(/\s+/g, '').toLowerCase();

/** 받침이 있는 한글 글자인가 */
function hasFinalConsonant(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
}

export type NameMatch = { kind: 'one'; member: TeamMember } | { kind: 'many'; members: TeamMember[] } | { kind: 'none' };

/**
 * 이름 → 지금 팀 멤버 (D-268). 앞 단계에서 맞으면 멈춘다.
 * ① "나", "저", "내" → 요청자 ② 표시 이름 또는 닉네임과 같음(대소문자, 공백 무시) ③ 끝의 "님" 을 뗀 값 ④ 받침 있는 이름 + "이" 의 "이" 를 뗀 값
 */
export function matchName(raw: string, context: Pick<NormalizeContext, 'userId' | 'members'>): NameMatch {
  const name = key(raw);
  if (SELF_WORDS.has(name)) {
    const me = context.members.find((member) => member.userId === context.userId);
    return me ? { kind: 'one', member: me } : { kind: 'none' };
  }
  const candidates: string[] = [name];
  if (name.endsWith('님') && name.length > 1) candidates.push(name.slice(0, -1));
  const last = candidates[candidates.length - 1];
  const chars = Array.from(last);
  if (chars.length > 1 && chars[chars.length - 1] === '이' && hasFinalConsonant(chars[chars.length - 2])) candidates.push(chars.slice(0, -1).join(''));
  for (const candidate of candidates) {
    const hits = context.members.filter((member) => key(member.displayName) === candidate || key(member.nickname) === candidate);
    if (hits.length === 1) return { kind: 'one', member: hits[0] };
    if (hits.length > 1) return { kind: 'many', members: hits };
  }
  return { kind: 'none' };
}

/** 이름 하나를 멤버 한 명으로. 없거나 여럿이면 clarify(participant) */
export function resolveName(raw: string, context: NormalizeContext): TeamMember {
  const name = truncate(cleanText(raw), MAX_NAME);
  const match = matchName(name, context);
  if (match.kind === 'one') return match.member;
  if (match.kind === 'many') throw clarify('participant', { name, choices: match.members.map((member) => member.member) });
  throw clarify('participant', { name });
}

export interface ParticipantInput {
  participants: string[];
  everyone: boolean;
  includeMe: boolean;
}

/**
 * 참여자 id (가입순). everyone = 지금 멤버 전원 (D-263). 아니면 찾은 이름 + includeMe 면 요청자.
 * 이름도 everyone 도 없으면 fallback: 일정 초안은 요청자만(api.md 생성 기본), 빈 시간과 투표는 전원. 개인 팀은 늘 나만
 */
export function resolveParticipants(input: ParticipantInput, fallback: 'me' | 'all', context: NormalizeContext): number[] {
  const all = context.members.map((member) => member.userId);
  if (context.personal) return [context.userId];
  const names = input.participants.map(cleanText).filter((name) => name.length > 0);
  if (input.everyone || names.some((name) => EVERYONE_WORDS.has(key(name)))) return all;
  if (names.length === 0) return fallback === 'all' ? all : [context.userId];
  const ids = new Set<number>();
  for (const name of names) ids.add(resolveName(name, context).userId);
  if (input.includeMe) ids.add(context.userId);
  return all.filter((id) => ids.has(id));
}

export const membersOf = (ids: readonly number[], context: NormalizeContext): Member[] =>
  context.members.filter((member) => ids.includes(member.userId)).map((member) => member.member);

// ---------- 도구별 ----------

/** 카드에 나가는 모델 글자 (제목). URL 이면 형식 실패, 비면 clarify(title) */
function cardTitle(raw: string): string {
  const title = cleanText(raw);
  if (hasUrl(title)) throw invalid();
  if (title.length === 0) throw clarify('title');
  return truncate(title, MAX_TITLE);
}

export interface DraftEventArgs extends ParticipantInput {
  title: string;
  date: string;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  allDay: boolean;
  place: string | null;
}

/** draft_event → 일정 초안 카드 (끝 없음 +1시간, 끝 <= 시작 = 다음 날, 종일은 KST 자정 경계, 30일 상한) */
export function normalizeDraftEvent(args: DraftEventArgs, context: NormalizeContext): EventDraftCard {
  const today = kstDate(context.now);
  const title = cardTitle(args.title);
  const date = checkDate(args.date, today);
  const endDate = args.endDate === null ? null : checkDate(args.endDate, today);
  let startsAt: Date;
  let endsAt: Date;
  if (args.allDay) {
    startsAt = kstMidnight(date);
    endsAt = kstMidnight(addDays(endDate ?? date, 1));
  } else {
    if (args.startTime === null) throw clarify('time');
    startsAt = kstToDate(date, args.startTime);
    if (args.endTime === null) endsAt = new Date(startsAt.getTime() + HOUR_MS);
    else if (endDate === null && minutesOf(args.endTime) <= minutesOf(args.startTime)) endsAt = kstToDate(addDays(date, 1), args.endTime);
    else endsAt = kstToDate(endDate ?? date, args.endTime);
  }
  const length = endsAt.getTime() - startsAt.getTime();
  if (length <= 0 || length > MAX_EVENT_DAYS * DAY_MS) throw clarify('time');

  let place: { text: string } | null = null;
  if (args.place !== null) {
    const text = cleanText(args.place);
    if (hasUrl(text)) throw invalid();
    if (text.length > 0) place = { text: truncate(text, MAX_PLACE) };
  }
  const participants = resolveParticipants(args, 'me', context);
  return {
    title,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    allDay: args.allDay,
    place,
    participants,
    members: membersOf(participants, context),
  };
}

/** 양끝 포함 KST 날짜 기간 → [from 00:00, to 다음 날 00:00). 1~maxDays 일이 아니면 clarify(period) */
export function normalizePeriod(fromDate: string, toDate: string, maxDays: number, today: string): { fromDate: string; toDate: string; from: Date; to: Date } {
  if (!isRealDate(fromDate) || !isRealDate(toDate)) throw clarify('period');
  checkPeriodDate(fromDate, today);
  checkPeriodDate(toDate, today);
  const days = dateToDay(toDate) - dateToDay(fromDate) + 1;
  if (days < 1 || days > maxDays) throw clarify('period');
  return { fromDate, toDate, from: kstMidnight(fromDate), to: kstMidnight(addDays(toDate, 1)) };
}

function checkPeriodDate(date: string, today: string): void {
  if (date < addDays(today, -365) || date > addDays(today, 730)) throw clarify('period');
}

export interface FindFreeTimeArgs extends ParticipantInput {
  fromDate: string;
  toDate: string;
  days: DaysFilter;
  dayStart: string | null;
  dayEnd: string | null;
  minMinutes: number | null;
  next: 'show' | 'poll';
  purpose: string | null;
}

export interface FreeTimePlan {
  fromDate: string;
  toDate: string;
  from: Date;
  to: Date;
  dayStart: string;
  dayEnd: string;
  minMinutes: number;
  days: DaysFilter;
  participants: number[];
  poll: boolean;
  pollTitle: string | null;
}

/** 모델 글자에서 온 짧은 제목. URL, 줄바꿈(정리 전 기준)이 있거나 비면 버린다 (설계 5장) */
function optionalTitle(raw: string | null): string | null {
  if (raw === null || /[\r\n]/.test(raw)) return null;
  const text = cleanText(raw);
  if (text.length === 0 || hasUrl(text)) return null;
  return truncate(text, MAX_TITLE);
}

/** find_free_time → 계산 조건 (기간 1~31일, 하루 창 기본 09:00~23:00, 최소 길이 기본 120분, 30~720 으로 자름) */
export function normalizeFreeTime(args: FindFreeTimeArgs, context: NormalizeContext): FreeTimePlan {
  const period = normalizePeriod(args.fromDate, args.toDate, MAX_SEARCH_DAYS, kstDate(context.now));
  const dayStart = args.dayStart ?? DEFAULT_DAY_START;
  const dayEnd = args.dayEnd ?? DEFAULT_DAY_END;
  if (minutesOf(dayStart) >= minutesOf(dayEnd)) throw clarify('period');
  const minMinutes = Math.min(MIN_MINUTES_RANGE[1], Math.max(MIN_MINUTES_RANGE[0], args.minMinutes ?? DEFAULT_MIN_MINUTES));
  return {
    ...period,
    dayStart,
    dayEnd,
    minMinutes,
    days: args.days,
    participants: resolveParticipants(args, 'all', context),
    poll: args.next === 'poll' && !context.personal,
    pollTitle: optionalTitle(args.purpose),
  };
}

/** 주말 = KST 토, 일 / 평일 = 월~금 (공휴일은 따지지 않음). 구간 시작 날짜 기준 */
export function filterByDays(slots: readonly Interval[], days: DaysFilter): Interval[] {
  if (days === 'all') return [...slots];
  return slots.filter((slot) => {
    const weekday = kstWeekday(kstDate(slot.startsAt));
    const weekend = weekday === 0 || weekday === 6;
    return days === 'weekend' ? weekend : !weekend;
  });
}

export interface DraftPollArgs {
  title: string;
  options: { date: string; startTime: string; endTime: string }[];
  participants: string[];
  everyone: boolean;
}

/** draft_poll → 투표 초안 (개인 팀은 못 함, 후보 검사는 api.md 2.13 과 같은 함수) */
export function normalizeDraftPoll(args: DraftPollArgs, context: NormalizeContext): PollDraft {
  if (context.personal) throw new NormalizeProblem({ kind: 'unsupported', action: 'team_only' });
  const title = cardTitle(args.title);
  const today = kstDate(context.now);
  const raw = args.options.map((option) => {
    const date = checkDate(option.date, today);
    return { startsAt: kstToDate(date, option.startTime), endsAt: kstToDate(date, option.endTime), allDay: false as const };
  });
  let options;
  try {
    options = checkOptions(raw, context.now);
  } catch (error) {
    if (error instanceof ApiException) throw clarify('period');
    throw error;
  }
  const participants = resolveParticipants({ participants: args.participants, everyone: args.everyone, includeMe: true }, 'all', context);
  return {
    title,
    options: options.map((option) => ({ startsAt: option.startsAt.toISOString(), endsAt: option.endsAt.toISOString(), allDay: false as const })),
    participants,
  };
}

export interface ListEventsArgs {
  fromDate: string;
  toDate: string;
  member: string | null;
}

/** list_events → 기간(1~31일)과 거를 사람. 사람이 없거나 여럿이면 clarify(participant) */
export function normalizeListEvents(args: ListEventsArgs, context: NormalizeContext) {
  const period = normalizePeriod(args.fromDate, args.toDate, MAX_SEARCH_DAYS, kstDate(context.now));
  const name = args.member === null ? '' : cleanText(args.member);
  return { ...period, memberId: name.length === 0 ? null : resolveName(name, context).userId };
}

export interface FindAnniversaryArgs {
  keyword: string | null;
  fromDate: string | null;
  toDate: string | null;
}

/** find_anniversary → 기간(없으면 오늘부터 1년)과 검색어 (20자) */
export function normalizeFindAnniversary(args: FindAnniversaryArgs, context: NormalizeContext) {
  const today = kstDate(context.now);
  const fromDate = args.fromDate ?? today;
  const toDate = args.toDate ?? addDays(fromDate, 365);
  const period = normalizePeriod(fromDate, toDate, MAX_ANNIVERSARY_DAYS, today);
  const keyword = args.keyword === null ? '' : truncate(cleanText(args.keyword), MAX_KEYWORD);
  return { ...period, keyword: keyword.length === 0 ? null : keyword };
}
