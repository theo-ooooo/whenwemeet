import { Injectable } from '@nestjs/common';
import { toUserRowOrNull, USER_PUBLIC_SELECT, type UserRow } from '../common/member.js';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import { dbToDate } from '../events/event-rows.js';
import type { Repeat } from '../events/recurrence.js';
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
  repeat: true,
  scope: true,
  occurrence: true,
  actor: USER_PUBLIC_SELECT,
  /** (#311) 원본이 남아 있으면 그 공개 코드 (웹이 `/events/<코드>` 로 간다) */
  event: { select: { publicCode: true } },
} as const;

export interface EventLogRow {
  id: number;
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  eventId: number | null;
  /** (#311) 원본의 공개 코드. 삭제됐으면 null */
  eventCode: string | null;
  actorId: number | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  createdAt: Date;
  /** (#187) 변경 시점의 반복 주기 */
  repeat: Repeat | null;
  /** (#187) 반복 일정에서 고른 범위 */
  scope: 'THIS' | 'FOLLOWING' | null;
  /** (#187) 범위를 고른 회차 날짜 'YYYY-MM-DD' (KST) */
  occurrence: string | null;
  actor: UserRow | null;
}

/** 새 소식 조회. 쓰기는 일정 변경과 한 트랜잭션이라 일정 쓰기 저장소들(EventWritesRepository, EventSeriesRepository, EventRemovalsRepository)의 `...WithLogTx` 가 맡는다 */
@Injectable()
export class EventLogsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
  ) {}

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
    return rows.map(({ event, ...row }) => ({
      ...row,
      eventCode: event?.publicCode ?? null,
      occurrence: row.occurrence === null ? null : dbToDate(row.occurrence),
      actor: toUserRowOrNull(row.actor, this.urls),
    }));
  }
}
