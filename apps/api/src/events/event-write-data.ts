import { Prisma } from '../generated/prisma/client.js';
import { generatePublicCode } from '../common/public-code.js';
import type { Db } from '../prisma/prisma.service.js';
import type { CreatedLog } from '../push/push-notifications.repository.js';
import {
  type ParticipantSet,
  participantsFailed,
  PARTICIPANTS_NOT_MEMBER_MESSAGE,
  participantsSnapshot,
} from './participants.js';
import { placeColumns, type PlaceValue } from './place.js';
import { type EventReminderValue, kstDate, type Repeat } from './recurrence.js';
import {
  dateToDb,
  dbToDate,
  type EventRow,
  participantSetOf,
} from './event-rows.js';

/** 일정 쓰기 입력, 저장 데이터 만들기, 참여자 검사, 로그 스냅샷. 일정 쓰기 저장소들이 같이 쓴다. events.repository 에서 옮김 (#504) */

export interface EventCreateInput {
  groupId: number;
  /** (#311) 공개 코드. 생략하면 저장할 때 만든다 */
  publicCode?: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  memo: string | null;
  /** 등록자. "이후 모두" 로 나눈 새 원본은 원본 등록자 (탈퇴했으면 null, D-66) */
  creatorId: number | null;
  repeat?: Repeat | null;
  repeatUntil?: string | null;
  /** (#228) 반복 기준 날짜. 생략하면 null (D-71) */
  repeatAnchor?: string | null;
  /** (#188) 알림. 생략하면 NONE */
  reminder?: EventReminderValue;
  /** (#188) 한 번짜리 일정의 알림 시각 (D-85) */
  remindAt?: Date | null;
  /** (#188) 생략하면 지금 (D-86) */
  reminderSetAt?: Date;
  /** (#248) 참여자. 멤버 검사는 저장 트랜잭션 안에서 (D-133) */
  participants: ParticipantSet;
  /** (#343) 일정 색. 생략하면 null(자동). 가져오기(ICS)는 늘 생략 (D-215) */
  color?: string | null;
  /** (#566) 음력으로 넣은 일정. 생략하면 false (D-298) */
  lunarInput?: boolean;
  /** (#199) 장소. 생략하면 없음 */
  place?: PlaceValue | null;
}

export interface EventUpdateInput {
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  memo: string | null;
  /** (#188) 알림 */
  reminder: EventReminderValue;
  /** 생략하면 바꾸지 않는다 */
  repeat?: Repeat | null;
  repeatUntil?: string | null;
  repeatAnchor?: string | null;
  /** (#188) 생략하면 바꾸지 않는다 */
  remindAt?: Date | null;
  reminderSetAt?: Date;
  /** (#248) 생략하면 바꾸지 않는다. 주면 행을 모두 바꾸고 멤버를 검사한다 */
  participants?: ParticipantSet;
  /** (#343) 생략하면 바꾸지 않는다 */
  color?: string | null;
  /** (#566) 생략하면 바꾸지 않는다 */
  lunarInput?: boolean;
  /** (#199) 장소. null 이면 없음 */
  place: PlaceValue | null;
}

/** 회차 예외로 저장할 값. null 은 원본 값 */
export interface ExceptionFields {
  title: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  allDay: boolean | null;
  memo: string | null;
  /** (#188) 원본 알림과 다를 때만 값 */
  reminder: EventReminderValue | null;
  /** (#199) 원본 장소와 다를 때만 값. 이 회차만 지우면 CLEARED_PLACE (text '') */
  place: PlaceValue | null;
}

/** 반복 일정에서 범위를 고른 변경의 로그 정보 */
export interface ScopeLog {
  actorId: number;
  scope: 'THIS' | 'FOLLOWING';
  /** 범위를 고른 회차 날짜 (KST) */
  occurrence: string;
}

/** 로그 스냅샷. 반복 일정은 그 회차 값 (설계 4-3) */
export interface LogSnapshot {
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  repeat: Repeat | null;
  /** (#248) 참여자 스냅샷 (D-136). "이 일정만" 수정은 원본 참여자, 삭제는 생략(null) */
  participants?: ParticipantSet;
}

export type EventSnapshot = Pick<
  EventRow,
  'id' | 'groupId' | 'title' | 'startsAt' | 'endsAt' | 'allDay'
> & { repeat?: Repeat | null };
type SavedEvent = EventSnapshot & {
  allMembers: boolean;
  participants: { userId: number }[];
};
export type SeriesRef = Pick<EventRow, 'id' | 'groupId'>;

/** KST 날짜 필드(repeatUntil, repeatAnchor) 를 @db.Date 값으로. 생략한 필드는 그대로 생략 */
function toEventData<
  T extends { repeatUntil?: string | null; repeatAnchor?: string | null },
>(
  data: T,
): Omit<T, 'repeatUntil' | 'repeatAnchor'> & {
  repeatUntil?: Date | null;
  repeatAnchor?: Date | null;
} {
  const { repeatUntil, repeatAnchor, ...rest } = data;
  const toDb = (value: string | null) =>
    value === null ? null : dateToDb(value);
  return {
    ...rest,
    ...(repeatUntil === undefined ? {} : { repeatUntil: toDb(repeatUntil) }),
    ...(repeatAnchor === undefined ? {} : { repeatAnchor: toDb(repeatAnchor) }),
  };
}

