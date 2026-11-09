import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export const EVENT_LOG_SELECT = {
  id: true,
  action: true,
  eventId: true,
  actorId: true,
  title: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  createdAt: true,
  actor: { select: { nickname: true, profileImageUrl: true } },
} as const;

export interface EventLogRow {
  id: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  eventId: string | null;
  actorId: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  createdAt: Date;
  actor: { nickname: string; profileImageUrl: string | null } | null;
}

/** 새 소식 조회. 쓰기는 일정 변경과 한 트랜잭션이라 EventsRepository 의 `...WithLogTx` 가 맡는다 */
@Injectable()
export class EventLogsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** `after` 이후, 내 변경 제외 (actorId null 인 탈퇴자 변경은 포함) */
  countUnseenByOthers(groupId: string, after: Date, userId: string): Promise<number> {
    return this.prisma.eventLog.count({
      where: {
        groupId,
        createdAt: { gt: after },
        OR: [{ actorId: null }, { actorId: { not: userId } }],
      },
    });
  }

  /** `since` 이후, 내 변경 제외, 최신순 `limit` 건 */
  listRecentByOthers(groupId: string, userId: string, since: Date, limit: number): Promise<EventLogRow[]> {
    return this.prisma.eventLog.findMany({
      where: {
        groupId,
        createdAt: { gte: since },
        OR: [{ actorId: null }, { actorId: { not: userId } }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: EVENT_LOG_SELECT,
    });
  }
}
