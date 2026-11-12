/**
 * (#277) 주간 요약과 조용한 팀 깨우기 (설계 푸시-알림.md 5-9, D-203 ~ D-205).
 * 예약은 월요일 09:00 ~ 12:00 KST 틱에서 주 1회(SchedulerLease 'weekly' 행), 문구와 변형은 펼칠 때 정한다.
 * 판정과 계산은 순수 함수로 두고 `WeeklyPlanner` 는 데이터만 모은다
 */
import { Injectable } from '@nestjs/common';
import { addDays, DAY_MS, expand, KST_OFFSET_MS, kstDate, kstMidnight } from '../events/recurrence.js';
import { isBusyForAny } from '../free-slots/participants.js';
import { clampFromToNow, findFreeSlots, type Interval } from '../free-slots/slots.js';
import { anniversaryItemsOn, type AnniversaryItemType, type AnniversaryLike } from './anniversary-items.js';
import { type PushPayload, type WeeklyItem, type WeeklyVariant, weeklyNudgePayload, weeklySummaryPayload } from './push-copy.js';
import {
  type PlannedWeekly,
  PushRepository,
  type WeeklyBusyRow,
  type WeeklyBusySeries,
  type WeeklyEventRow,
  type WeeklyGroup,
  type WeeklySeriesRow,
} from './push.repository.js';

const HOUR_MS = 60 * 60 * 1000;
/** 보내는 시각 (KST). 월요일 09:00 = 월요일 00:00 UTC */
export const WEEKLY_HOUR_KST = 9;
/** 이 시각(KST) 전까지만 그 주 예약을 만든다. 서버가 그 뒤까지 멈춰 있으면 그 주는 건너뛴다 */
export const WEEKLY_PLAN_UNTIL_HOUR_KST = 12;
/** WEEKLY 만 늦음 허용 3시간 (다른 종류는 10분, D-88 / D-203) */
export const WEEKLY_CATCH_UP_MS = 3 * HOUR_MS;
/** 팀마다 groupId % 600 초를 더해 10분에 흩는다 (Expo 요청 나누기) */
export const WEEKLY_SPREAD_SECONDS = 600;

/** 깨우기 조건 (D-205) */
export const NUDGE_QUIET_DAYS = 14;
export const NUDGE_STOP_DAYS = 90;
/** 이전 3번의 월요일 안에 보낸 깨우기가 있으면 보내지 않는다 = 4주에 1번 */
export const NUDGE_COOLDOWN_DAYS = 21;
export const NUDGE_MIN_MEMBERS = 2;
/** 빈 시간 찾기 조건: 09:00 ~ 23:00, 최소 2시간, 종일 일정 제외 (D-12) */
export const NUDGE_SLOT = { dayStartMin: 9 * 60, dayEndMin: 23 * 60, minMinutes: 120 } as const;

/** KST 요일 번호 (0 일요일 ~ 6 토요일) */
const kstDow = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();

/** 지금이 월요일 09:00 ~ 12:00 KST 이고 그 월요일을 아직 처리하지 않았으면 그 월요일 'YYYY-MM-DD', 아니면 null */
export function weeklyDue(now: Date, doneOn: string | null): string | null {
  const today = kstDate(now);
  if (kstDow(today) !== 1 || doneOn === today) return null;
  const hour = ((now.getTime() + KST_OFFSET_MS) % DAY_MS) / HOUR_MS;
  return hour >= WEEKLY_HOUR_KST && hour < WEEKLY_PLAN_UNTIL_HOUR_KST ? today : null;
}

/** "이번 주" = 월요일 00:00 ~ 다음 월요일 00:00 KST */
export function weekRange(monday: string): { from: Date; to: Date } {
  return { from: kstMidnight(monday), to: kstMidnight(addDays(monday, 7)) };
}

/** 그 월요일 09:00 KST */
export const weeklySendAt = (monday: string): Date => new Date(`${monday}T00:00:00.000Z`);

/** dedupeKey 에서 월요일을 읽는다 ('W:{groupId}:{월요일}') */
export function mondayOfKey(dedupeKey: string): string | null {
  const match = /^W:\d+:(\d{4}-\d{2}-\d{2})$/.exec(dedupeKey);
  return match ? match[1] : null;
}

/** 팀마다 1건 (접근 A). 문구는 펼칠 때 */
export function planWeekly(groupIds: number[], monday: string): PlannedWeekly[] {
  const base = weeklySendAt(monday).getTime();
  return groupIds.map((groupId) => ({
    kind: 'WEEKLY',
    dedupeKey: `W:${groupId}:${monday}`,
    groupId,
    scheduledAt: new Date(base + (groupId % WEEKLY_SPREAD_SECONDS) * 1000),
  }));
}

