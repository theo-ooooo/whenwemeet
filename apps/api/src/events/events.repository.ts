import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { toUserRowOrNull, USER_PUBLIC_SELECT, type UserPublicRecord, type UserRow } from '../common/member.js';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import { generatePublicCode } from '../common/public-code.js';
import { Db, PrismaService } from '../prisma/prisma.service.js';
import { type CreatedLog, PushRepository } from '../push/push.repository.js';
import { type ParticipantSet, participantsFailed, PARTICIPANTS_NOT_MEMBER_MESSAGE, participantsSnapshot } from './participants.js';
import {
  deleteAllResponsesTx,
  deleteOccurrenceResponsesTx,
  moveOnceResponsesTx,
  moveResponsesFromTx,
  pruneRsvpsTx,
} from '../event-responses/event-responses.repository.js';
import { addDays, type EventReminderValue, type ExceptionRule, kstDate, type Repeat, seriesCandidateWindow, type SeriesRule } from './recurrence.js';

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
} as const;

/** (#248) 빈 시간 판정용 참여자 필드 (D-137) */
const BUSY_PARTICIPANTS_SELECT = { allMembers: true, participants: { select: { userId: true } } } as const;

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
};

type EventRecord = Omit<EventRow, 'creator' | 'repeatUntil' | 'repeatAnchor' | 'participantIds'> & {
  repeatUntil: Date | null;
  repeatAnchor: Date | null;
  creator: UserPublicRecord | null;
  participants: { userId: number }[];
};
type ExceptionRecord = Omit<EventExceptionRow, 'occurrence'> & { occurrence: Date };

