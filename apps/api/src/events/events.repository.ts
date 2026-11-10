import { Injectable } from '@nestjs/common';
import { toUserRowOrNull, USER_PUBLIC_SELECT, type UserPublicRecord, type UserRow } from '../common/member.js';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays, type ExceptionRule, type Repeat, seriesCandidateWindow, type SeriesRule } from './recurrence.js';

export const EVENT_SELECT = {
  id: true,
  groupId: true,
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
  creator: USER_PUBLIC_SELECT,
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
} as const;

export interface EventRow {
  id: number;
  groupId: number;
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
  creator: UserRow | null;
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
};

type EventRecord = Omit<EventRow, 'creator' | 'repeatUntil'> & { repeatUntil: Date | null; creator: UserPublicRecord | null };
type ExceptionRecord = Omit<EventExceptionRow, 'occurrence'> & { occurrence: Date };

/** `YYYY-MM-DD` ↔ `@db.Date`. 시각 없는 값이라 UTC 자정으로 고정해 날짜가 밀리지 않게 한다 (기념일과 같은 규칙) */
export function dateToDb(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function dbToDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toEventRow(record: EventRecord, urls: FileUrlBuilder): EventRow {
  return {
    ...record,
    repeatUntil: record.repeatUntil === null ? null : dbToDate(record.repeatUntil),
    creator: toUserRowOrNull(record.creator, urls),
  };
}

function toExceptionRow(record: ExceptionRecord): EventExceptionRow {
  return { ...record, occurrence: dbToDate(record.occurrence) };
}

/** 빈 시간 계산용. 일정 내용은 담지 않는다 (결정기록 D-14) */
export interface BusyRange {
  startsAt: Date;
  endsAt: Date;
}

/** 빈 시간 계산용 반복 원본. 시각과 반복 필드, 예외의 시각/취소만 (D-14, 설계 4-2) */
export interface BusySeries extends SeriesRule {
  exceptions: ExceptionRule[];
}

export interface EventCreateInput {
  groupId: number;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  memo: string | null;
  /** 등록자. "이후 모두" 로 나눈 새 원본은 원본 등록자 (탈퇴했으면 null, D-66) */
  creatorId: number | null;
  repeat?: Repeat | null;
  repeatUntil?: string | null;
}

export interface EventUpdateInput {
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  memo: string | null;
  /** 생략하면 바꾸지 않는다 */
  repeat?: Repeat | null;
  repeatUntil?: string | null;
}

/** 회차 예외로 저장할 값. null 은 원본 값 */
export interface ExceptionFields {
  title: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  allDay: boolean | null;
  memo: string | null;
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
}

type EventSnapshot = Pick<EventRow, 'id' | 'groupId' | 'title' | 'startsAt' | 'endsAt' | 'allDay'> & { repeat?: Repeat | null };
type SeriesRef = Pick<EventRow, 'id' | 'groupId'>;

function toEventData<T extends { repeatUntil?: string | null }>(data: T): Omit<T, 'repeatUntil'> & { repeatUntil?: Date | null } {
  const { repeatUntil, ...rest } = data;
  if (repeatUntil === undefined) return rest;
  return { ...rest, repeatUntil: repeatUntil === null ? null : dateToDb(repeatUntil) };
}

@Injectable()
export class EventsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
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
  listBusyRanges(groupIds: number[], from: Date, to: Date, includeAllDay: boolean): Promise<BusyRange[]> {
    return this.prisma.event.findMany({
      where: {
        groupId: { in: groupIds },
        repeat: null,
        startsAt: { lt: to },
        endsAt: { gt: from },
        ...(includeAllDay ? {} : { allDay: false }),
      },
      select: { startsAt: true, endsAt: true },
      orderBy: { startsAt: 'asc' },
    });
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
        exceptions: { select: { occurrence: true, cancelled: true, startsAt: true, endsAt: true, allDay: true } },
      },
    });
    return rows.map((row) => ({
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      allDay: row.allDay,
      repeat: row.repeat as Repeat,
      repeatUntil: row.repeatUntil === null ? null : dbToDate(row.repeatUntil),
      exceptions: row.exceptions.map((exception) => ({ ...exception, occurrence: dbToDate(exception.occurrence) })),
    }));
  }

  /** 일정 생성 + CREATED 로그를 한 트랜잭션으로 */
  createWithLogTx(data: EventCreateInput, actorId: number): Promise<EventRow> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.event.create({ data: toEventData(data), select: EVENT_SELECT });
      await tx.eventLog.create({ data: snapshotLog(created, actorId, 'CREATED') });
      return toEventRow(created, this.urls);
    });
  }

  /** 일정 수정 + UPDATED 로그를 한 트랜잭션으로 */
  updateWithLogTx(eventId: number, data: EventUpdateInput, actorId: number): Promise<EventRow> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({ where: { id: eventId }, data: toEventData(data), select: EVENT_SELECT });
      await tx.eventLog.create({ data: snapshotLog(updated, actorId, 'UPDATED') });
      return toEventRow(updated, this.urls);
    });
  }

  /** 삭제 전 스냅샷으로 DELETED 로그를 남기고 삭제. 로그의 eventId 는 FK SetNull 로 null 이 된다 */
  async deleteWithLogTx(event: EventSnapshot, actorId: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.eventLog.create({ data: snapshotLog(event, actorId, 'DELETED') });
      await tx.event.delete({ where: { id: event.id } });
    });
  }

  /** "이 일정만" 수정: 예외 upsert (fields 가 null 이면 원본과 같아져 예외 행 삭제) + UPDATED THIS 로그 */
  async saveExceptionWithLogTx(event: SeriesRef, occurrence: string, fields: ExceptionFields | null, log: ScopeLog, snapshot: LogSnapshot): Promise<void> {
    const where = { eventId_occurrence: { eventId: event.id, occurrence: dateToDb(occurrence) } };
    await this.prisma.$transaction(async (tx) => {
      if (fields) {
        await tx.eventException.upsert({ where, create: { eventId: event.id, occurrence: dateToDb(occurrence), ...fields }, update: { cancelled: false, ...fields } });
      } else {
        await tx.eventException.deleteMany({ where: { eventId: event.id, occurrence: dateToDb(occurrence) } });
      }
      await tx.eventLog.create({ data: scopeLog(event.groupId, event.id, 'UPDATED', log, snapshot) });
    });
  }

  /** "이 일정만" 삭제: 예외 upsert `cancelled = true` + DELETED THIS 로그 */
  async cancelOccurrenceWithLogTx(event: SeriesRef, occurrence: string, log: ScopeLog, snapshot: LogSnapshot): Promise<void> {
    const cleared = { cancelled: true, title: null, startsAt: null, endsAt: null, allDay: null, memo: null };
    await this.prisma.$transaction(async (tx) => {
      await tx.eventException.upsert({
        where: { eventId_occurrence: { eventId: event.id, occurrence: dateToDb(occurrence) } },
        create: { eventId: event.id, occurrence: dateToDb(occurrence), ...cleared },
        update: cleared,
      });
      await tx.eventLog.create({ data: scopeLog(event.groupId, event.id, 'DELETED', log, snapshot) });
    });
  }

  /** 첫 회차 "이후 모두" 수정: 원본의 예외 전부 삭제 (D-67) + 원본 수정 + UPDATED FOLLOWING 로그 (스냅샷은 수정된 첫 회차) */
  updateSeriesFromStartTx(eventId: number, data: EventUpdateInput, log: ScopeLog): Promise<EventRow> {
    return this.prisma.$transaction(async (tx) => {
      await tx.eventException.deleteMany({ where: { eventId } });
      const updated = await tx.event.update({ where: { id: eventId }, data: toEventData(data), select: EVENT_SELECT });
      await tx.eventLog.create({ data: scopeLog(updated.groupId, updated.id, 'UPDATED', log, updated) });
      return toEventRow(updated, this.urls);
    });
  }

  /** 첫 회차 "이후 모두" 삭제: DELETED FOLLOWING 로그 후 원본 삭제 (예외는 cascade, 로그 eventId 는 SetNull) */
  async deleteSeriesWithLogTx(event: SeriesRef, log: ScopeLog, snapshot: LogSnapshot): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.eventLog.create({ data: scopeLog(event.groupId, event.id, 'DELETED', log, snapshot) });
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
      await tx.event.update({ where: { id: event.id }, data: { repeatUntil: dateToDb(addDays(occurrence, -1)) } });
      await tx.eventException.deleteMany({ where: { eventId: event.id, occurrence: { gte: dateToDb(occurrence) } } });
      if (!next) {
        await tx.eventLog.create({ data: scopeLog(event.groupId, event.id, 'DELETED', log, snapshot as LogSnapshot) });
        return null;
      }
      const created = await tx.event.create({ data: toEventData(next), select: EVENT_SELECT });
      await tx.eventLog.create({ data: scopeLog(created.groupId, created.id, 'UPDATED', log, created) });
      return toEventRow(created, this.urls);
    });
  }
}

function snapshotLog(event: EventSnapshot, actorId: number, action: 'CREATED' | 'UPDATED' | 'DELETED') {
  return {
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
  };
}