/** 회차 하나 (제목과 시각) */
export interface WeeklyOccurrence {
  title: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * 팀 일정 회차 중 [from, to) 와 겹치는 것, 시작 순. 반복은 펼치고 취소 회차는 뺀다 (recurrence.expand).
 * 여러 날 일정은 이어져도 1개. 참여자(#248)와 무관하게 팀 전체
 */
export function weekOccurrences(once: WeeklyEventRow[], series: WeeklySeriesRow[], from: Date, to: Date): WeeklyOccurrence[] {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const all: WeeklyOccurrence[] = once
    .filter((row) => row.startsAt.getTime() < toMs && row.endsAt.getTime() > fromMs)
    .map(({ title, startsAt, endsAt }) => ({ title, startsAt, endsAt }));
  for (const row of series) {
    for (const occurrence of expand(row, row.exceptions, from, to)) {
      all.push({ title: occurrence.title ?? row.title, startsAt: occurrence.startsAt, endsAt: occurrence.endsAt });
    }
  }
  return all.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.title.localeCompare(b.title));
}

/** 요약 문구 줄: 시작을 이번 주 안으로 자른다 (지난주부터 이어지면 월요일) */
export function summaryItems(occurrences: WeeklyOccurrence[], from: Date): WeeklyItem[] {
  return occurrences.slice(0, 2).map((o) => ({ title: o.title, startsAt: new Date(Math.max(o.startsAt.getTime(), from.getTime())) }));
}

const RANK: Record<AnniversaryItemType, number> = { YEARS: 0, DAYS: 1, YEARLY: 2, ORIGINAL: 2 };

/** 이번 주 첫 날의 기념일 항목 하나 (그날 안에서는 D-92 우선순위). 알림 시점 설정과 무관 */
export function weekAnniversary(anniversaries: (AnniversaryLike & { name: string })[], monday: string): { date: string; title: string } | null {
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(monday, offset);
    let best: { rank: number; title: string } | null = null;
    for (const a of anniversaries) {
      const [first] = anniversaryItemsOn(a, date);
      if (!first) continue;
      const rank = RANK[first.type];
      if (!best || rank < best.rank) best = { rank, title: first.label ? `${a.name} ${first.label}` : a.name };
    }
    if (best) return { date, title: best.title };
  }
  return null;
}

/** 깨우기 판정에 쓰는 사실 (빈 시간 계산 전) */
export interface NudgeFacts {
  type: 'PERSONAL' | 'TEAM';
  memberCount: number;
  groupCreatedAt: Date;
  /** 지난 14일(KST, 이번 월요일 00:00 앞) 과 겹치는 회차 수 */
  recentOccurrences: number;
  /** 지난 14일 일정 추가 기록 수 */
  recentCreated: number;
  /** 마지막 일정 생성. 없으면 null (팀 생성 시각을 쓴다) */
  lastCreatedAt: Date | null;
  /** 이전 3번의 월요일 안에 보낸 깨우기가 있는지 */
  nudgedRecently: boolean;
}

/** 빈 시간 계산 전 깨우기 조건 (D-205). 모두 만족하면 true */
export function nudgeEligible(facts: NudgeFacts, now: Date): boolean {
  const ago = (days: number) => now.getTime() - days * DAY_MS;
  if (facts.type !== 'TEAM' || facts.memberCount < NUDGE_MIN_MEMBERS) return false;
  if (facts.groupCreatedAt.getTime() > ago(NUDGE_QUIET_DAYS)) return false;
  if (facts.recentOccurrences > 0 || facts.recentCreated > 0) return false;
  if (facts.nudgedRecently) return false;
  return (facts.lastCreatedAt ?? facts.groupCreatedAt).getTime() > ago(NUDGE_STOP_DAYS);
}

/** 회차 수와 깨우기 사실, 빈 시간 수로 변형을 고른다. null 이면 보내지 않음 (CANCELLED) */
export function decideWeekly(count: number, eligible: boolean, freeSlots: number): WeeklyVariant | null {
  if (count >= 1) return 'SUMMARY';
  return eligible && freeSlots >= 1 ? 'NUDGE' : null;
}

/**
 * 깨우기 빈 시간 (빈 시간 찾기와 같은 규칙: 멤버들의 모든 팀 일정, #248 참여자, 종일 제외).
 * from 은 지금을 30분 경계로 올린 시각 (D-30)
 */