/** (#248) 새 일정의 allMembers + 참여자 행. (#311) 공개 코드가 없으면 여기서 만든다 (새 원본, 가져오기 포함 모든 생성 경로) */
export function toCreateData({
  participants,
  publicCode,
  place,
  ...data
}: EventCreateInput) {
  return {
    ...toEventData(data),
    ...placeColumns(place ?? null),
    publicCode: publicCode ?? generatePublicCode(),
    allMembers: participants.allMembers,
    participants: {
      create: participants.allMembers
        ? []
        : participants.ids.map((userId) => ({ userId })),
    },
  };
}

/** (#248) 수정. 참여자를 주면 행을 지우고 다시 만든다 (설계 3-5) */
export function toUpdateData({
  participants,
  place,
  ...data
}: EventUpdateInput) {
  if (!participants) return { ...toEventData(data), ...placeColumns(place) };
  return {
    ...toEventData(data),
    ...placeColumns(place),
    allMembers: participants.allMembers,
    participants: {
      deleteMany: {},
      create: participants.allMembers
        ? []
        : participants.ids.map((userId) => ({ userId })),
    },
  };
}

/**
 * (#248) 참여자가 모두 이 팀의 지금 멤버인지 쓰기 트랜잭션 안에서 확인한다 (D-133). 아니면 VALIDATION_FAILED.
 * 멤버십 행을 공유 잠금으로 읽어(FOR SHARE) 확인과 저장 사이에 그 사람이 나가 고아 행이 생기지 않게 한다.
 * 나가기는 멤버십을 먼저 지우고 참여자 행을 지우므로(removeWithGroupPrune), 나가기가 먼저면 여기서 걸리고 이쪽이 먼저면 나가기가 행을 지운다
 */
export async function assertParticipantsTx(
  tx: Db,
  groupId: number,
  participants: ParticipantSet | undefined,
): Promise<void> {
  if (!participants || participants.allMembers || participants.ids.length === 0)
    return;
  const rows = await tx.$queryRaw<{ userId: number }[]>`
    SELECT userId FROM Membership WHERE groupId = ${groupId} AND userId IN (${Prisma.join(participants.ids)}) FOR SHARE`;
  if (rows.length !== new Set(participants.ids).size)
    throw participantsFailed(PARTICIPANTS_NOT_MEMBER_MESSAGE);
}

/** (#190) 회차 날짜를 정하는 원본 값 */
export const RULE_SELECT = {
  startsAt: true,
  repeat: true,
  repeatAnchor: true,
} as const;

/** (#190) 두 원본 값이 같은 회차 날짜를 만드는지 (시작 KST 날짜, 주기, 기준 날짜) */
export function sameOccurrenceDates(
  a: { startsAt: Date; repeat: Repeat | null; repeatAnchor: Date | null },
  b: { startsAt: Date; repeat: Repeat | null; repeatAnchor: Date | null },
): boolean {
  const anchor = (value: Date | null) =>
    value === null ? null : dbToDate(value);
  return (
    kstDate(a.startsAt) === kstDate(b.startsAt) &&
    a.repeat === b.repeat &&
    anchor(a.repeatAnchor) === anchor(b.repeatAnchor)
  );
}

/** (#188) 팀원 변경 묶기에 넘기는 로그 필드 */
export const LOG_REF_SELECT = {
  id: true,
  groupId: true,
  eventId: true,
  actorId: true,
  action: true,
} as const satisfies Record<keyof CreatedLog, true>;

/** (#248) 로그의 참여자 스냅샷 컬럼 (D-136). "모두" 면 participantIds 는 넣지 않는다(DB null) */
function logParticipants(set: ParticipantSet): {
  participantsAll: boolean;
  participantIds?: number[];
} {
  const { participantsAll, participantIds } = participantsSnapshot(set);
  return participantIds === null
    ? { participantsAll }
    : { participantsAll, participantIds };
}

/** 로그 스냅샷. CREATED, UPDATED 는 저장 후 참여자를 함께 (D-136), DELETED 는 참여자 null */
export function snapshotLog(
  event: EventSnapshot | SavedEvent,
  actorId: number,
  action: 'CREATED' | 'UPDATED' | 'DELETED',
) {
  return {
    ...(action !== 'DELETED' && 'participants' in event
      ? logParticipants(participantSetOf(event))
      : {}),
    groupId: event.groupId,
    eventId: event.id,
    actorId,
    action,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    repeat: event.repeat ?? null,
  };
}

export function scopeLog(
  groupId: number,
  eventId: number,
  action: 'UPDATED' | 'DELETED',
  log: ScopeLog,
  snapshot: LogSnapshot,
) {
  return {
    groupId,
    eventId,
    actorId: log.actorId,
    action,
    title: snapshot.title,
    startsAt: snapshot.startsAt,
    endsAt: snapshot.endsAt,
    allDay: snapshot.allDay,
    repeat: snapshot.repeat,
    scope: log.scope,
    occurrence: dateToDb(log.occurrence),
    ...(action === 'UPDATED' && snapshot.participants
      ? logParticipants(snapshot.participants)
      : {}),
  };
}
