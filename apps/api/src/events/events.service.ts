import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { Member, MemberResolver } from '../common/member.js';
import { parseIsoDate } from '../common/validation.js';
import { Db, MembershipService } from '../groups/membership.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { EventInputDto, EventPatchDto } from './dto/event.dto.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 일정 길이 상한 (결정기록 D-15) */
export const MAX_EVENT_DAYS = 30;
/** 기간 조회 상한. 월 그리드 42일 + 여유 */
export const MAX_RANGE_DAYS = 62;

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
  creator: { select: { nickname: true, profileImageUrl: true } },
} as const;

type EventRow = {
  id: string;
  groupId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  memo: string | null;
  creatorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  creator: { nickname: string; profileImageUrl: string | null } | null;
};

export interface EventView {
  id: string;
  groupId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  memo: string | null;
  creator: Member;
  createdAt: Date;
  updatedAt: Date;
}

/** `endsAt > startsAt`, 길이 30일 이하. 아니면 EVENT_RANGE_INVALID */
export function assertEventRange(startsAt: Date, endsAt: Date): void {
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new ApiException('EVENT_RANGE_INVALID', '종료 시각은 시작 시각보다 뒤여야 해요');
  }
  if (endsAt.getTime() - startsAt.getTime() > MAX_EVENT_DAYS * DAY_MS) {
    throw new ApiException('EVENT_RANGE_INVALID', `일정은 최대 ${MAX_EVENT_DAYS}일까지 만들 수 있어요`);
  }
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

export function toEventView(row: EventRow, resolver: MemberResolver): EventView {
  return {
    id: row.id,
    groupId: row.groupId,
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    memo: row.memo,
    creator: resolver.resolve(row.creatorId, row.creator),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipService,
  ) {}

  /** 겹침 조건 `startsAt < to AND endsAt > from`, startsAt 오름차순 */
  async list(userId: string, groupId: string, fromRaw: string, toRaw: string): Promise<EventView[]> {
    await this.memberships.assertMember(userId, groupId);
    const { from, to } = parseRange(fromRaw, toRaw, MAX_RANGE_DAYS);
    const rows = await this.prisma.event.findMany({
      where: { groupId, startsAt: { lt: to }, endsAt: { gt: from } },
      orderBy: { startsAt: 'asc' },
      select: EVENT_SELECT,
    });
    const resolver = await this.memberships.resolverFor(groupId);
    return rows.map((row) => toEventView(row, resolver));
  }

  async get(userId: string, groupId: string, eventId: string): Promise<EventView> {
    await this.memberships.assertMember(userId, groupId);
    const row = await this.findInGroup(this.prisma, groupId, eventId);
    const resolver = await this.memberships.resolverFor(groupId);
    return toEventView(row, resolver);
  }

  async create(userId: string, groupId: string, dto: EventInputDto): Promise<EventView> {
    await this.memberships.assertMember(userId, groupId);
    const startsAt = parseIsoDate(dto.startsAt, 'startsAt');
    const endsAt = parseIsoDate(dto.endsAt, 'endsAt');
    assertEventRange(startsAt, endsAt);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: { groupId, title: dto.title, startsAt, endsAt, allDay: dto.allDay, memo: dto.memo ?? null, creatorId: userId },
        select: EVENT_SELECT,
      });
      await tx.eventLog.create({ data: snapshotLog(created, userId, 'CREATED') });
      return created;
    });
    const resolver = await this.memberships.resolverFor(groupId);
    return toEventView(row, resolver);
  }

  async update(userId: string, groupId: string, eventId: string, dto: EventPatchDto): Promise<EventView> {
    await this.memberships.assertMember(userId, groupId);
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.findInGroup(tx, groupId, eventId);
      const startsAt = dto.startsAt !== undefined ? parseIsoDate(dto.startsAt, 'startsAt') : current.startsAt;
      const endsAt = dto.endsAt !== undefined ? parseIsoDate(dto.endsAt, 'endsAt') : current.endsAt;
      assertEventRange(startsAt, endsAt);
      const updated = await tx.event.update({
        where: { id: eventId },
        data: {
          title: dto.title ?? current.title,
          startsAt,
          endsAt,
          allDay: dto.allDay ?? current.allDay,
          memo: dto.memo !== undefined ? dto.memo : current.memo,
        },
        select: EVENT_SELECT,
      });
      await tx.eventLog.create({ data: snapshotLog(updated, userId, 'UPDATED') });
      return updated;
    });
    const resolver = await this.memberships.resolverFor(groupId);
    return toEventView(row, resolver);
  }

  /** 삭제 전 스냅샷으로 DELETED 로그를 남긴다. 로그의 eventId 는 FK SetNull 로 null 이 된다 */
  async remove(userId: string, groupId: string, eventId: string): Promise<{ ok: true }> {
    await this.memberships.assertMember(userId, groupId);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.findInGroup(tx, groupId, eventId);
      await tx.eventLog.create({ data: snapshotLog(current, userId, 'DELETED') });
      await tx.event.delete({ where: { id: eventId } });
    });
    return { ok: true };
  }

  /** 다른 팀 자원을 가리키는 ID 도 NOT_FOUND */
  private async findInGroup(db: Db, groupId: string, eventId: string): Promise<EventRow> {
    const row = await db.event.findFirst({ where: { id: eventId, groupId }, select: EVENT_SELECT });
    if (!row) throw new ApiException('NOT_FOUND', '일정을 찾을 수 없어요');
    return row;
  }
}

function snapshotLog(
  event: Pick<EventRow, 'id' | 'groupId' | 'title' | 'startsAt' | 'endsAt' | 'allDay'>,
  actorId: string,
  action: 'CREATED' | 'UPDATED' | 'DELETED',
) {
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
