import { Injectable } from '@nestjs/common';
import { Member } from '../common/member.js';
import { EventLogsRepository } from '../event-logs/event-logs.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';

/** 보존 기간과 건수 (결정기록 D-22) */
export const NEWS_DAYS = 30;
export const NEWS_LIMIT = 50;

export interface NewsItem {
  id: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  eventId: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  actor: Member;
  createdAt: Date;
  isNew: boolean;
}

@Injectable()
export class NewsService {
  constructor(
    private readonly eventLogs: EventLogsRepository,
    private readonly membershipsRepo: MembershipsRepository,
    private readonly memberships: MembershipService,
  ) {}

  /** 내 변경 제외(탈퇴자 null 포함), 최근 30일, 최신순 50건. isNew = createdAt > me.lastSeenAt */
  async list(userId: string, groupId: string, now: Date = new Date()): Promise<{ items: NewsItem[]; lastSeenAt: Date }> {
    const me = await this.memberships.assertMember(userId, groupId);
    const since = new Date(now.getTime() - NEWS_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.eventLogs.listRecentByOthers(groupId, userId, since, NEWS_LIMIT);
    const resolver = await this.memberships.resolverFor(groupId);
    const items = rows.map((row) => ({
      id: row.id,
      action: row.action,
      eventId: row.eventId,
      title: row.title,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      allDay: row.allDay,
      actor: resolver.resolve(row.actorId, row.actor),
      createdAt: row.createdAt,
      isNew: row.createdAt.getTime() > me.lastSeenAt.getTime(),
    }));
    return { items, lastSeenAt: me.lastSeenAt };
  }

  async markSeen(userId: string, groupId: string, now: Date = new Date()): Promise<{ lastSeenAt: Date }> {
    const me = await this.memberships.assertMember(userId, groupId);
    const updated = await this.membershipsRepo.markSeen(me.id, now);
    return { lastSeenAt: updated.lastSeenAt };
  }
}
