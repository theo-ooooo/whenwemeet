import { Injectable } from '@nestjs/common';
import {
  AdminStatsRepository,
  type PlatformCounts,
  type StatsTotals,
} from './admin-stats.repository.js';

/** (#537) 대시보드 기간 (일) */
export const STATS_RANGES = [7, 30] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

/** (#537) 같은 기간을 다시 집계하지 않는 시간 (인스턴스 메모리) */
export const STATS_CACHE_MS = 60_000;

const KST_MS = 9 * 3600_000;
const DAY_MS = 86_400_000;

/** 하루 한 줄 (오래된 날 먼저, 빈 날은 0) */
export interface StatsDay {
  /** KST 'YYYY-MM-DD' */
  day: string;
  signups: number;
  /** 그날이 마지막 접속인 사람 (UserClient.lastSeenAt, D-290) */
  activeUsers: number;
  assistantMessages: number;
  assistantUsers: number;
}

/** GET /admin/stats */
export interface AdminStats {
  range: StatsRange;
  /** 기간 첫날과 오늘 (KST) */
  from: string;
  to: string;
  generatedAt: Date;
  days: StatsDay[];
  totals: StatsTotals & {
    signupsInRange: number;
    assistantMessagesInRange: number;
  };
  platforms: PlatformCounts;
}

/** KST 날짜 'YYYY-MM-DD' (UTC 시각 ms 기준) */
export function kstDayOf(ms: number): string {
  return new Date(ms + KST_MS).toISOString().slice(0, 10);
}

/** 오늘(KST)까지 range 일의 날짜 목록과 첫날 KST 자정의 UTC 시각 */
export function statsWindow(
  range: StatsRange,
  now: number,
): { days: string[]; fromAt: Date } {
  const today = Date.parse(`${kstDayOf(now)}T00:00:00.000Z`);
  const days = Array.from({ length: range }, (_, i) =>
    new Date(today - (range - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
  return { days, fromAt: new Date(Date.parse(`${days[0]}T00:00:00+09:00`)) };
}

/** 시계 (테스트가 바꾼다) */
@Injectable()
export class AdminStatsClock {
  now(): number {
    return Date.now();
  }
}

/**
 * (#537) 관리자 대시보드 (api.md 2.19, D-290). 지표마다 쿼리 하나를 동시에 돌리고 결과를 기간별로 60초 둔다.
 * 캐시는 인스턴스 메모리라 인스턴스가 여럿이면 각자 60초다(관리자 몇 명이 보는 화면이라 충분)
 */
@Injectable()
export class AdminStatsService {
  private readonly cache = new Map<
    StatsRange,
    { at: number; value: Promise<AdminStats> }
  >();

  constructor(
    private readonly repo: AdminStatsRepository,
    private readonly clock: AdminStatsClock,
  ) {}

  stats(range: StatsRange): Promise<AdminStats> {
    const now = this.clock.now();
    const hit = this.cache.get(range);
    if (hit && now - hit.at < STATS_CACHE_MS) return hit.value;
    const value = this.compute(range, now);
    this.cache.set(range, { at: now, value });
    // 실패한 집계는 두지 않는다 (다음 요청이 다시 집계)
    value.catch(() => {
      if (this.cache.get(range)?.value === value) this.cache.delete(range);
    });
    return value;
  }

  private async compute(range: StatsRange, now: number): Promise<AdminStats> {
    const { days, fromAt } = statsWindow(range, now);
    const [signups, active, assistant, totals, platforms] = await Promise.all([
      this.repo.signupsByDay(fromAt),
      this.repo.activeByDay(fromAt),
      this.repo.assistantByDay(days[0]),
      this.repo.totals(fromAt),
      this.repo.platforms(),
    ]);
    const countOf = (rows: { day: string; count: number }[]) =>
      new Map(rows.map((r) => [r.day, r.count]));
    const signupOf = countOf(signups);
    const activeOf = countOf(active);
    const assistantOf = new Map(assistant.map((r) => [r.day, r]));
    const rows = days.map((day): StatsDay => ({
      day,
      signups: signupOf.get(day) ?? 0,
      activeUsers: activeOf.get(day) ?? 0,
      assistantMessages: assistantOf.get(day)?.messages ?? 0,
      assistantUsers: assistantOf.get(day)?.users ?? 0,
    }));
    const sum = (pick: (d: StatsDay) => number) =>
      rows.reduce((n, d) => n + pick(d), 0);
    return {
      range,
      from: days[0],
      to: days[days.length - 1],
      generatedAt: new Date(now),
      days: rows,
      totals: {
        ...totals,
        signupsInRange: sum((d) => d.signups),
        assistantMessagesInRange: sum((d) => d.assistantMessages),
      },
      platforms,
    };
  }
}