export function nudgeSlots(busy: { once: WeeklyBusyRow[]; series: WeeklyBusySeries[] }, memberIds: number[], from: Date, to: Date): Interval[] {
  const members = new Set(memberIds);
  const ranges: Interval[] = busy.once.filter((row) => isBusyForAny(row, members)).map(({ startsAt, endsAt }) => ({ startsAt, endsAt }));
  for (const row of busy.series) {
    if (!isBusyForAny(row, members)) continue;
    for (const occurrence of expand(row, row.exceptions, from, to)) {
      if (!occurrence.allDay) ranges.push({ startsAt: occurrence.startsAt, endsAt: occurrence.endsAt });
    }
  }
  ranges.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return findFreeSlots({ from, to, ...NUDGE_SLOT, busy: ranges });
}

export interface WeeklyBuild {
  variant: WeeklyVariant;
  payload: PushPayload;
}

/** 주간 알림 예약과 펼칠 때의 판정 (설계 5-9) */
@Injectable()
export class WeeklyPlanner {
  constructor(private readonly push: PushRepository) {}

  /** 이번 틱에 예약할 것. 예약했으면 그 월요일을 적는다 (같은 주 두 번 안 함, 남은 중복은 dedupeKey 가 막는다) */
  async plan(now: Date): Promise<number> {
    const monday = weeklyDue(now, await this.push.getWeeklyDoneOn());
    if (!monday) return 0;
    const created = await this.push.createNotifications(planWeekly(await this.push.listWeeklyGroupIds(), monday));
    await this.push.setWeeklyDoneOn(monday);
    return created;
  }

  /** 펼치는 순간의 DB 로 변형과 문구를 정한다. 팀이 없거나 보낼 것이 없으면 null */
  async build(groupId: number, monday: string, now: Date): Promise<WeeklyBuild | null> {
    const group = await this.push.findWeeklyGroup(groupId);
    if (!group) return null;
    const { from, to } = weekRange(monday);
    const events = await this.push.listWeeklyEvents(groupId, from, to);
    const occurrences = weekOccurrences(events.once, events.series, from, to);
    if (occurrences.length > 0) {
      const anniversary = weekAnniversary(await this.push.listGroupAnniversaries(groupId), monday);
      return {
        variant: 'SUMMARY',
        payload: weeklySummaryPayload({
          groupName: group.name,
          groupCode: group.publicCode,
          monday,
          count: occurrences.length,
          items: summaryItems(occurrences, from),
          anniversary,
        }),
      };
    }
    if (!(await this.nudgeEligible(group, groupId, monday, now))) return null;
    const slotFrom = clampFromToNow(from, now);
    if (slotFrom.getTime() >= to.getTime()) return null;
    const slots = nudgeSlots(await this.push.listWeeklyBusy(group.memberIds, slotFrom, to), group.memberIds, slotFrom, to);
    if (decideWeekly(0, true, slots.length) !== 'NUDGE') return null;
    return { variant: 'NUDGE', payload: weeklyNudgePayload({ groupName: group.name, groupCode: group.publicCode, monday, slots }) };
  }

  /** 싼 조건부터 본다 (개인 팀, 멤버 수, 생성 14일은 쿼리 없이) */
  private async nudgeEligible(group: WeeklyGroup, groupId: number, monday: string, now: Date): Promise<boolean> {
    const base = { type: group.type, memberCount: group.memberIds.length, groupCreatedAt: group.createdAt };
    const cheap: NudgeFacts = { ...base, recentOccurrences: 0, recentCreated: 0, lastCreatedAt: now, nudgedRecently: false };
    if (!nudgeEligible(cheap, now)) return false;
    const quietFrom = kstMidnight(addDays(monday, -NUDGE_QUIET_DAYS));
    const { from } = weekRange(monday);
    const recent = await this.push.listWeeklyEvents(groupId, quietFrom, from);
    return nudgeEligible(
      {
        ...base,
        recentOccurrences: weekOccurrences(recent.once, recent.series, quietFrom, from).length,
        recentCreated: await this.push.countCreatedLogsSince(groupId, new Date(now.getTime() - NUDGE_QUIET_DAYS * DAY_MS)),
        lastCreatedAt: await this.push.lastEventCreatedAt(groupId),
        nudgedRecently: await this.push.hasNudgeSince(groupId, kstMidnight(addDays(monday, -NUDGE_COOLDOWN_DAYS))),
      },
      now,
    );
  }
}
