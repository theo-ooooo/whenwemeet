import { toUserRowOrNull, USER_PUBLIC_SELECT, type UserPublicRecord, type UserRow } from '../common/member.js';
import type { FileUrlBuilder } from '../files/file-url.builder.js';
import type { ParticipantSet } from './participants.js';
import { exceptionPlaceFromColumns, PLACE_SELECT, type PlaceColumns, placeFromColumns, type PlaceValue } from './place.js';
import type { EventReminderValue, ExceptionRule, Repeat } from './recurrence.js';

/** 일정 행 모양과 DB 값 변환. 일정 저장소들이 같이 쓴다. events.repository 에서 옮김 (#504) */

export const EVENT_SELECT = {
  id: true,
  groupId: true,
  publicCode: true,
  title: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  memo: true,
  creatorId: true,
  createdAt: true,
  updatedAt: true,
  repeat: true,
  repeatUntil: true,
  repeatAnchor: true,
  reminder: true,
  reminderSetAt: true,
  creator: USER_PUBLIC_SELECT,
  /** (#248) 참여자 (D-130). 행은 PK (eventId, userId) 로 읽는다 */
  allMembers: true,
  participants: { select: { userId: true }, orderBy: { userId: 'asc' } },
  /** (#343) 일정 색. null 이면 자동 (D-215) */
  color: true,
  /** (#566) 음력으로 넣은 일정 (D-298) */
  lunarInput: true,
  /** (#199) 장소 열 세 개: 카카오 ID, 고를 때 검색어, 직접 적은 글자 (D-242) */
  ...PLACE_SELECT,
} as const;

/** 회차 예외 (D-65). 바꾼 필드만 값이 있다 */
export const EVENT_EXCEPTION_SELECT = {
  occurrence: true,
  cancelled: true,
  title: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  memo: true,
  reminder: true,
  reminderSetAt: true,
  /** (#199) 이 회차의 장소. 셋 다 null 이면 원본 값 */
  ...PLACE_SELECT,
} as const;

export interface EventRow {
  id: number;
  groupId: number;
  /** (#311) 주소용 공개 코드 (`/events/<코드>`) */
  publicCode: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  memo: string | null;
  creatorId: number | null;
  createdAt: Date;
  updatedAt: Date;
  /** (#187) null 이면 한 번짜리 */
  repeat: Repeat | null;
  /** (#187) KST 날짜 'YYYY-MM-DD' */
  repeatUntil: string | null;
  /** (#228) 반복 기준 날짜 'YYYY-MM-DD' (KST). null 이면 startsAt 의 KST 날짜 (D-71) */
  repeatAnchor: string | null;
  /** (#188) 알림 (D-84) */
  reminder: EventReminderValue;
  /** (#188) 알림 시각을 정하는 값을 마지막으로 바꾼 시각 (D-86) */
  reminderSetAt: Date;
  creator: UserRow | null;
  /** (#248) true 면 "모두" (D-130) */
  allMembers: boolean;
  /** (#248) allMembers = false 일 때의 참여자 userId, 오름차순. 비면 "참여자 없음" */
  participantIds: number[];
  /** (#343) 일정 색 (팔레트 키). null 이면 자동 = 참여자 색 (D-215) */
  color: string | null;
  /** (#566) 날짜를 음력으로 골라 넣었는지 (D-298). 저장은 양력, 보일 때 음력을 같이 */
  lunarInput: boolean;
  /** (#199) 장소. null 이면 없음 (D-242) */
  place: PlaceValue | null;
}

/** 반복 원본 + 예외 (일정 목록 펼치기용) */
export interface SeriesRow extends EventRow {
  repeat: Repeat;
  exceptions: EventExceptionRow[];
}

export type EventExceptionRow = ExceptionRule & {
  title: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  allDay: boolean | null;
  memo: string | null;
  reminder: EventReminderValue | null;
  reminderSetAt: Date | null;
  /** (#199) null 이면 원본 장소, CLEARED_PLACE(text '') 면 이 회차만 장소 없음 */
  place: PlaceValue | null;
};

type EventRecord = Omit<EventRow, 'creator' | 'repeatUntil' | 'repeatAnchor' | 'participantIds' | 'place'> &
  PlaceColumns & {
    repeatUntil: Date | null;
    repeatAnchor: Date | null;
    creator: UserPublicRecord | null;
    participants: { userId: number }[];
  };
type ExceptionRecord = Omit<EventExceptionRow, 'occurrence' | 'place'> & PlaceColumns & { occurrence: Date };

/** `YYYY-MM-DD` ↔ `@db.Date`. 시각 없는 값이라 UTC 자정으로 고정해 날짜가 밀리지 않게 한다 (기념일과 같은 규칙) */
export function dateToDb(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function dbToDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function toEventRow({ participants, placeId, placeProvider, placeQuery, placeText, ...record }: EventRecord, urls: FileUrlBuilder): EventRow {
  return {
    ...record,
    place: placeFromColumns({ placeId, placeProvider, placeQuery, placeText }),
    repeatUntil: record.repeatUntil === null ? null : dbToDate(record.repeatUntil),
    repeatAnchor: record.repeatAnchor === null ? null : dbToDate(record.repeatAnchor),
    creator: toUserRowOrNull(record.creator, urls),
    participantIds: participantIdsOf(participants),
  };
}

/** (#248) 참여자 행 → 오름차순 userId */
export function participantIdsOf(rows: { userId: number }[]): number[] {
  return rows.map((row) => row.userId).sort((a, b) => a - b);
}

/** (#248) 읽은 일정 행의 참여자 */
export function participantSetOf(record: { allMembers: boolean; participants: { userId: number }[] }): ParticipantSet {
  return { allMembers: record.allMembers, ids: record.allMembers ? [] : participantIdsOf(record.participants) };
}

export function toExceptionRow({ placeId, placeProvider, placeQuery, placeText, ...record }: ExceptionRecord): EventExceptionRow {
  return {
    ...record,
    occurrence: dbToDate(record.occurrence),
    place: exceptionPlaceFromColumns({ placeId, placeProvider, placeQuery, placeText }),
  };
}
