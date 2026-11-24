import { ApiException } from '../common/errors.js';
import { paletteColorOf } from '../common/member.js';
import { isCalendarDate, parseIsoDate } from '../common/validation.js';
import { type EventReminder, remindAt, reminderFits, reminderMismatchMessage } from '../push/remind-at.js';
import type { EventPatchDto } from './dto/event.dto.js';
import type { EventUpdateInput } from './event-write-data.js';
import { parsePlace, samePlace } from './place.js';
import { fitsInPeriod, kstDate, type Repeat } from './recurrence.js';

/** 일정 입력 검증과 정규화 (시각, 반복, 알림, 색, 범위 쿼리). EventsService 에서 옮김 (#496) */

const DAY_MS = 24 * 60 * 60 * 1000;
/** 일정 길이 상한 (결정기록 D-15) */
export const MAX_EVENT_DAYS = 30;
/** 기간 조회 상한. 월 그리드 42일 + 여유 */
export const MAX_RANGE_DAYS = 62;

/** 반복 일정 수정/삭제 범위 쿼리 (원문) */
export interface ScopeQuery {
  occurrence?: unknown;
  scope?: unknown;
}

type Scope = 'this' | 'following';

/** 비교와 저장에 쓰는 일정 값 */
export type EventValues = Pick<EventUpdateInput, 'title' | 'startsAt' | 'endsAt' | 'allDay' | 'memo' | 'reminder' | 'place'>;

/** `endsAt > startsAt`, 길이 30일 이하. 아니면 EVENT_RANGE_INVALID */
export function assertEventRange(startsAt: Date, endsAt: Date): void {
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new ApiException('EVENT_RANGE_INVALID', '종료 시각은 시작 시각보다 뒤여야 해요');
  }
  if (endsAt.getTime() - startsAt.getTime() > MAX_EVENT_DAYS * DAY_MS) {
    throw new ApiException('EVENT_RANGE_INVALID', `일정은 최대 ${MAX_EVENT_DAYS}일까지 만들 수 있어요`);
  }
}

/**
 * 반복 규칙 검증 (설계 4-1). `repeatUntil` 만 있으면 VALIDATION_FAILED,
 * 길이 >= 주기 또는 `repeatUntil` < 첫 회차 날짜면 EVENT_RANGE_INVALID
 */
export function assertRepeatRule(repeat: Repeat | null, repeatUntil: string | null, startsAt: Date, endsAt: Date): void {
  if (repeat === null) {
    if (repeatUntil !== null) {
      const message = '반복 주기 없이 종료 날짜만 정할 수 없어요';
      throw new ApiException('VALIDATION_FAILED', message, [{ field: 'repeatUntil', message }]);
    }
    return;
  }
  if (!fitsInPeriod(repeat, startsAt, endsAt)) {
    throw new ApiException('EVENT_RANGE_INVALID', '반복 간격보다 긴 일정은 반복할 수 없어요');
  }
  if (repeatUntil !== null && repeatUntil < kstDate(startsAt)) {
    throw new ApiException('EVENT_RANGE_INVALID', '종료 날짜는 시작 날짜 뒤여야 해요');
  }
}

/**
 * "이후 모두" 에서 본문에 repeatUntil 이 없을 때 이어받는 종료 날짜 (QA3-L1).
 * 사용자가 종료를 건드리지 않았는데 회차를 종료 날짜 뒤로 옮겼으면, 옮긴 회차가 남도록 종료를 새 시작 날짜로 늘린다
 */
export function inheritedUntil(seriesUntil: string | null, startsAt: Date): string | null {
  if (seriesUntil === null) return null;
  const startDate = kstDate(startsAt);
  return seriesUntil < startDate ? startDate : seriesUntil;
}

/** 조회 구간 검증. `to > from`, `to - from <= maxDays` */
export function parseRange(fromRaw: string, toRaw: string, maxDays: number): { from: Date; to: Date } {
  const from = parseIsoDate(fromRaw, 'from');
  const to = parseIsoDate(toRaw, 'to');
  if (to.getTime() <= from.getTime()) {
    throw new ApiException('EVENT_RANGE_INVALID', 'to 는 from 보다 뒤여야 해요');
  }
  if (to.getTime() - from.getTime() > maxDays * DAY_MS) {
    throw new ApiException('EVENT_RANGE_INVALID', `조회 범위는 최대 ${maxDays}일이에요`);
  }
  return { from, to };
}

/** 저장하려는 값이 현재 값과 모두 같은지. 시각은 같은 순간이면 같다 (`+09:00` 표기 차이 무시). 알림 포함 (#188) */
export function isUnchanged(current: EventValues, next: EventValues): boolean {
  return (
    current.title === next.title &&
    current.startsAt.getTime() === next.startsAt.getTime() &&
    current.endsAt.getTime() === next.endsAt.getTime() &&
    current.allDay === next.allDay &&
    current.memo === next.memo &&
    current.reminder === next.reminder &&
    samePlace(current.place, next.place)
  );
}

