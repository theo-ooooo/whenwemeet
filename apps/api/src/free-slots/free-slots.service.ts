import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { EventsRepository } from '../events/events.repository.js';
import { parseRange } from '../events/events.service.js';
import { expand } from '../events/recurrence.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
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
    private readonly membershipsRepo: MembershipsRepository,
    private readonly events: EventsRepository,
    private readonly memberships: MembershipService,
  ) {}

  /** api.md 2.5 쿼리 전략. DB 조회 4번 (한 번짜리, 반복 원본 + 예외), 일정 내용은 select 하지 않는다 (결정기록 D-14) */
  async find(userId: number, groupId: number, query: FreeSlotsQueryDto, now: Date = new Date()): Promise<FreeSlotsResult> {
    // 1. 멤버십 확인 → 요청 팀의 멤버
    await this.memberships.assertMember(userId, groupId);
    const { from: requestedFrom, to } = parseRange(query.from, query.to, MAX_FREE_SLOT_DAYS);
    const dayStartMin = parseHHmm(query.dayStart);
    const dayEndMin = parseHHmm(query.dayEnd, true);
    if (dayStartMin === null || dayEndMin === null || dayStartMin >= dayEndMin) {
      const message = 'dayStart 는 dayEnd 보다 앞이어야 해요';
      throw new ApiException('VALIDATION_FAILED', message, [{ field: 'dayStart', message }]);
    }

    const memberIds = await this.membershipsRepo.listUserIds(groupId);

    // from 이 과거면 현재 시각을 다음 30분 경계로 올려서 계산 (결정기록 D-30)
    const from = clampFromToNow(requestedFrom, now);
    if (from.getTime() >= to.getTime()) return { slots: [], memberCount: memberIds.length };

    // 2. 멤버들이 속한 모든 팀 (개인 팀 포함), 중복 없이
    const allGroupIds = await this.membershipsRepo.listDistinctGroupIds(memberIds);

    // 3. 바쁜 구간만 (title/memo 는 select 하지 않는다). 반복 원본은 회차로 펼쳐 합친다 (#187, 설계 4-2)
    const [once, series] = await Promise.all([
      this.events.listBusyRanges(allGroupIds, from, to, query.includeAllDay),
      this.events.listBusySeries(allGroupIds, from, to),
    ]);
    const recurring = series
      .flatMap((row) => expand(row, row.exceptions, from, to))
      .filter((occurrence) => query.includeAllDay || !occurrence.allDay)
      .map(({ startsAt, endsAt }) => ({ startsAt, endsAt }));
    const busy = recurring.length ? [...once, ...recurring].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()) : once;

    // 4~6. 병합 → 날짜 창 → 빼기 → 상한
    const slots = findFreeSlots({ from, to, dayStartMin, dayEndMin, minMinutes: query.minMinutes, busy });
    return { slots, memberCount: memberIds.length };
  }
}
