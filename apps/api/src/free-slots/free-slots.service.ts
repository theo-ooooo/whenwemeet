import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { EventBusyRepository } from '../events/event-busy.repository.js';
import { parseRange } from '../events/event-input.js';
import { expand } from '../events/recurrence.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import type { FreeSlotsQueryDto } from './dto/free-slots-query.dto.js';
import { isBusyForAny } from './participants.js';
import { clampFromToNow, findFreeSlots, Interval, parseHHmm } from './slots.js';

/** 조회 범위 상한 (결정기록 D-13) */
export const MAX_FREE_SLOT_DAYS = 31;

/** (#450) computeFor 의 계산 조건. 하루 창은 자정 기준 분 (dayEnd 1440 = 24:00) */
export interface FreeSlotOptions {
  dayStartMin: number;
  dayEndMin: number;
  minMinutes: number;
  includeAllDay: boolean;
}

export interface FreeSlotsResult {
  slots: Interval[];
  memberCount: number;
}

@Injectable()
export class FreeSlotsService {
  constructor(
    private readonly membershipsRepo: MembershipsRepository,
    private readonly events: EventBusyRepository,
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
    const slots = await this.computeFor(memberIds, requestedFrom, to, { dayStartMin, dayEndMin, minMinutes: query.minMinutes, includeAllDay: query.includeAllDay }, now);
    return { slots, memberCount: memberIds.length };
  }

  /**
   * (#450) 고른 멤버(memberIds)가 모두 비는 시간 (api.md 2.5 쿼리 전략 2~6단계). 공개 `find` 는 팀 멤버 전원으로, AI 비서는 고른 멤버로 부른다 (D-268).
   * 멤버십 검사는 호출자가 한다. from 이 과거면 지금을 다음 30분 경계로 올려서 계산 (결정기록 D-30)
   */
  async computeFor(memberIds: number[], requestedFrom: Date, to: Date, options: FreeSlotOptions, now: Date = new Date()): Promise<Interval[]> {
    const from = clampFromToNow(requestedFrom, now);
    if (from.getTime() >= to.getTime()) return [];

    // 2. 멤버들이 속한 모든 팀 (개인 팀 포함), 중복 없이
    const allGroupIds = await this.membershipsRepo.listDistinctGroupIds(memberIds);

    // 3. 바쁜 구간만 (title/memo 는 select 하지 않는다). 반복 원본은 회차로 펼쳐 합친다 (#187, 설계 4-2)
    //    (#248) 참여자 중 고른 멤버가 있는 일정만 바쁨. 반복은 원본 참여자라 펼치기 전에 거른다 (D-137)
    const [onceRows, seriesRows] = await Promise.all([
      this.events.listBusyRanges(allGroupIds, from, to, options.includeAllDay),
      this.events.listBusySeries(allGroupIds, from, to),
    ]);
    const members = new Set(memberIds);
    const once = onceRows.filter((row) => isBusyForAny(row, members)).map(({ startsAt, endsAt }) => ({ startsAt, endsAt }));
    const recurring = seriesRows
      .filter((row) => isBusyForAny(row, members))
      .flatMap((row) => expand(row, row.exceptions, from, to))
      .filter((occurrence) => options.includeAllDay || !occurrence.allDay)
      .map(({ startsAt, endsAt }) => ({ startsAt, endsAt }));
    const busy = recurring.length ? [...once, ...recurring].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()) : once;

    // 4~6. 병합 → 날짜 창 → 빼기 → 상한
    return findFreeSlots({ from, to, dayStartMin: options.dayStartMin, dayEndMin: options.dayEndMin, minMinutes: options.minMinutes, busy });
  }

  /**
   * (#189) [from, to) 에 memberIds 중 누군가를 바쁘게 하는 일정이 있는지. 빈 시간 찾기와 같은 규칙(멤버들의 모든 팀, 참여자로 거름,
   * 종일 일정 제외 = includeAllDay 기본값)으로 본다. 약속 투표를 정하기 직전 다시 확인에 쓴다 (설계 약속-투표.md 4장)
   */
  async anyBusy(memberIds: number[], from: Date, to: Date): Promise<boolean> {
    if (memberIds.length === 0 || from.getTime() >= to.getTime()) return false;
    const allGroupIds = await this.membershipsRepo.listDistinctGroupIds(memberIds);
    const [onceRows, seriesRows] = await Promise.all([this.events.listBusyRanges(allGroupIds, from, to, false), this.events.listBusySeries(allGroupIds, from, to)]);
    const members = new Set(memberIds);
    if (onceRows.some((row) => isBusyForAny(row, members))) return true;
    return seriesRows
      .filter((row) => isBusyForAny(row, members))
      .some((row) => expand(row, row.exceptions, from, to).some((occurrence) => !occurrence.allDay));
  }
}