/** (#188) 알림 시각을 정하는 회차 값(시작, 끝, 종일, 알림)이 바뀌었는지 (D-86) */
export function reminderTimingChanged(current: EventValues, next: EventValues): boolean {
  return (
    current.startsAt.getTime() !== next.startsAt.getTime() ||
    current.endsAt.getTime() !== next.endsAt.getTime() ||
    current.allDay !== next.allDay ||
    current.reminder !== next.reminder
  );
}

/**
 * (#188) 저장할 알림 (설계 4-1, D-84). 본문 값이 종일 여부와 안 맞으면 VALIDATION_FAILED,
 * 본문에 없는데 종일이 바뀌어 지금 값이 안 맞게 되면 NONE
 */
export function resolveReminder(input: EventReminder | null | undefined, current: EventReminder, allDay: boolean): EventReminder {
  if (input !== undefined && input !== null) {
    if (!reminderFits(allDay, input)) throw validationFailed('reminder', reminderMismatchMessage(allDay));
    return input;
  }
  return reminderFits(allDay, current) ? current : 'NONE';
}

/** (#188) 한 번짜리만 알림 시각을 저장한다. 반복 원본은 null (D-85) */
export function storedRemindAt(values: EventValues, repeat: Repeat | null | undefined): Date | null {
  return repeat ? null : remindAt(values.startsAt, values.allDay, values.reminder);
}

/** 회차 값 비교. 메모는 null 과 '' 를 같은 "메모 없음" 으로 본다 (예외의 메모 지움은 '', D-65) */
export function sameOccurrenceValues(a: EventValues, b: EventValues): boolean {
  return isUnchanged({ ...a, memo: a.memo ?? '' }, { ...b, memo: b.memo ?? '' });
}

/** 부분 변경을 기준 값과 합친다. 시각 형식 오류는 VALIDATION_FAILED. 알림은 합친 종일 여부로 검사 (#188) */
export function mergeValues(base: EventValues, dto: EventPatchDto): EventValues {
  const allDay = dto.allDay ?? base.allDay;
  return {
    title: dto.title ?? base.title,
    startsAt: dto.startsAt !== undefined ? parseIsoDate(dto.startsAt, 'startsAt') : base.startsAt,
    endsAt: dto.endsAt !== undefined ? parseIsoDate(dto.endsAt, 'endsAt') : base.endsAt,
    allDay,
    // 빈 메모('')는 메모 지우기 = null. 회차 예외에서는 아래에서 '' 로 다시 바꿔 저장한다 (D-65)
    memo: dto.memo !== undefined ? (dto.memo === '' ? null : dto.memo) : base.memo,
    reminder: resolveReminder(dto.reminder, base.reminder, allDay),
    // (#199) 생략은 그대로, null 은 지우기 (D-242)
    place: dto.place !== undefined ? (parsePlace(dto.place) ?? null) : base.place,
  };
}

/** (#343) 색만 이 일정만 범위로 바꾸려 할 때 (참여자와 같은 규칙, D-215) */
export const COLOR_THIS_SCOPE_MESSAGE = '반복 일정의 색은 이후 모두로만 바꿀 수 있어요';

/**
 * (#343) 본문의 색 → 저장할 값. undefined 는 그대로(생략), null 은 자동. DTO 가 팔레트 키만 통과시키므로 대문자로만 맞춘다 (D-215)
 */
export function colorInput(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined || raw === null) return raw;
  return paletteColorOf(raw) ?? raw;
}

export function validationFailed(field: string, message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', message, [{ field, message }]);
}

/** `occurrence` 쿼리. 'YYYY-MM-DD' 실제 날짜가 아니면 VALIDATION_FAILED */
export function parseOccurrence(raw: unknown): string {
  if (typeof raw !== 'string' || !isCalendarDate(raw)) {
    throw validationFailed('occurrence', 'occurrence 는 YYYY-MM-DD 형식의 실제 날짜여야 해요');
  }
  return raw;
}

/** 반복 일정 수정/삭제 쿼리 (설계 4장). 없거나 틀리면 VALIDATION_FAILED */
export function parseScopeQuery(query: ScopeQuery): { scope: Scope; occurrence: string } {
  if (query.scope !== 'this' && query.scope !== 'following') {
    throw validationFailed('scope', '반복 일정은 scope 를 this 또는 following 으로 골라야 해요');
  }
  return { scope: query.scope, occurrence: parseOccurrence(query.occurrence) };
}
