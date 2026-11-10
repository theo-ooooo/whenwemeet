import { Injectable } from '@nestjs/common';
import { toUserRowOrNull, USER_PUBLIC_SELECT, type UserPublicRecord, type UserRow } from '../common/member.js';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
  creator: USER_PUBLIC_SELECT,
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
  creator: UserRow | null;
}

type EventRecord = Omit<EventRow, 'creator'> & { creator: UserPublicRecord | null };

function toEventRow(record: EventRecord, urls: FileUrlBuilder): EventRow {
  return { ...record, creator: toUserRowOrNull(record.creator, urls) };
}

/** 빈 시간 계산용. 일정 내용은 담지 않는다 (결정기록 D-14) */
export interface BusyRange {
  startsAt: Date;
  endsAt: Date;
}

export interface EventCreateInput {
  groupId: number;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  memo: string | null;
  creatorId: number;
}

export interface EventUpdateInput {
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  memo: string | null;
}

type EventSnapshot = Pick<EventRow, 'id' | 'groupId' | 'title' | 'startsAt' | 'endsAt' | 'allDay'>;

@Injectable()
export class EventsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
  ) {}

  /** 겹침 조건 `startsAt < to AND endsAt > from`, startsAt 오름차순 */
  async listInRange(groupId: number, from: Date, to: Date): Promise<EventRow[]> {
    const rows = await this.prisma.event.findMany({
      where: { groupId, startsAt: { lt: to }, endsAt: { gt: from } },
      orderBy: { startsAt: 'asc' },
      select: EVENT_SELECT,
    });
    return rows.map((row) => toEventRow(row, this.urls));
  }

  /** 다른 팀 자원을 가리키는 ID 는 null */
  async findInGroup(groupId: number, eventId: number): Promise<EventRow | null> {
    const row = await this.prisma.event.findFirst({ where: { id: eventId, groupId }, select: EVENT_SELECT });
    return row && toEventRow(row, this.urls);
  }

  /** 여러 팀의 바쁜 구간만, startsAt 오름차순. includeAllDay 가 아니면 종일 일정 제외 */
  listBusyRanges(groupIds: number[], from: Date, to: Date, includeAllDay: boolean): Promise<BusyRange[]> {
    return this.prisma.event.findMany({
      where: {
        groupId: { in: groupIds },
        startsAt: { lt: to },
        endsAt: { gt: from },
        ...(includeAllDay ? {} : { allDay: false }),
      },
      select: { startsAt: true, endsAt: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  /** 일정 생성 + CREATED 로그를 한 트랜잭션으로 */
  createWithLogTx(data: EventCreateInput, actorId: number): Promise<EventRow> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.event.create({ data, select: EVENT_SELECT });
      await tx.eventLog.create({ data: snapshotLog(created, actorId, 'CREATED') });
      return toEventRow(created, this.urls);
    });
  }

  /** 일정 수정 + UPDATED 로그를 한 트랜잭션으로 */
  updateWithLogTx(eventId: number, data: EventUpdateInput, actorId: number): Promise<EventRow> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({ where: { id: eventId }, data, select: EVENT_SELECT });
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
  };
}
