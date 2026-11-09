import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { parseRange } from '../events/events.service.js';
import { MembershipService } from '../groups/membership.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { FreeSlotsQueryDto } from './dto/free-slots-query.dto.js';
import { clampFromToNow, findFreeSlots, Interval, parseHHmm } from './slots.js';

/** 조회 범위 상한 (결정기록 D-13) */
export const MAX_FREE_SLOT_DAYS = 31;

export interface FreeSlotsResult {
  slots: Interval[];
  memberCount: number;
}

@Injectable()
export class FreeSlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipService,
  ) {}

  /** api.md 2.5 쿼리 전략. DB 조회 3번, 일정 내용은 select 하지 않는다 (결정기록 D-14) */
  async find(userId: string, groupId: string, query: FreeSlotsQueryDto, now: Date = new Date()): Promise<FreeSlotsResult> {
    // 1. 멤버십 확인 → 요청 팀의 멤버
    await this.memberships.assertMember(userId, groupId);
    const { from: requestedFrom, to } = parseRange(query.from, query.to, MAX_FREE_SLOT_DAYS);
    const dayStartMin = parseHHmm(query.dayStart);
    const dayEndMin = parseHHmm(query.dayEnd);
    if (dayStartMin === null || dayEndMin === null || dayStartMin >= dayEndMin) {
      throw new ApiException('VALIDATION_FAILED', 'dayStart 는 dayEnd 보다 앞이어야 해요');
    }

    const members = await this.prisma.membership.findMany({ where: { groupId }, select: { userId: true } });
    const memberIds = members.map((m) => m.userId);

    // from 이 과거면 현재 시각을 다음 30분 경계로 올려서 계산 (결정기록 D-30)
    const from = clampFromToNow(requestedFrom, now);
    if (from.getTime() >= to.getTime()) return { slots: [], memberCount: memberIds.length };

    // 2. 멤버들이 속한 모든 팀 (개인 팀 포함), 중복 없이
    const groupRows = await this.prisma.membership.findMany({
      where: { userId: { in: memberIds } },
      select: { groupId: true },
      distinct: ['groupId'],
    });
    const allGroupIds = groupRows.map((row) => row.groupId);

    // 3. 바쁜 구간만 (title/memo 는 select 하지 않는다)
    const busy = await this.prisma.event.findMany({
      where: {
        groupId: { in: allGroupIds },
        startsAt: { lt: to },
        endsAt: { gt: from },
        ...(query.includeAllDay ? {} : { allDay: false }),
      },
      select: { startsAt: true, endsAt: true },
      orderBy: { startsAt: 'asc' },
    });

    // 4~6. 병합 → 날짜 창 → 빼기 → 상한
    const slots = findFreeSlots({ from, to, dayStartMin, dayEndMin, minMinutes: query.minMinutes, busy });
    return { slots, memberCount: memberIds.length };
  }
}
