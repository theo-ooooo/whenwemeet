import { ApiException } from '../common/errors.js';
import type { EventValues } from './event-input.js';
import type { EventExceptionRow, EventRow } from './event-rows.js';
import { toPlaceView } from './place.js';
import {
  applyException,
  isOccurrenceDate,
  kstDate,
  type Occurrence,
  originalOccurrence,
  type Repeat,
  type SeriesRule,
} from './recurrence.js';

/** 반복 원본 행의 규칙과 회차 값. EventsService 에서 옮김 (#496) */

export function seriesRule(row: EventRow): SeriesRule {
  return {
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    repeat: row.repeat as Repeat,
    repeatUntil: row.repeatUntil,
    repeatAnchor: row.repeatAnchor,
  };
}

/**
 * "이후 모두" 로 저장할 반복 기준 날짜 (D-71). 반복 주기가 그대로인 매월/매년/(#562) 매년(음력)이고 날짜를 바꾸지 않았으면 기준을 잇는다.
 * 첫 회차(원본 수정)는 원본 값 그대로, 그 뒤 회차(새 원본)는 원본 기준 또는 원본 시작 날짜. 날짜나 주기를 바꾸면 null (새 시작이 기준)
 */
export function followingAnchor(
  series: EventRow,
  repeat: Repeat | null,
  dateChanged: boolean,
  isFirst: boolean,
): string | null {
  if (
    repeat !== series.repeat ||
    dateChanged ||
    (repeat !== 'MONTHLY' && repeat !== 'YEARLY' && repeat !== 'YEARLY_LUNAR')
  )
    return null;
  return isFirst
    ? series.repeatAnchor
    : (series.repeatAnchor ?? kstDate(series.startsAt));
}

/** 회차의 현재 값 (예외 반영) */
export function occurrenceValues(
  row: EventRow,
  occurrence: Occurrence,
): EventValues {
  return {
    title: occurrence.title ?? row.title,
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
    allDay: occurrence.allDay,
    memo: occurrence.memo ?? row.memo,
    reminder: occurrence.reminder ?? row.reminder,
    // (#199) 이 회차만 지운 장소(CLEARED_PLACE)는 null
    place: occurrence.place
      ? toPlaceView(occurrence.place)
        ? occurrence.place
        : null
      : row.place,
  };
}

export const NOT_FOUND = () =>
  new ApiException('NOT_FOUND', '일정을 찾을 수 없어요');

/** 규칙상 회차 날짜가 아니거나 repeatUntil 뒤, 또는 취소된 회차면 NOT_FOUND */
export function resolveOccurrence(
  row: EventRow,
  exceptions: EventExceptionRow[],
  date: string,
): Occurrence {
  const rule = seriesRule(row);
  if (!isOccurrenceDate(rule, date)) throw NOT_FOUND();
  const occurrence = applyException(
    originalOccurrence(rule, date),
    exceptions.find((exception) => exception.occurrence === date),
  );
  if (!occurrence) throw NOT_FOUND();
  return occurrence;
}