/** `YYYY-MM-DD` ↔ `@db.Date`. 시각 없는 값이라 UTC 자정으로 고정해 날짜가 밀리지 않게 한다 (기념일과 같은 규칙) */
export function dateToDb(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function dbToDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toEventRow({ participants, ...record }: EventRecord, urls: FileUrlBuilder): EventRow {
  return {
    ...record,
    repeatUntil: record.repeatUntil === null ? null : dbToDate(record.repeatUntil),
    repeatAnchor: record.repeatAnchor === null ? null : dbToDate(record.repeatAnchor),
    creator: toUserRowOrNull(record.creator, urls),
    participantIds: participantIdsOf(participants),
  };
}

/** (#248) 참여자 행 → 오름차순 userId */
function participantIdsOf(rows: { userId: number }[]): number[] {
  return rows.map((row) => row.userId).sort((a, b) => a - b);
}

/** (#248) 읽은 일정 행의 참여자 */
function participantSetOf(record: { allMembers: boolean; participants: { userId: number }[] }): ParticipantSet {
  return { allMembers: record.allMembers, ids: record.allMembers ? [] : participantIdsOf(record.participants) };
}

function toExceptionRow(record: ExceptionRecord): EventExceptionRow {
  return { ...record, occurrence: dbToDate(record.occurrence) };
}

/** (#248) 빈 시간에서 그 일정이 누구를 바쁘게 하는지 (D-137) */
export interface BusyParticipants {
  allMembers: boolean;
  participantIds: number[];
}

/** 빈 시간 계산용. 일정 내용은 담지 않는다 (결정기록 D-14). 참여자로 거른다 (#248) */
export interface BusyRange extends BusyParticipants {
  startsAt: Date;
  endsAt: Date;
}

/** 빈 시간 계산용 반복 원본. 시각과 반복 필드, 예외의 시각/취소, 참여자만 (D-14, 설계 4-2, D-137) */
export interface BusySeries extends SeriesRule, BusyParticipants {
  exceptions: ExceptionRule[];
}

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

type EventSnapshot = Pick<EventRow, 'id' | 'groupId' | 'title' | 'startsAt' | 'endsAt' | 'allDay'> & { repeat?: Repeat | null };
type SavedEvent = EventSnapshot & { allMembers: boolean; participants: { userId: number }[] };
type SeriesRef = Pick<EventRow, 'id' | 'groupId'>;

/** KST 날짜 필드(repeatUntil, repeatAnchor) 를 @db.Date 값으로. 생략한 필드는 그대로 생략 */
function toEventData<T extends { repeatUntil?: string | null; repeatAnchor?: string | null }>(
  data: T,
): Omit<T, 'repeatUntil' | 'repeatAnchor'> & { repeatUntil?: Date | null; repeatAnchor?: Date | null } {
  const { repeatUntil, repeatAnchor, ...rest } = data;
  const toDb = (value: string | null) => (value === null ? null : dateToDb(value));
  return {
    ...rest,
    ...(repeatUntil === undefined ? {} : { repeatUntil: toDb(repeatUntil) }),
    ...(repeatAnchor === undefined ? {} : { repeatAnchor: toDb(repeatAnchor) }),
  };
}

/** (#248) 새 일정의 allMembers + 참여자 행. (#311) 공개 코드가 없으면 여기서 만든다 (새 원본, 가져오기 포함 모든 생성 경로) */
function toCreateData({ participants, publicCode, ...data }: EventCreateInput) {
  return {
    ...toEventData(data),
    publicCode: publicCode ?? generatePublicCode(),
    allMembers: participants.allMembers,
    participants: { create: participants.allMembers ? [] : participants.ids.map((userId) => ({ userId })) },
  };
}

/** (#248) 수정. 참여자를 주면 행을 지우고 다시 만든다 (설계 3-5) */
function toUpdateData({ participants, ...data }: EventUpdateInput) {
  if (!participants) return toEventData(data);
  return {
    ...toEventData(data),
    allMembers: participants.allMembers,
    participants: { deleteMany: {}, create: participants.allMembers ? [] : participants.ids.map((userId) => ({ userId })) },
  };
}

/**
 * (#248) 참여자가 모두 이 팀의 지금 멤버인지 쓰기 트랜잭션 안에서 확인한다 (D-133). 아니면 VALIDATION_FAILED.
 * 멤버십 행을 공유 잠금으로 읽어(FOR SHARE) 확인과 저장 사이에 그 사람이 나가 고아 행이 생기지 않게 한다.
 * 나가기는 멤버십을 먼저 지우고 참여자 행을 지우므로(removeWithGroupPrune), 나가기가 먼저면 여기서 걸리고 이쪽이 먼저면 나가기가 행을 지운다
 */
export async function assertParticipantsTx(tx: Db, groupId: number, participants: ParticipantSet | undefined): Promise<void> {
  if (!participants || participants.allMembers || participants.ids.length === 0) return;
  const rows = await tx.$queryRaw<{ userId: number }[]>`
    SELECT userId FROM Membership WHERE groupId = ${groupId} AND userId IN (${Prisma.join(participants.ids)}) FOR SHARE`;
  if (rows.length !== new Set(participants.ids).size) throw participantsFailed(PARTICIPANTS_NOT_MEMBER_MESSAGE);
}

@Injectable()
export class EventsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
    private readonly push: PushRepository,
  ) {}

  /** 한 번짜리 일정. 겹침 조건 `startsAt < to AND endsAt > from`, startsAt 오름차순 */
  async listInRange(groupId: number, from: Date, to: Date): Promise<EventRow[]> {
    const rows = await this.prisma.event.findMany({
      where: { groupId, repeat: null, startsAt: { lt: to }, endsAt: { gt: from } },
      orderBy: { startsAt: 'asc' },
      select: EVENT_SELECT,
    });
    return rows.map((row) => toEventRow(row, this.urls));
  }

  /** [from, to) 에 회차가 있을 수 있는 반복 원본 + 예외 (설계 4장, 창은 recurrence.seriesCandidateWindow) */
  async listSeriesForRange(groupId: number, from: Date, to: Date): Promise<SeriesRow[]> {
    const window = seriesCandidateWindow(from, to);
    const rows = await this.prisma.event.findMany({
      where: {
        groupId,
        repeat: { not: null },
        startsAt: { lt: window.startsBefore },
        OR: [{ repeatUntil: null }, { repeatUntil: { gte: dateToDb(window.untilOnOrAfter) } }],
      },
      orderBy: { id: 'asc' },
      select: { ...EVENT_SELECT, exceptions: { select: EVENT_EXCEPTION_SELECT } },
    });
    return rows.map(({ exceptions, ...row }) => ({
      ...toEventRow(row, this.urls),
      repeat: row.repeat as Repeat,
      exceptions: exceptions.map(toExceptionRow),
    }));
  }

  /** 다른 팀 자원을 가리키는 ID 는 null */
  async findInGroup(groupId: number, eventId: number): Promise<EventRow | null> {
    const row = await this.prisma.event.findFirst({ where: { id: eventId, groupId }, select: EVENT_SELECT });
    return row && toEventRow(row, this.urls);
  }

  /** (#311) 공개 코드로 찾는다 (팀 불문). 열 비교가 대소문자를 가리지 않으므로 호출자가 코드를 소문자로 맞춰 넘긴다 */
  async findByPublicCode(publicCode: string): Promise<EventRow | null> {
    const row = await this.prisma.event.findUnique({ where: { publicCode }, select: EVENT_SELECT });
    return row && toEventRow(row, this.urls);
  }

  /** 원본 하나의 예외 전부, 회차 날짜 오름차순 */
  async listExceptions(eventId: number): Promise<EventExceptionRow[]> {
    const rows = await this.prisma.eventException.findMany({
      where: { eventId },
      orderBy: { occurrence: 'asc' },
      select: EVENT_EXCEPTION_SELECT,
    });
    return rows.map(toExceptionRow);
  }

  /** 여러 팀의 한 번짜리 바쁜 구간만, startsAt 오름차순. includeAllDay 가 아니면 종일 일정 제외 */
  async listBusyRanges(groupIds: number[], from: Date, to: Date, includeAllDay: boolean): Promise<BusyRange[]> {
    const rows = await this.prisma.event.findMany({
      where: {
        groupId: { in: groupIds },
        repeat: null,
        startsAt: { lt: to },
        endsAt: { gt: from },
        ...(includeAllDay ? {} : { allDay: false }),
      },
      select: { startsAt: true, endsAt: true, ...BUSY_PARTICIPANTS_SELECT },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map(({ participants, ...row }) => ({ ...row, participantIds: participantIdsOf(participants) }));
  }

  /**
   * 여러 팀의 반복 원본 (설계 4-2). 시각과 반복 필드, 예외의 시각/취소만 읽는다 (title/memo 는 select 하지 않는다, D-14).
   * 예외가 종일 여부를 바꿀 수 있어 종일 제외는 펼친 뒤 호출자가 한다
   */
  async listBusySeries(groupIds: number[], from: Date, to: Date): Promise<BusySeries[]> {
    const window = seriesCandidateWindow(from, to);
    const rows = await this.prisma.event.findMany({
      where: {
        groupId: { in: groupIds },
        repeat: { not: null },
        startsAt: { lt: window.startsBefore },
        OR: [{ repeatUntil: null }, { repeatUntil: { gte: dateToDb(window.untilOnOrAfter) } }],
      },
      select: {
        startsAt: true,
        endsAt: true,
        allDay: true,
        repeat: true,
        repeatUntil: true,
        repeatAnchor: true,
        exceptions: { select: { occurrence: true, cancelled: true, startsAt: true, endsAt: true, allDay: true } },
        ...BUSY_PARTICIPANTS_SELECT,
      },
    });
    return rows.map((row) => ({
      allMembers: row.allMembers,
      participantIds: participantIdsOf(row.participants),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      allDay: row.allDay,
      repeat: row.repeat as Repeat,
      repeatUntil: row.repeatUntil === null ? null : dbToDate(row.repeatUntil),
      repeatAnchor: row.repeatAnchor === null ? null : dbToDate(row.repeatAnchor),
      exceptions: row.exceptions.map((exception) => ({ ...exception, occurrence: dbToDate(exception.occurrence) })),
    }));
  }

  /** 일정 생성 + CREATED 로그를 한 트랜잭션으로 */
  createWithLogTx(data: EventCreateInput, actorId: number): Promise<EventRow> {
    return this.prisma.$transaction(async (tx) => {
      const { row, log } = await this.insertWithLogTx(tx, data, actorId);
      await this.push.recordChangeTx(tx, log, false, new Date());
      return row;
    });
  }

  /**
   * (#189) 호출자의 트랜잭션 안에서 일정 생성 + CREATED 로그 (참여자 검사 포함). 팀원 변경 알림은 만들지 않는다.
   * 약속 투표 정하기가 쓴다 (알림은 투표 문구 1건, D-236)
   */
  async createWithLogInTx(tx: Db, data: EventCreateInput, actorId: number): Promise<{ row: EventRow; logId: number }> {
    const { row, log } = await this.insertWithLogTx(tx, data, actorId);
    return { row, logId: log.id };
  }

  private async insertWithLogTx(tx: Db, data: EventCreateInput, actorId: number): Promise<{ row: EventRow; log: CreatedLog }> {
    await assertParticipantsTx(tx, data.groupId, data.participants);
    const created = await tx.event.create({ data: toCreateData(data), select: EVENT_SELECT });
    const log = await tx.eventLog.create({ data: snapshotLog(created, actorId, 'CREATED'), select: LOG_REF_SELECT });
    return { row: toEventRow(created, this.urls), log };
  }

  /** 일정 수정 + UPDATED 로그를 한 트랜잭션으로. 참여자를 바꾸면 그 팀 멤버인지 같이 확인한다 (#248) */
  updateWithLogTx(event: SeriesRef, data: EventUpdateInput, actorId: number): Promise<EventRow> {
    return this.prisma.$transaction(async (tx) => {
      await assertParticipantsTx(tx, event.groupId, data.participants);
      const updated = await tx.event.update({ where: { id: event.id }, data: toUpdateData(data), select: EVENT_SELECT });
      // (#190) 빠진 참여자의 응답 삭제, 한 번짜리의 회차 날짜(= 시작 날짜)를 따라 옮긴다 (반복을 켜도 첫 회차 날짜가 같다)
      if (data.participants) await pruneRsvpsTx(tx, event.id, data.participants);
      await moveOnceResponsesTx(tx, event.id, kstDate(updated.startsAt));
      const log = await tx.eventLog.create({ data: snapshotLog(updated, actorId, 'UPDATED'), select: LOG_REF_SELECT });
      await this.push.recordChangeTx(tx, log, false, new Date());
      return toEventRow(updated, this.urls);
    });
  }

  /**
   * (#343) 색만 바꾼다. 로그, 새 소식, 푸시를 만들지 않는다 (D-215). 반복 원본이면 모든 회차의 색이 바뀐다 (예외는 그대로)
   */
  async updateColor(eventId: number, color: string | null): Promise<EventRow> {
    const updated = await this.prisma.event.update({ where: { id: eventId }, data: { color }, select: EVENT_SELECT });
    return toEventRow(updated, this.urls);
  }

  /**
   * (#343) 그 뒤 회차 "이후 모두" 에서 색만 바꿨을 때: splitSeriesTx 와 같이 나누되 로그, 새 소식, 푸시를 만들지 않는다 (D-215).
   * 호출자는 그 회차부터 예외가 없을 때만 부른다 (나눠도 펼친 일정은 색 말고 같다)
   */
  splitSeriesQuietTx(event: SeriesRef, occurrence: string, next: EventCreateInput): Promise<EventRow> {
    return this.prisma.$transaction(async (tx) => {
      await assertParticipantsTx(tx, next.groupId, next.participants);
      await tx.event.update({ where: { id: event.id }, data: { repeatUntil: dateToDb(addDays(occurrence, -1)) } });
      await tx.eventException.deleteMany({ where: { eventId: event.id, occurrence: { gte: dateToDb(occurrence) } } });
      const created = await tx.event.create({ data: toCreateData(next), select: EVENT_SELECT });
      // (#190) 색만 바꾼 나눔은 회차 날짜가 같아 응답을 새 원본으로 옮긴다 (D-225)
      await moveResponsesFromTx(tx, event.id, occurrence, created.id);
      return toEventRow(created, this.urls);
    });
  }

  /** 삭제 전 스냅샷으로 DELETED 로그를 남기고 삭제. 로그의 eventId 는 FK SetNull 로 null 이 된다 */
  async deleteWithLogTx(event: EventSnapshot, actorId: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const log = await tx.eventLog.create({ data: snapshotLog(event, actorId, 'DELETED'), select: LOG_REF_SELECT });
      await this.push.recordChangeTx(tx, log, true, new Date());
      await tx.event.delete({ where: { id: event.id } });
    });
  }

  /**
   * "이 일정만" 수정: 예외 upsert (fields 가 null 이면 원본과 같아져 예외 행 삭제) + UPDATED THIS 로그.
   * reminderSetAt 은 그 회차의 시각, 종일, 알림이 바뀌었을 때만 (#188, D-86). null 이면 그대로 둔다
   */
  async saveExceptionWithLogTx(
    event: SeriesRef,
    occurrence: string,
    fields: ExceptionFields | null,
    log: ScopeLog,
    snapshot: LogSnapshot,
    reminderSetAt: Date | null = null,
  ): Promise<void> {
    const where = { eventId_occurrence: { eventId: event.id, occurrence: dateToDb(occurrence) } };
    const setAt = reminderSetAt ? { reminderSetAt } : {};
    await this.prisma.$transaction(async (tx) => {
      if (fields) {
        await tx.eventException.upsert({
          where,
          create: { eventId: event.id, occurrence: dateToDb(occurrence), ...fields, ...setAt },
          update: { cancelled: false, ...fields, ...setAt },
        });
      } else {
        await tx.eventException.deleteMany({ where: { eventId: event.id, occurrence: dateToDb(occurrence) } });
      }
      const created = await tx.eventLog.create({ data: scopeLog(event.groupId, event.id, 'UPDATED', log, snapshot), select: LOG_REF_SELECT });
      await this.push.recordChangeTx(tx, created, false, new Date());
    });
  }

  /** "이 일정만" 삭제: 예외 upsert `cancelled = true` + DELETED THIS 로그 */
  async cancelOccurrenceWithLogTx(event: SeriesRef, occurrence: string, log: ScopeLog, snapshot: LogSnapshot): Promise<void> {
    const cleared = { cancelled: true, title: null, startsAt: null, endsAt: null, allDay: null, memo: null, reminder: null, reminderSetAt: null };
    await this.prisma.$transaction(async (tx) => {
      await tx.eventException.upsert({
        where: { eventId_occurrence: { eventId: event.id, occurrence: dateToDb(occurrence) } },
        create: { eventId: event.id, occurrence: dateToDb(occurrence), ...cleared },
        update: cleared,
      });
      // (#190) 없어진 회차의 응답, 반응도 지운다
      await deleteOccurrenceResponsesTx(tx, event.id, occurrence);
      const created = await tx.eventLog.create({ data: scopeLog(event.groupId, event.id, 'DELETED', log, snapshot), select: LOG_REF_SELECT });
      await this.push.recordChangeTx(tx, created, false, new Date());
    });
  }

  /** 첫 회차 "이후 모두" 수정: 원본의 예외 전부 삭제 (D-67) + 원본 수정 + UPDATED FOLLOWING 로그 (스냅샷은 수정된 첫 회차) */
  updateSeriesFromStartTx(event: SeriesRef, data: EventUpdateInput, log: ScopeLog): Promise<EventRow> {
    return this.prisma.$transaction(async (tx) => {
      await assertParticipantsTx(tx, event.groupId, data.participants);
      const before = await tx.event.findUniqueOrThrow({ where: { id: event.id }, select: RULE_SELECT });
      await tx.eventException.deleteMany({ where: { eventId: event.id } });
      const updated = await tx.event.update({ where: { id: event.id }, data: toUpdateData(data), select: EVENT_SELECT });
      // (#190) 회차 날짜가 바뀌면(시작 날짜, 주기, 기준 날짜) 맞는 회차가 없어 응답을 지운다. 같으면 남기고 종료일 뒤 것만 정리 (D-225)
      if (!sameOccurrenceDates(before, updated)) await deleteAllResponsesTx(tx, event.id);
      else if (updated.repeatUntil) await moveResponsesFromTx(tx, event.id, addDays(dbToDate(updated.repeatUntil), 1), null);
      if (data.participants) await pruneRsvpsTx(tx, event.id, data.participants);
      const snapshot = { ...updated, participants: participantSetOf(updated) };
      const created = await tx.eventLog.create({ data: scopeLog(updated.groupId, updated.id, 'UPDATED', log, snapshot), select: LOG_REF_SELECT });
      await this.push.recordChangeTx(tx, created, false, new Date());
      return toEventRow(updated, this.urls);
    });
  }

  /** 첫 회차 "이후 모두" 삭제: DELETED FOLLOWING 로그 후 원본 삭제 (예외는 cascade, 로그 eventId 는 SetNull) */
  async deleteSeriesWithLogTx(event: SeriesRef, log: ScopeLog, snapshot: LogSnapshot): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.eventLog.create({ data: scopeLog(event.groupId, event.id, 'DELETED', log, snapshot), select: LOG_REF_SELECT });
      await this.push.recordChangeTx(tx, created, true, new Date());
      await tx.event.delete({ where: { id: event.id } });
    });
  }

  /**
   * 그 뒤 회차 "이후 모두" (D-66, D-67): 원본 `repeatUntil = occurrence - 1일`, occurrence 이후(그날 포함) 예외 삭제.
   * next 가 있으면 새 원본을 만들고 UPDATED FOLLOWING 로그(eventId = 새 원본, 스냅샷 = 새 원본 첫 회차) 를 남겨 새 원본을 돌려준다.
   * next 가 없으면 삭제로 보고 DELETED FOLLOWING 로그(eventId = 원본, 스냅샷 = 그 회차) 만 남긴다
   */
  splitSeriesTx(event: SeriesRef, occurrence: string, log: ScopeLog, next: EventCreateInput): Promise<EventRow>;
  splitSeriesTx(event: SeriesRef, occurrence: string, log: ScopeLog, next: null, snapshot: LogSnapshot): Promise<null>;
  splitSeriesTx(event: SeriesRef, occurrence: string, log: ScopeLog, next: EventCreateInput | null, snapshot?: LogSnapshot): Promise<EventRow | null> {
    return this.prisma.$transaction(async (tx) => {
      if (next) await assertParticipantsTx(tx, next.groupId, next.participants);
      const before = await tx.event.findUniqueOrThrow({ where: { id: event.id }, select: RULE_SELECT });
      await tx.event.update({ where: { id: event.id }, data: { repeatUntil: dateToDb(addDays(occurrence, -1)) } });
      await tx.eventException.deleteMany({ where: { eventId: event.id, occurrence: { gte: dateToDb(occurrence) } } });
      if (!next) {
        // (#190) 지운 회차들의 응답, 반응도 지운다
        await moveResponsesFromTx(tx, event.id, occurrence, null);
        const deleted = await tx.eventLog.create({ data: scopeLog(event.groupId, event.id, 'DELETED', log, snapshot as LogSnapshot), select: LOG_REF_SELECT });
        await this.push.recordChangeTx(tx, deleted, false, new Date());
        return null;
      }
      const created = await tx.event.create({ data: toCreateData(next), select: EVENT_SELECT });
      // (#190) 나눈 회차 이후 응답은 새 원본으로 옮긴다. 시작 날짜나 주기가 바뀌어 회차 날짜가 달라지면 지운다 (D-225)
      const keepsDates = kstDate(created.startsAt) === occurrence && created.repeat === before.repeat;
      await moveResponsesFromTx(tx, event.id, occurrence, keepsDates ? created.id : null);
      if (keepsDates) await pruneRsvpsTx(tx, created.id, participantSetOf(created));
      const firstSnapshot = { ...created, participants: participantSetOf(created) };
      const updated = await tx.eventLog.create({ data: scopeLog(created.groupId, created.id, 'UPDATED', log, firstSnapshot), select: LOG_REF_SELECT });
      await this.push.recordChangeTx(tx, updated, false, new Date());
      return toEventRow(created, this.urls);
    });
  }
}

