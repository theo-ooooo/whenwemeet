import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * (#537) 관리자 대시보드 집계 (D-290). 지표마다 쿼리 하나. 날짜는 KST 달력 날짜 'YYYY-MM-DD' 로 묶는다
 * (DATETIME 은 UTC 로 저장되므로 +9시간 뒤 날짜). 볼까 사용량은 이미 KST 날짜(AssistantUsage.day)다
 */

/** 날짜별 수 */
export interface DayCount {
  day: string;
  count: number;
}

/** 볼까 날짜별 메시지 수와 쓴 사람 수 */
export interface AssistantDay {
  day: string;
  messages: number;
  users: number;
}

export interface StatsTotals {
  users: number;
  /** 팀(TEAM)만. 개인 달력은 따로 */
  teams: number;
  personalCalendars: number;
  events: number;
  /** 게시된 공지 (초안 제외) */
  notices: number;
  /** 접수 중 신고 수 (#536) */
  openReports: number;
  /** 기간 안에 접속 기록(UserClient.lastSeenAt)이 있는 사람 */
  activeUsers: number;
}

/**
 * 쓰는 곳 사람 수. 관리자 사용자 목록의 규칙과 같다(users.repository.ts adminPlatformsOf, D-288):
 * 접속 기록이나 푸시 기기가 있는 기종마다 세고(한 사람이 여러 기종이면 각각), 기록이 하나도 없으면 앱 로그인 기록이 없을 때 web, 있을 때 unknown
 */
export interface PlatformCounts {
  ios: number;
  android: number;
  web: number;
  unknown: number;
}

/** COUNT, SUM 은 드라이버에 따라 bigint, 문자열(DECIMAL)로 온다 */
const num = (v: unknown): number =>
  v === null || v === undefined ? 0 : Number(v);

@Injectable()
export class AdminStatsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 날짜별 가입자 (User.createdAt). from 은 첫날 KST 자정(UTC 시각) */
  async signupsByDay(from: Date): Promise<DayCount[]> {
    const rows = await this.prisma.$queryRaw<{ day: string; n: unknown }[]>`
      SELECT DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 9 HOUR), '%Y-%m-%d') AS day, COUNT(*) AS n
      FROM \`User\` WHERE createdAt >= ${from} GROUP BY day`;
    return rows.map((r) => ({ day: r.day, count: num(r.n) }));
  }

  /**
   * 날짜별 활동 사용자. 접속 기록은 기종마다 마지막 접속만 남으므로 "그날이 마지막 접속인 사람" 이다(기종이 둘이면 날짜마다 한 번씩).
   * 같은 사람이 여러 날 들어와도 마지막 날에만 잡혀 과거 날짜일수록 적게 보인다
   */
  async activeByDay(from: Date): Promise<DayCount[]> {
    const rows = await this.prisma.$queryRaw<{ day: string; n: unknown }[]>`
      SELECT DATE_FORMAT(DATE_ADD(lastSeenAt, INTERVAL 9 HOUR), '%Y-%m-%d') AS day, COUNT(DISTINCT userId) AS n
      FROM \`UserClient\` WHERE lastSeenAt >= ${from} GROUP BY day`;
    return rows.map((r) => ({ day: r.day, count: num(r.n) }));
  }

  /** 날짜별 볼까 메시지 수, 쓴 사람 수. fromDay 는 첫날 'YYYY-MM-DD' (KST) */
  async assistantByDay(fromDay: string): Promise<AssistantDay[]> {
    const rows = await this.prisma.$queryRaw<
      { day: string; messages: unknown; users: unknown }[]
    >`
      SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, SUM(count) AS messages, COUNT(*) AS users
      FROM \`AssistantUsage\` WHERE day >= ${fromDay} AND count > 0 GROUP BY day`;
    return rows.map((r) => ({
      day: r.day,
      messages: num(r.messages),
      users: num(r.users),
    }));
  }

  /** 전체 수와 기간 활동 사용자. from 은 기간 첫날 KST 자정 */
  async totals(from: Date): Promise<StatsTotals> {
    const [row] = await this.prisma.$queryRaw<
      Record<keyof StatsTotals, unknown>[]
    >`
      SELECT
        (SELECT COUNT(*) FROM \`User\`) AS users,
        (SELECT COUNT(*) FROM \`Group\` WHERE type = 'TEAM') AS teams,
        (SELECT COUNT(*) FROM \`Group\` WHERE type = 'PERSONAL') AS personalCalendars,
        (SELECT COUNT(*) FROM \`Event\`) AS events,
        (SELECT COUNT(*) FROM \`Notice\` WHERE publishedAt IS NOT NULL) AS notices,
        (SELECT COUNT(*) FROM \`Report\` WHERE status = 'open') AS openReports,
        (SELECT COUNT(DISTINCT userId) FROM \`UserClient\` WHERE lastSeenAt >= ${from}) AS activeUsers`;
    return {
      users: num(row.users),
      teams: num(row.teams),
      personalCalendars: num(row.personalCalendars),
      events: num(row.events),
      notices: num(row.notices),
      openReports: num(row.openReports),
      activeUsers: num(row.activeUsers),
    };
  }

  /** 쓰는 곳 사람 수 (PlatformCounts 규칙). 사용자 한 바퀴, 기종마다 EXISTS */
  async platforms(): Promise<PlatformCounts> {
    const [row] = await this.prisma.$queryRaw<
      Record<keyof PlatformCounts, unknown>[]
    >`
      SELECT
        COALESCE(SUM(EXISTS(SELECT 1 FROM \`UserClient\` c WHERE c.userId = u.id AND c.platform = 'ios')
          OR EXISTS(SELECT 1 FROM \`PushDevice\` d WHERE d.userId = u.id AND d.platform = 'IOS')), 0) AS ios,
        COALESCE(SUM(EXISTS(SELECT 1 FROM \`UserClient\` c WHERE c.userId = u.id AND c.platform = 'android')
          OR EXISTS(SELECT 1 FROM \`PushDevice\` d WHERE d.userId = u.id AND d.platform = 'ANDROID')), 0) AS android,
        COALESCE(SUM(EXISTS(SELECT 1 FROM \`UserClient\` c WHERE c.userId = u.id AND c.platform = 'web')
          OR (NOT EXISTS(SELECT 1 FROM \`UserClient\` c WHERE c.userId = u.id)
            AND NOT EXISTS(SELECT 1 FROM \`PushDevice\` d WHERE d.userId = u.id) AND u.lastAppLoginAt IS NULL)), 0) AS web,
        COALESCE(SUM(NOT EXISTS(SELECT 1 FROM \`UserClient\` c WHERE c.userId = u.id)
          AND NOT EXISTS(SELECT 1 FROM \`PushDevice\` d WHERE d.userId = u.id) AND u.lastAppLoginAt IS NOT NULL), 0) AS \`unknown\`
      FROM \`User\` u`;
    return {
      ios: num(row.ios),
      android: num(row.android),
      web: num(row.web),
      unknown: num(row.unknown),
    };
  }
}
