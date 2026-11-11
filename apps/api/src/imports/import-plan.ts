/**
 * (#279) 읽은 VEVENT → 넣을 일정 계획 (설계 `일정-가져오기.md` 3장, D-158 ~ D-163). 순수 함수 (단위 테스트 대상).
 * 1. UID 로 원본과 바뀐 회차(RECURRENCE-ID)를 묶는다
 * 2. 한 번짜리는 그대로, 반복은 우리 규칙(WEEKLY, BIWEEKLY, MONTHLY, YEARLY)으로 옮길 수 있으면 반복으로, 아니면 회차를 펼친다
 * 3. 기간 창(오늘 이후 또는 지난 1년부터) 밖, 취소, 너무 긴 것은 이유별로 건너뛴다
 * 중복(이미 넣은 UID)과 1,000개 상한은 DB 를 본 뒤 `finalizePlan` 이 적용한다
 */
import { createHash } from 'node:crypto';
import ICAL from 'ical.js';
import {
  addDays,
  DAY_MS,
  fitsInPeriod,
  isOccurrenceDate,
  kstDate,
  kstMidnight,
  originalOccurrence,
  type Repeat,
  type SeriesRule,
  withinShiftLimit,
} from '../events/recurrence.js';
import { MAX_EVENT_DAYS } from '../events/events.service.js';
import { hasFixedOffset, INVALID_START, instantOf, type IcsEvent, type IcsTime, type ParsedCalendar } from './ics-parse.js';

export type ImportRange = 'future' | 'year';
export type SkipReason = 'DUPLICATE' | 'CANCELLED' | 'TOO_OLD' | 'TOO_LONG' | 'INVALID' | 'OVER_LIMIT';
export type ImportWarning = 'UNKNOWN_TZID' | 'TRUNCATED_TITLE';

export const SKIP_REASONS: readonly SkipReason[] = ['DUPLICATE', 'CANCELLED', 'TOO_OLD', 'TOO_LONG', 'INVALID', 'OVER_LIMIT'];

/** 한 번에 넣는 일정 수 상한 (펼친 회차 포함, 반복으로 옮긴 것은 1개) */
export const IMPORT_MAX_EVENTS = 1000;
/** "지난 1년" 의 날 수 */
export const PAST_YEAR_DAYS = 365;
/** 옮길 수 없는 반복을 펼치는 끝: 오늘부터 1년 (D-160) */
export const EXPAND_HORIZON_DAYS = 366;
/** 반복 하나를 펼치며 도는 횟수 상한, 파일 전체 상한. 넘으면 그 반복은 INVALID (D-160) */
export const STEP_LIMIT_PER_EVENT = 20_000;
export const STEP_LIMIT_PER_FILE = 100_000;
/** 끝이 없거나 시작과 같은 시간 일정의 기본 길이 (D-161) */
export const DEFAULT_TIMED_MS = 60 * 60 * 1000;
export const TITLE_MAX = 50;
export const MEMO_MAX = 500;
export const UNTITLED = '제목 없음';
const ELLIPSIS = '…';

/** 회차 예외 (EventException). null 은 원본 값 */
export interface PlannedException {
  occurrence: string;
  cancelled: boolean;
  title: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  allDay: boolean | null;
  memo: string | null;
}

/** 넣을 일정 하나 */
export interface PlannedEvent {
  /** SHA-256 hex. (팀, uidHash) 로 중복을 막는다 (D-162) */
  uidHash: string;
  title: string;
  memo: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  repeat: Repeat | null;
  repeatUntil: string | null;
  exceptions: PlannedException[];
  /** ONCE 한 번짜리, KEPT 반복을 옮김, EXPANDED 반복을 펼친 회차 */
  source: 'ONCE' | 'KEPT' | 'EXPANDED';
}

/** DB 를 보기 전 후보 */
export interface ImportCandidates {
  total: number;
  events: PlannedEvent[];
  /** 반복을 펼친 원본 수 */
  expandedSeries: number;
  skipped: Partial<Record<SkipReason, number>>;
  warnings: Set<ImportWarning>;
}

export interface ImportSample {
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  repeat: Repeat | null;
}

/** 미리보기 응답 (api.md 2.9) */
export interface ImportPreview {
  total: number;
  toCreate: number;
  recurringKept: number;
  expanded: number;
  expandedSeries: number;
  skipped: { reason: SkipReason; count: number }[];
  firstStartsAt: Date | null;
  lastStartsAt: Date | null;
  warnings: ImportWarning[];
  sample: ImportSample[];
}

