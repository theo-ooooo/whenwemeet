import { Injectable } from '@nestjs/common';
import { DELETED_MEMBER, LEFT_MEMBER_COLOR, Member, MemberResolver } from '../common/member.js';
import { EventLogsRepository } from '../event-logs/event-logs.repository.js';
import type { Repeat } from '../events/recurrence.js';
import { type ActivityPayload, type GroupActivityType, pollEventLogIds } from '../group-activities/activity.js';
import { GroupActivitiesRepository, type GroupActivityRow } from '../group-activities/group-activities.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';

/** 보존 기간과 건수 (결정기록 D-22) */
export const NEWS_DAYS = 30;
export const NEWS_LIMIT = 50;

/** 일정 기록 한 줄. `v=2` 가 아니면 `kind` 없이 예전 모양 그대로 (D-155) */
export interface NewsItem {
  id: number;
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  eventId: number | null;
  /** (#311) 원본의 공개 코드. 삭제됐으면 null. 웹은 `/events/<코드>/edit` 로 간다 */
  eventCode: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** (#187) 변경 시점의 반복 주기. 문구는 웹이 조합 (설계 4-3) */
  repeat: Repeat | null;
  /** (#187) 반복 일정에서 고른 범위. 한 번짜리, 새 반복 추가는 null */
  scope: 'THIS' | 'FOLLOWING' | null;
  /** (#187) 범위를 고른 회차 날짜 'YYYY-MM-DD' (KST) */
  occurrence: string | null;
  actor: Member;
  createdAt: Date;
  isNew: boolean;
}

export type EventNewsItem = NewsItem & { kind: 'EVENT' };

/** (#191) 팀 활동 한 줄 (기념일 변경, 멤버 합류와 나가기, 팀 이름 변경) */
export interface ActivityNewsItem {
  kind: 'ACTIVITY';
  id: number;
  type: GroupActivityType;
  actor: Member;
  /** 기념일 3종의 대상. 삭제된 기념일이면 null */
  anniversaryId: number | null;
  payload: ActivityPayload;
  createdAt: Date;
  isNew: boolean;
}

export type MergedNewsItem = EventNewsItem | ActivityNewsItem;

/** 두 시각 중 늦은 쪽 */
const later = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b);

/**
 * (#297) 새 소식 목록의 시작 시각. 최근 30일과 내가 팀에 들어온 시각 중 늦은 쪽 (D-180).
 * 들어오기 전에 있었던 일은 보여 주지 않는다. 같은 시각(createdAt = joinedAt)은 포함
 */
export function newsSince(now: Date, joinedAt: Date): Date {
  return later(new Date(now.getTime() - NEWS_DAYS * 24 * 60 * 60 * 1000), joinedAt);
}

/**
 * (#297) 안 읽은 새 소식을 셀 기준 시각. lastSeenAt 과 joinedAt 중 늦은 쪽, 이 시각 "이후"(>) 만 센다 (D-180).
 * 멤버십을 만들 때 둘 다 지금이라 보통 lastSeenAt 이지만, 규칙을 목록과 같은 근거(joinedAt)에 묶어 둔다
 */
export function unseenAfter(lastSeenAt: Date, joinedAt: Date): Date {
  return later(lastSeenAt, joinedAt);
}

/** `v=2` 를 보낸 웹만 활동 항목을 받는다. 옛 웹은 예전 응답 그대로 (D-155) */
export type NewsVersion = 1 | 2;

/**
 * 두 소스를 createdAt 내림차순으로 합쳐 `limit` 건. 같은 시각이면 일정 먼저, 같은 종류는 id 내림차순 (D-151).
 * 각 소스가 이미 최근 `limit` 건이라 합친 앞 `limit` 건은 정확하다
 */
export function mergeNews(events: EventNewsItem[], activities: ActivityNewsItem[], limit: number = NEWS_LIMIT): MergedNewsItem[] {
  const kindRank = (item: MergedNewsItem) => (item.kind === 'EVENT' ? 0 : 1);
  return [...events, ...activities]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || kindRank(a) - kindRank(b) || b.id - a.id)
    .slice(0, limit);
}

