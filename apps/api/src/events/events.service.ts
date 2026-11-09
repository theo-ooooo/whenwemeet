import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { Member, MemberResolver } from '../common/member.js';
import { parseIsoDate } from '../common/validation.js';
import { MembershipService } from '../groups/membership.service.js';
import type { EventInputDto, EventPatchDto } from './dto/event.dto.js';
import { EventRow, EventsRepository } from './events.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 일정 길이 상한 (결정기록 D-15) */
export const MAX_EVENT_DAYS = 30;
/** 기간 조회 상한. 월 그리드 42일 + 여유 */
export const MAX_RANGE_DAYS = 62;

export interface EventView {
  id: number;
  groupId: number;
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
    private readonly events: EventsRepository,
    private readonly memberships: MembershipService,
  ) {}

  /** 겹침 조건 `startsAt < to AND endsAt > from`, startsAt 오름차순 */
  async list(userId: number, groupId: number, fromRaw: string, toRaw: string): Promise<EventView[]> {
    await this.memberships.assertMember(userId, groupId);
    const { from, to } = parseRange(fromRaw, toRaw, MAX_RANGE_DAYS);
    const rows = await this.events.listInRange(groupId, from, to);
    const resolver = await this.memberships.resolverFor(groupId);
    return rows.map((row) => toEventView(row, resolver));
  }

  async get(userId: number, groupId: number, eventId: number): Promise<EventView> {
    await this.memberships.assertMember(userId, groupId);
    const row = await this.findInGroup(groupId, eventId);
    const resolver = await this.memberships.resolverFor(groupId);
    return toEventView(row, resolver);
  }

  async create(userId: number, groupId: number, dto: EventInputDto): Promise<EventView> {
    await this.memberships.assertMember(userId, groupId);
    const startsAt = parseIsoDate(dto.startsAt, 'startsAt');
    const endsAt = parseIsoDate(dto.endsAt, 'endsAt');
    assertEventRange(startsAt, endsAt);

    const row = await this.events.createWithLogTx(
      { groupId, title: dto.title, startsAt, endsAt, allDay: dto.allDay, memo: dto.memo ?? null, creatorId: userId },
      userId,
    );
    const resolver = await this.memberships.resolverFor(groupId);
    return toEventView(row, resolver);
  }

  /** 부분 변경은 현재 값과 합쳐 검증한 뒤 UPDATED 로그와 함께 저장 */
  async update(userId: number, groupId: number, eventId: number, dto: EventPatchDto): Promise<EventView> {
    await this.memberships.assertMember(userId, groupId);
    const current = await this.findInGroup(groupId, eventId);
    const startsAt = dto.startsAt !== undefined ? parseIsoDate(dto.startsAt, 'startsAt') : current.startsAt;
    const endsAt = dto.endsAt !== undefined ? parseIsoDate(dto.endsAt, 'endsAt') : current.endsAt;
    assertEventRange(startsAt, endsAt);
    const row = await this.events.updateWithLogTx(
      eventId,
      {
        title: dto.title ?? current.title,
        startsAt,
        endsAt,
        allDay: dto.allDay ?? current.allDay,
        memo: dto.memo !== undefined ? dto.memo : current.memo,
      },
      userId,
    );
    const resolver = await this.memberships.resolverFor(groupId);
    return toEventView(row, resolver);
  }

  /** 삭제 전 스냅샷으로 DELETED 로그를 남긴다 */
  async remove(userId: number, groupId: number, eventId: number): Promise<{ ok: true }> {
    await this.memberships.assertMember(userId, groupId);
    const current = await this.findInGroup(groupId, eventId);
    await this.events.deleteWithLogTx(current, userId);
    return { ok: true };
  }

  /** 다른 팀 자원을 가리키는 ID 도 NOT_FOUND */
  private async findInGroup(groupId: number, eventId: number): Promise<EventRow> {
    const row = await this.events.findInGroup(groupId, eventId);
    if (!row) throw new ApiException('NOT_FOUND', '일정을 찾을 수 없어요');
    return row;
  }
}