/** (#190) 회차 날짜를 정하는 원본 값 */
const RULE_SELECT = { startsAt: true, repeat: true, repeatAnchor: true } as const;

/** (#190) 두 원본 값이 같은 회차 날짜를 만드는지 (시작 KST 날짜, 주기, 기준 날짜) */
function sameOccurrenceDates(
  a: { startsAt: Date; repeat: Repeat | null; repeatAnchor: Date | null },
  b: { startsAt: Date; repeat: Repeat | null; repeatAnchor: Date | null },
): boolean {
  const anchor = (value: Date | null) => (value === null ? null : dbToDate(value));
  return kstDate(a.startsAt) === kstDate(b.startsAt) && a.repeat === b.repeat && anchor(a.repeatAnchor) === anchor(b.repeatAnchor);
}

/** (#188) 팀원 변경 묶기에 넘기는 로그 필드 */
const LOG_REF_SELECT = { id: true, groupId: true, eventId: true, actorId: true, action: true } as const satisfies Record<keyof CreatedLog, true>;

/** (#248) 로그의 참여자 스냅샷 컬럼 (D-136). "모두" 면 participantIds 는 넣지 않는다(DB null) */
function logParticipants(set: ParticipantSet): { participantsAll: boolean; participantIds?: number[] } {
  const { participantsAll, participantIds } = participantsSnapshot(set);
  return participantIds === null ? { participantsAll } : { participantsAll, participantIds };
}

/** 로그 스냅샷. CREATED, UPDATED 는 저장 후 참여자를 함께 (D-136), DELETED 는 참여자 null */
function snapshotLog(event: EventSnapshot | SavedEvent, actorId: number, action: 'CREATED' | 'UPDATED' | 'DELETED') {
  return {
    ...(action !== 'DELETED' && 'participants' in event ? logParticipants(participantSetOf(event)) : {}),
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

function scopeLog(groupId: number, eventId: number, action: 'UPDATED' | 'DELETED', log: ScopeLog, snapshot: LogSnapshot) {
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
    ...(action === 'UPDATED' && snapshot.participants ? logParticipants(snapshot.participants) : {}),
  };
}
