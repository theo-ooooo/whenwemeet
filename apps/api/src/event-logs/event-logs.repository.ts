import { Injectable } from '@nestjs/common';
import { toUserRowOrNull, USER_PUBLIC_SELECT, type UserRow } from '../common/member.js';
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
  actor: USER_PUBLIC_SELECT,
} as const;

export interface EventLogRow {
  id: number;
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  eventId: number | null;
  actorId: number | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  createdAt: Date;
  actor: UserRow | null;
}

/** 새 소식 조회. 쓰기는 일정 변경과 한 트랜잭션이라 EventsRepository 의 `...WithLogTx` 가 맡는다 */
@Injectable()
export class EventLogsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** `after` 이후, 내 변경 제외 (actorId null 인 탈퇴자 변경은 포함) */
  countUnseenByOthers(groupId: number, after: Date, userId: number): Promise<number> {
    return this.prisma.eventLog.count({
      where: {
        groupId,
        createdAt: { gt: after },
        OR: [{ actorId: null }, { actorId: { not: userId } }],
      },
    });
  }

  /** `since` 이후, 내 변경 제외, 최신순 `limit` 건 */
  async listRecentByOthers(groupId: number, userId: number, since: Date, limit: number): Promise<EventLogRow[]> {
    const rows = await this.prisma.eventLog.findMany({
      where: {
        groupId,
        createdAt: { gte: since },
        OR: [{ actorId: null }, { actorId: { not: userId } }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: EVENT_LOG_SELECT,
    });
    return rows.map((row) => ({ ...row, actor: toUserRowOrNull(row.actor) }));
  }
}