export interface ImportPlan {
  preview: ImportPreview;
  /** 넣을 일정, 시작 순 (최대 1,000) */
  events: PlannedEvent[];
}

interface Span {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}

interface Window {
  /** 이 순간 이후에 끝나는 일정만 (오늘 또는 1년 전 KST 00:00) */
  lo: Date;
  /** 펼치는 반복의 끝 (이 순간 전에 시작하는 회차만) */
  hi: Date;
}

/** 기간 창. 오늘(KST) 00:00 또는 365일 전 00:00 부터 */
export function importWindow(range: ImportRange, now: Date): Window {
  const today = kstDate(now);
  const loDate = range === 'year' ? addDays(today, -PAST_YEAR_DAYS) : today;
  return { lo: kstMidnight(loDate), hi: kstMidnight(addDays(today, EXPAND_HORIZON_DAYS)) };
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** UTF-16 길이 max 안으로 자른다 (서로게이트 쌍을 가르지 않는다). 잘렸으면 끝에 '…' */
export function clip(value: string, max: number): { text: string; clipped: boolean } {
  if (value.length <= max) return { text: value, clipped: false };
  let out = '';
  for (const ch of Array.from(value)) {
    if (out.length + ch.length > max - ELLIPSIS.length) break;
    out += ch;
  }
  return { text: out + ELLIPSIS, clipped: true };
}

/** SUMMARY → 제목. 줄바꿈과 공백을 한 칸으로, 앞뒤 공백 자름, 비면 "제목 없음", 50자 넘으면 잘라 "…" */
export function toTitle(summary: string): { title: string; clipped: boolean } {
  // eslint-disable-next-line no-control-regex -- 제어 문자를 지우는 게 목적
  const normalized = summary.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  if (normalized === '') return { title: UNTITLED, clipped: false };
  const { text, clipped } = clip(normalized, TITLE_MAX);
  return { title: text, clipped };
}

/** LOCATION + DESCRIPTION → 메모. "장소: …" 첫 줄 + 설명, 500자 넘으면 잘라 "…", 비면 null */
export function toMemo(location: string, description: string): string | null {
  const place = location.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex -- 줄바꿈과 탭 말고 제어 문자를 지운다
  const body = description.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  const memo = [place ? `장소: ${place}` : '', body].filter(Boolean).join('\n');
  return memo === '' ? null : clip(memo, MEMO_MAX).text;
}

const isInvalidStart = (time: IcsTime) => time === INVALID_START;

/** 시작, 끝, 종일. 끝이 없거나 시작 이하면 종일은 하루, 시간 일정은 1시간 (D-161) */
export function spanOf(event: IcsEvent): Span {
  const startsAt = instantOf(event.start);
  const allDay = event.start.allDay;
  let endsAt: Date;
  if (event.end) endsAt = instantOf(event.end);
  else if (event.durationSec !== null) endsAt = new Date(startsAt.getTime() + event.durationSec * 1000);
  else endsAt = startsAt;
  if (endsAt.getTime() <= startsAt.getTime()) endsAt = new Date(startsAt.getTime() + (allDay ? DAY_MS : DEFAULT_TIMED_MS));
  // 종일인데 끝이 자정이 아니면(시각이 섞인 파일) 끝 날짜의 다음 날 00:00 으로 올린다
  if (allDay && (endsAt.getTime() - startsAt.getTime()) % DAY_MS !== 0) {
    endsAt = kstMidnight(addDays(kstDate(new Date(endsAt.getTime() - 1)), 1));
  }
  return { startsAt, endsAt, allDay };
}

const tooLong = (span: Span) => span.endsAt.getTime() - span.startsAt.getTime() > MAX_EVENT_DAYS * DAY_MS;

/** 회차 비교 키: 종일 반복은 KST 날짜, 시간 반복은 순간(ms) */
function occurrenceKey(time: IcsTime, allDaySeries: boolean): string {
  const instant = instantOf(time);
  return allDaySeries ? kstDate(instant) : String(instant.getTime());
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** 그 벽시계 날짜의 요일 코드 */
function wallWeekday(time: IcsTime): string {
  return WEEKDAY_CODES[new Date(Date.UTC(time.wall.y, time.wall.mo - 1, time.wall.d)).getUTCDay()];
}

const sameList = (list: (string | number)[] | undefined, value: string | number) =>
  list === undefined || (list.length === 1 && String(list[0]).toUpperCase() === String(value));

/**
 * RRULE 을 우리 반복으로 옮길 수 있으면 그 주기 (기획 3장 표, D-159). 아니면 null (펼친다).
 * - 서머타임 있는 시간대는 옮기지 않는다 (우리 반복은 KST 벽시계 고정이라 한 시간 밀린다)
 * - 매월 29~31일, 매년 2/29 는 RFC 5545 가 없는 달을 건너뛰고 우리는 말일로 보정해서(D-64) 펼친다
 */
export function mappableRepeat(event: IcsEvent): Repeat | null {
  const rule = event.rule;
  if (!rule || event.ruleUnsupported || event.rdates.length > 0) return null;
  if (!hasFixedOffset(event.start)) return null;
  const parts = rule.parts;
  const keys = Object.keys(parts);
  const start = event.start;
  const kst = kstDate(instantOf(start));
  const kstDay = Number(kst.slice(8, 10));
  const kstMonth = Number(kst.slice(5, 7));
  switch (rule.freq) {
    case 'WEEKLY': {
      if (rule.interval !== 1 && rule.interval !== 2) return null;
      if (keys.some((key) => key !== 'BYDAY')) return null;
      if (!sameList(parts.BYDAY, wallWeekday(start))) return null;
      return rule.interval === 1 ? 'WEEKLY' : 'BIWEEKLY';
    }
    case 'MONTHLY': {
      if (rule.interval !== 1 || keys.some((key) => key !== 'BYMONTHDAY')) return null;
      if (!sameList(parts.BYMONTHDAY, start.wall.d)) return null;
      return start.wall.d <= 28 && kstDay <= 28 ? 'MONTHLY' : null;
    }
    case 'YEARLY': {
      if (rule.interval !== 1 || keys.some((key) => key !== 'BYMONTH' && key !== 'BYMONTHDAY')) return null;
      if (!sameList(parts.BYMONTH, start.wall.mo) || !sameList(parts.BYMONTHDAY, start.wall.d)) return null;
      const leapDay = (start.wall.mo === 2 && start.wall.d === 29) || (kstMonth === 2 && kstDay === 29);
      return leapDay ? null : 'YEARLY';
    }
    default:
      return null;
  }
}

/** 펼칠 수 없는 주기 (시간 단위 이하는 회차가 너무 많다) */
const UNEXPANDABLE_FREQS = new Set(['SECONDLY', 'MINUTELY', 'HOURLY']);

interface RuleOccurrence {
  time: IcsTime;
  startsAt: Date;
}

/** 걸음 수 예산 (파일 전체) */
class StepBudget {
  constructor(private left: number) {}
  take(): boolean {
    if (this.left <= 0) return false;
    this.left -= 1;
    return true;
  }
}

/** 앞당겨 시작해도 회차가 같은지 확인하는 여유 (일정 길이 상한 30일 + 열흘) */
const FAST_FORWARD_MARGIN_DAYS = 40;

/**
 * COUNT 없는 매일, 매주 반복은 시작을 주기의 배수만큼 창 40일 앞까지 당겨 돈다 (1990년부터 매일 같은 규칙에 1만 번 넘게 돌지 않게).
 * 주기의 배수만 옮기므로 회차 날짜는 같다. 당긴 시작 자체는 창 밖이라 결과에 들지 않는다. 그 밖의 규칙은 그대로
 */
function fastForward(event: IcsEvent, notBefore: Date): { y: number; mo: number; d: number } {
  const rule = event.rule!;
  const wall = event.start.wall;
  if (rule.count !== null || (rule.freq !== 'DAILY' && rule.freq !== 'WEEKLY')) return wall;
  const period = rule.interval * (rule.freq === 'WEEKLY' ? 7 : 1);
  const startDay = Math.floor(Date.UTC(wall.y, wall.mo - 1, wall.d) / DAY_MS);
  const targetDay = Math.floor(notBefore.getTime() / DAY_MS) - FAST_FORWARD_MARGIN_DAYS;
  const steps = Math.floor((targetDay - startDay) / period);
  if (steps <= 0) return wall;
  const shifted = new Date((startDay + steps * period) * DAY_MS);
  return { y: shifted.getUTCFullYear(), mo: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/**
 * RRULE(+RDATE) 회차를 시작 순으로. COUNT, UNTIL 은 여기서 적용한다 (EXDATE 는 회차 수에 들어가므로 빼지 않는다).
 * `stop(startsAt)` 이 true 면 거기서 멈춘다. 상한을 넘으면 null
 */
function ruleOccurrences(event: IcsEvent, budget: StepBudget, notBefore: Date, stop: (startsAt: Date) => boolean): RuleOccurrence[] | null {
  const rule = event.rule!;
  const start = event.start;
  const seedDate = fastForward(event, notBefore);
  const seed = ICAL.Time.fromData({
    year: seedDate.y,
    month: seedDate.mo,
    day: seedDate.d,
    hour: start.wall.h,
    minute: start.wall.mi,
    second: start.wall.s,
    isDate: start.allDay,
  });
  // BY 부분 없는 매월/매년은 ical.js 가 없는 날(2/29, 31일)을 다음 달 1일로 넘긴다. RFC 5545 대로 건너뛰게 시작 날짜를 BY 로 밝힌다
  const recur = rule.recur.clone();
  if (Object.keys(rule.parts).length === 0 && rule.freq === 'MONTHLY') recur.parts = { BYMONTHDAY: [start.wall.d] };
  if (Object.keys(rule.parts).length === 0 && rule.freq === 'YEARLY') recur.parts = { BYMONTH: [start.wall.mo], BYMONTHDAY: [start.wall.d] };
  const iterator = recur.iterator(seed);
  const result: RuleOccurrence[] = [];
  for (let index = 0; ; index += 1) {
    if (index >= STEP_LIMIT_PER_EVENT || !budget.take()) return null;
    if (rule.count !== null && index >= rule.count) break;
    const next = iterator.next();
    if (!next) break;
    const wall = { y: next.year, mo: next.month, d: next.day, h: next.hour, mi: next.minute, s: next.second };
    const time: IcsTime = start.allDay
      ? { allDay: true, date: `${String(wall.y).padStart(4, '0')}-${String(wall.mo).padStart(2, '0')}-${String(wall.d).padStart(2, '0')}`, wall }
      : { allDay: false, wall, zone: start.zone };
    const startsAt = instantOf(time);
    if (rule.until && startsAt.getTime() > rule.until.getTime()) break;
    if (stop(startsAt)) break;
    result.push({ time, startsAt });
  }
  for (const rdate of event.rdates) {
    const startsAt = instantOf(rdate);
    if (!stop(startsAt)) result.push({ time: rdate, startsAt });
  }
  return result.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** 계획을 쌓는 상태 */
class Collector {
  readonly events: PlannedEvent[] = [];
  readonly skipped: Partial<Record<SkipReason, number>> = {};
  readonly warnings = new Set<ImportWarning>();
  expandedSeries = 0;

  skip(reason: SkipReason, count = 1): void {
    if (count > 0) this.skipped[reason] = (this.skipped[reason] ?? 0) + count;
  }

  title(summary: string): string {
    const { title, clipped } = toTitle(summary);
    if (clipped) this.warnings.add('TRUNCATED_TITLE');
    return title;
  }
}

interface Group {
  master: IcsEvent | null;
  overrides: IcsEvent[];
}

/** UID 로 원본과 바뀐 회차를 묶는다. UID 없는 VEVENT 는 각자 하나 */
function groupByUid(events: IcsEvent[]): Group[] {
  const byUid = new Map<string, Group>();
  const groups: Group[] = [];
  for (const event of events) {
    if (event.uid === null) {
      groups.push(event.recurrenceId ? { master: null, overrides: [event] } : { master: event, overrides: [] });
      continue;
    }
    let group = byUid.get(event.uid);
    if (!group) {
      group = { master: null, overrides: [] };
      byUid.set(event.uid, group);
      groups.push(group);
    }
    if (event.recurrenceId) group.overrides.push(event);
    else if (group.master) groups.push({ master: event, overrides: [] }); // 같은 UID 원본이 둘이면 따로 (해시가 같아 뒤의 것은 DUPLICATE)
    else group.master = event;
  }
  return groups;
}

/** UID 가 없으면 (제목, 시작, 끝) 으로 대신한다 */
function baseKey(event: IcsEvent, span: Span): string {
  return event.uid ?? `~${event.summary}|${span.startsAt.toISOString()}|${span.endsAt.toISOString()}`;
}

/** 한 번짜리 일정 하나를 계획에 넣는다 (바뀐 회차를 따로 넣을 때도) */
function addOnce(c: Collector, event: IcsEvent, key: string, window: Window, source: PlannedEvent['source'] = 'ONCE'): void {
  if (event.status === 'CANCELLED') return c.skip('CANCELLED');
  const span = spanOf(event);
  if (tooLong(span)) return c.skip('TOO_LONG');
  if (span.endsAt.getTime() <= window.lo.getTime()) return c.skip('TOO_OLD');
  c.events.push({
    uidHash: sha256Hex(key),
    title: c.title(event.summary),
    memo: toMemo(event.location, event.description),
    ...span,
    repeat: null,
    repeatUntil: null,
    exceptions: [],
    source,
  });
}

/** 바뀐 회차를 따로 넣을 때의 키 */
const overrideKey = (uid: string | null, override: IcsEvent) => `${uid ?? ''}#${instantOf(override.recurrenceId!).toISOString()}`;

function addSeries(c: Collector, group: Group, window: Window, budget: StepBudget): void {
  const master = group.master!;
  if (master.status === 'CANCELLED') return c.skip('CANCELLED', 1 + group.overrides.length);
  const span = spanOf(master);
  if (tooLong(span)) return c.skip('TOO_LONG', 1 + group.overrides.length);
  if (master.ruleUnsupported || UNEXPANDABLE_FREQS.has(master.rule!.freq)) return c.skip('INVALID', 1 + group.overrides.length);

  const repeat = mappableRepeat(master);
  if (repeat && !fitsInPeriod(repeat, span.startsAt, span.endsAt)) return c.skip('TOO_LONG', 1 + group.overrides.length);
  if (repeat) return keepSeries(c, group, span, repeat, window, budget);
  return expandSeries(c, group, span, window, budget);
}

/** 반복을 우리 규칙으로 옮긴다. 시작은 기간 창 안 첫 회차로 당긴다 (D-160) */
function keepSeries(c: Collector, group: Group, span: Span, repeat: Repeat, window: Window, budget: StepBudget): void {
  const master = group.master!;
  const rule = master.rule!;
  const duration = span.endsAt.getTime() - span.startsAt.getTime();
  const finite = rule.count !== null || rule.until !== null;
  let found = false;
  const occurrences = ruleOccurrences(master, budget, window.lo, (startsAt) => {
    // 끝이 없는 규칙은 창 안 첫 회차만 찾으면 된다
    if (!finite && found) return true;
    if (startsAt.getTime() + duration > window.lo.getTime()) found = true;
    return false;
  });
  if (!occurrences) return c.skip('INVALID', 1 + group.overrides.length);
  const firstIndex = occurrences.findIndex((occurrence) => occurrence.startsAt.getTime() + duration > window.lo.getTime());
  if (firstIndex < 0) {
    // 원본 회차는 모두 지났다. 옮겨 온 바뀐 회차만 따로 본다
    c.skip('TOO_OLD');
    for (const override of group.overrides) addOnce(c, override, overrideKey(master.uid, override), window);
    return;
  }
  const startsAt = occurrences[firstIndex].startsAt;
  const series: SeriesRule = {
    startsAt,
    endsAt: new Date(startsAt.getTime() + duration),
    allDay: span.allDay,
    repeat,
    repeatUntil: finite ? kstDate(occurrences[occurrences.length - 1].startsAt) : null,
  };
  const startDate = kstDate(startsAt);
  const title = c.title(master.summary);
  const memo = toMemo(master.location, master.description);
  const exceptions = new Map<string, PlannedException>();
  const cancel = (occurrence: string) =>
    exceptions.set(occurrence, { occurrence, cancelled: true, title: null, startsAt: null, endsAt: null, allDay: null, memo: null });
  const inSeries = (date: string) => date >= startDate && isOccurrenceDate(series, date);

  for (const exdate of master.exdates) {
    const date = kstDate(instantOf(exdate));
    if (inSeries(date)) cancel(date);
  }
  for (const override of group.overrides) {
    const date = kstDate(instantOf(override.recurrenceId!));
    if (!inSeries(date)) {
      // 창보다 앞 회차를 바꾼 것이거나 규칙에 없는 날: 따로 한 번짜리로
      addOnce(c, override, overrideKey(master.uid, override), window);
      continue;
    }
    if (override.status === 'CANCELLED') {
      cancel(date);
      continue;
    }
    const moved = spanOf(override);
    if (tooLong(moved) || !withinShiftLimit(date, moved.startsAt, moved.endsAt)) {
      // 앞뒤 30일 밖으로 옮긴 회차는 원본에서 취소하고 따로 넣는다 (기획 3장)
      cancel(date);
      addOnce(c, override, overrideKey(master.uid, override), window);
      continue;
    }
    const original = originalOccurrence(series, date);
    const overrideTitle = c.title(override.summary);
    const overrideMemo = toMemo(override.location, override.description);
    exceptions.set(date, {
      occurrence: date,
      cancelled: false,
      title: overrideTitle !== title ? overrideTitle : null,
      startsAt: moved.startsAt.getTime() !== original.startsAt.getTime() ? moved.startsAt : null,
      endsAt: moved.endsAt.getTime() !== original.endsAt.getTime() ? moved.endsAt : null,
      allDay: moved.allDay !== span.allDay ? moved.allDay : null,
      memo: overrideMemo !== memo ? (overrideMemo ?? '') : null,
    });
  }

  c.events.push({
    uidHash: sha256Hex(baseKey(master, span)),
    title,
    memo,
    startsAt: series.startsAt,
    endsAt: series.endsAt,
    allDay: span.allDay,
    repeat,
    repeatUntil: series.repeatUntil,
    exceptions: [...exceptions.values()].sort((a, b) => a.occurrence.localeCompare(b.occurrence)),
    source: 'KEPT',
  });
}

/** 옮길 수 없는 반복: 기간 창 ~ 오늘부터 1년 안 회차를 한 번짜리로 (D-160) */
function expandSeries(c: Collector, group: Group, span: Span, window: Window, budget: StepBudget): void {
  const master = group.master!;
  const allDay = span.allDay;
  const duration = span.endsAt.getTime() - span.startsAt.getTime();
  const occurrences = ruleOccurrences(master, budget, window.lo, (startsAt) => startsAt.getTime() >= window.hi.getTime());
  if (!occurrences) return c.skip('INVALID', 1 + group.overrides.length);

  const excluded = new Set(master.exdates.map((time) => occurrenceKey(time, allDay)));
  const overrides = new Map(group.overrides.map((override) => [occurrenceKey(override.recurrenceId!, allDay), override]));
  const title = c.title(master.summary);
  const memo = toMemo(master.location, master.description);
  const before = c.events.length;
  const seen = new Set<string>();
  for (const occurrence of occurrences) {
    const key = occurrenceKey(occurrence.time, allDay);
    if (seen.has(key)) continue;
    seen.add(key);
    const override = overrides.get(key);
    if (override) {
      overrides.delete(key);
      addOnce(c, override, overrideKey(master.uid, override), window, 'EXPANDED');
      continue;
    }
    if (excluded.has(key)) continue;
    const endsAt = new Date(occurrence.startsAt.getTime() + duration);
    if (endsAt.getTime() <= window.lo.getTime()) continue;
    c.events.push({
      uidHash: sha256Hex(`${baseKey(master, span)}@${occurrence.startsAt.toISOString()}`),
      title,
      memo,
      startsAt: occurrence.startsAt,
      endsAt,
      allDay,
      repeat: null,
      repeatUntil: null,
      exceptions: [],
      source: 'EXPANDED',
    });
  }
  // 규칙 회차와 짝이 없는 바뀐 회차 (창 밖 회차를 창 안으로 옮긴 것 등)
  for (const override of overrides.values()) addOnce(c, override, overrideKey(master.uid, override), window);
  if (c.events.length === before) c.skip('TOO_OLD');
  else c.expandedSeries += 1;
}

/** 파일 → 후보 (DB 를 보기 전). 기간 창 밖, 취소, 너무 긴 것, 못 읽은 것은 이유별로 센다 */
export function buildCandidates(calendar: ParsedCalendar, range: ImportRange, now: Date): ImportCandidates {
  const c = new Collector();
  const window = importWindow(range, now);
  const budget = new StepBudget(STEP_LIMIT_PER_FILE);
  for (const event of calendar.events) if (event.unknownTzid) c.warnings.add('UNKNOWN_TZID');

  for (const group of groupByUid(calendar.events)) {
    const master = group.master;
    if (!master) {
      // 원본 없는 바뀐 회차: 한 번짜리로
      for (const override of group.overrides) {
        if (isInvalidStart(override.start)) c.skip('INVALID');
        else addOnce(c, override, overrideKey(override.uid, override), window);
      }
      continue;
    }
    if (isInvalidStart(master.start)) {
      c.skip('INVALID', 1 + group.overrides.length);
      continue;
    }
    if (!master.rule && !master.ruleUnsupported && master.rdates.length === 0) {
      addOnce(c, master, baseKey(master, spanOf(master)), window);
      // 반복이 아닌데 바뀐 회차가 있으면 각자 한 번짜리로
      for (const override of group.overrides) addOnce(c, override, overrideKey(master.uid, override), window);
      continue;
    }
    if (!master.rule && master.rdates.length > 0) {
      // RDATE 만 있는 반복: DTSTART 와 RDATE 각각을 한 번짜리로
      addRdateOnly(c, group, window);
      continue;
    }
    addSeries(c, group, window, budget);
  }
  return { total: calendar.veventCount, events: c.events, expandedSeries: c.expandedSeries, skipped: c.skipped, warnings: c.warnings };
}

/** RRULE 없이 RDATE 만 있는 VEVENT. DTSTART 와 RDATE 날짜마다 같은 길이로 */
function addRdateOnly(c: Collector, group: Group, window: Window): void {
  const master = group.master!;
  const span = spanOf(master);
  const duration = span.endsAt.getTime() - span.startsAt.getTime();
  const times = [master.start, ...master.rdates];
  const excluded = new Set(master.exdates.map((time) => occurrenceKey(time, span.allDay)));
  const before = c.events.length;
  for (const time of times) {
    if (excluded.has(occurrenceKey(time, span.allDay))) continue;
    const startsAt = instantOf(time);
    const event: IcsEvent = { ...master, start: time, end: null, durationSec: duration / 1000, rdates: [], rule: null };
    addOnce(c, event, `${baseKey(master, span)}@${startsAt.toISOString()}`, window, 'EXPANDED');
  }
  if (c.events.length > before) c.expandedSeries += 1;
}

/**
 * 이미 넣은 것(DUPLICATE)과 같은 파일 안 겹침을 빼고, 시작 순 1,000개까지 (넘는 것은 OVER_LIMIT).
 * 미리보기와 넣기가 같은 결과를 쓴다
 */
export function finalizePlan(candidates: ImportCandidates, existing: ReadonlySet<string>): ImportPlan {
  const skipped = { ...candidates.skipped };
  const add = (reason: SkipReason, count = 1) => {
    if (count > 0) skipped[reason] = (skipped[reason] ?? 0) + count;
  };
  const seen = new Set<string>();
  const fresh: PlannedEvent[] = [];
  for (const event of candidates.events) {
    if (existing.has(event.uidHash) || seen.has(event.uidHash)) {
      add('DUPLICATE');
      continue;
    }
    seen.add(event.uidHash);
    fresh.push(event);
  }
  fresh.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.uidHash.localeCompare(b.uidHash));
  const events = fresh.slice(0, IMPORT_MAX_EVENTS);
  add('OVER_LIMIT', fresh.length - events.length);

  const preview: ImportPreview = {
    total: candidates.total,
    toCreate: events.length,
    recurringKept: events.filter((event) => event.source === 'KEPT').length,
    expanded: events.filter((event) => event.source === 'EXPANDED').length,
    expandedSeries: candidates.expandedSeries,
    skipped: SKIP_REASONS.filter((reason) => (skipped[reason] ?? 0) > 0).map((reason) => ({ reason, count: skipped[reason]! })),
    firstStartsAt: events[0]?.startsAt ?? null,
    lastStartsAt: events.length > 0 ? events.reduce((max, event) => (event.startsAt > max ? event.startsAt : max), events[0].startsAt) : null,
    warnings: (['UNKNOWN_TZID', 'TRUNCATED_TITLE'] as const).filter((warning) => candidates.warnings.has(warning)),
    sample: events.slice(0, 5).map((event) => ({
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      repeat: event.repeat,
    })),
  };
  return { preview, events };
}