/**
 * 활동 기록의 사람 (D-152).
 * - 지금 멤버 → 팀 안의 색/표시 이름
 * - 나간 사람 → 기록 시점 표시 이름 스냅샷, 회색
 * - 탈퇴(actorId null): 탈퇴 기록(MEMBER_DELETED)만 스냅샷 이름, 그 밖은 "탈퇴한 멤버" (Q3)
 */
export function activityActor(row: Pick<GroupActivityRow, 'type' | 'actorId' | 'actorName' | 'actor'>, resolver: MemberResolver): Member {
  if (row.actorId === null) {
    return row.type === 'MEMBER_DELETED' ? { ...DELETED_MEMBER, displayName: row.actorName } : DELETED_MEMBER;
  }
  return (
    resolver.find(row.actorId) ?? {
      userId: row.actorId,
      displayName: row.actorName,
      color: LEFT_MEMBER_COLOR,
      profileImageUrl: row.actor?.profileImageUrl ?? null,
    }
  );
}

@Injectable()
export class NewsService {
  constructor(
    private readonly eventLogs: EventLogsRepository,
    private readonly membershipsRepo: MembershipsRepository,
    private readonly memberships: MembershipService,
    private readonly activities: GroupActivitiesRepository,
  ) {}

  /**
   * 내 변경 제외(탈퇴자 null 포함), 최근 30일, 최신순 50건. isNew = createdAt > me.lastSeenAt.
   * version 2 면 일정 기록과 팀 활동 기록을 합친다 (#191).
   * (#297) 두 소스 모두 내가 팀에 들어온 뒤(createdAt >= joinedAt) 것만 (D-180)
   */
  async list(userId: number, groupId: number, now: Date = new Date(), version: NewsVersion = 1): Promise<{ items: NewsItem[] | MergedNewsItem[]; lastSeenAt: Date }> {
    const me = await this.memberships.assertMember(userId, groupId);
    const since = newsSince(now, me.joinedAt);
    const rows = await this.eventLogs.listRecentByOthers(groupId, userId, since, NEWS_LIMIT);
    const resolver = await this.memberships.resolverFor(groupId);
    const isNew = (createdAt: Date) => createdAt.getTime() > me.lastSeenAt.getTime();
    const items: NewsItem[] = rows.map((row) => ({
      id: row.id,
      action: row.action,
      eventId: row.eventId,
      eventCode: row.eventCode,
      title: row.title,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      allDay: row.allDay,
      repeat: row.repeat ?? null,
      scope: row.scope ?? null,
      occurrence: row.occurrence ?? null,
      actor: resolver.resolve(row.actorId, row.actor),
      createdAt: row.createdAt,
      isNew: isNew(row.createdAt),
    }));
    if (version !== 2) return { items, lastSeenAt: me.lastSeenAt };

    const activityRows = await this.activities.listRecentByOthers(groupId, userId, since, NEWS_LIMIT);
    const activities: ActivityNewsItem[] = activityRows.map((row) => ({
      kind: 'ACTIVITY',
      id: row.id,
      type: row.type,
      actor: activityActor(row, resolver),
      anniversaryId: row.anniversaryId,
      payload: (row.payload ?? {}) as ActivityPayload,
      createdAt: row.createdAt,
      isNew: isNew(row.createdAt),
    }));
    // (#189) 투표로 정한 일정의 CREATED 로그는 POLL_CLOSED 한 줄로 보인다 (D-226, Q4)
    const hidden = pollEventLogIds(activityRows);
    const events: EventNewsItem[] = items.filter((item) => !hidden.has(item.id)).map((item) => ({ kind: 'EVENT', ...item }));
    return { items: mergeNews(events, activities), lastSeenAt: me.lastSeenAt };
  }

  async markSeen(userId: number, groupId: number, now: Date = new Date()): Promise<{ lastSeenAt: Date }> {
    const me = await this.memberships.assertMember(userId, groupId);
    const updated = await this.membershipsRepo.markSeen(me.id, now);
    return { lastSeenAt: updated.lastSeenAt };
  }
}
