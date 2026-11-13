import { Injectable } from '@nestjs/common';
import { Db, PrismaService } from '../prisma/prisma.service.js';

const FEED_SELECT = {
  id: true,
  userId: true,
  groupId: true,
  tokenSalt: true,
  tokenHash: true,
  includeMemo: true,
  includeAnniversaries: true,
  lastFetchedAt: true,
  createdAt: true,
} as const;

export interface CalendarFeedRow {
  id: number;
  userId: number;
  groupId: number;
  tokenSalt: string;
  tokenHash: string;
  includeMemo: boolean;
  includeAnniversaries: boolean;
  lastFetchedAt: Date | null;
  createdAt: Date;
}

export interface CalendarFeedWithGroup extends CalendarFeedRow {
  group: { name: string; publicCode: string; type: 'PERSONAL' | 'TEAM' };
}

export interface CalendarFeedSettings {
  includeMemo?: boolean;
  includeAnniversaries?: boolean;
}

/** 새 토큰 (소금 + 해시) */
export interface FeedTokenInput {
  tokenSalt: string;
  tokenHash: string;
}

/** lastFetchedAt 갱신 간격. 외부 캘린더가 자주 불러도 1분에 한 번만 쓴다 */
export const FETCH_TOUCH_INTERVAL_MS = 60_000;

/** (#193) 외부 캘린더 구독 주소 (D-217, D-218). 나가기는 `deleteMemberTx` 를 멤버십 트랜잭션 안에서 부른다 */
@Injectable()
export class CalendarFeedsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMine(userId: number, groupId: number): Promise<CalendarFeedRow | null> {
    return this.prisma.calendarFeed.findUnique({ where: { userId_groupId: { userId, groupId } }, select: FEED_SELECT });
  }

  /** 없으면 새 토큰으로 만들고, 있으면 설정만 바꾼다 (토큰 유지) */
  upsert(userId: number, groupId: number, settings: CalendarFeedSettings, token: FeedTokenInput): Promise<CalendarFeedRow> {
    return this.prisma.calendarFeed.upsert({
      where: { userId_groupId: { userId, groupId } },
      create: { userId, groupId, ...token, ...settings },
      update: settings,
      select: FEED_SELECT,
    });
  }

  /** 토큰 교체 (재발급, 서버 비밀이 바뀐 뒤 주소 다시 맞추기). 행이 없으면 null */
  async replaceToken(userId: number, groupId: number, token: FeedTokenInput): Promise<CalendarFeedRow | null> {
    const { count } = await this.prisma.calendarFeed.updateMany({ where: { userId, groupId }, data: token });
    return count > 0 ? this.findMine(userId, groupId) : null;
  }

  async remove(userId: number, groupId: number): Promise<void> {
    await this.prisma.calendarFeed.deleteMany({ where: { userId, groupId } });
  }

  /** 공개 피드: 토큰 해시로 찾는다. 팀 이름과 공개 코드를 함께 */
  findByHash(tokenHash: string): Promise<CalendarFeedWithGroup | null> {
    return this.prisma.calendarFeed.findUnique({
      where: { tokenHash },
      select: { ...FEED_SELECT, group: { select: { name: true, publicCode: true, type: true } } },
    });
  }

  /** 마지막으로 가져간 시각. 직전 기록이 1분 안이면 쓰지 않는다 */
  async touchFetched(id: number, now: Date): Promise<void> {
    await this.prisma.calendarFeed.updateMany({
      where: { id, OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: new Date(now.getTime() - FETCH_TOUCH_INTERVAL_MS) } }] },
      data: { lastFetchedAt: now },
    });
  }

  /** 팀 나가기, 탈퇴 트랜잭션에서: 그 사람의 그 팀 주소를 지운다 (즉시 404) */
  async deleteMemberTx(db: Db, userId: number, groupId: number): Promise<void> {
    await db.calendarFeed.deleteMany({ where: { userId, groupId } });
  }
}
