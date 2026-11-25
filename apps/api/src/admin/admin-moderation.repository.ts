import { Injectable } from '@nestjs/common';
import type { EventRepeat, GroupType } from '../generated/prisma/enums.js';
import { START_CALENDAR_RESET } from '../memberships/memberships.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * (#515) 관리자 팀, 일정 관리 저장소 (D-286). 멤버 화면의 읽기와 달리 숨긴 것도 읽는다(VISIBLE_EVENT_WHERE 를 쓰지 않는다).
 * 목록은 id 내림차순, cursor 는 앞 페이지 마지막 id
 */

export interface HiddenState {
  reason: string;
  hiddenAt: Date;
  hiddenBy: { id: number; nickname: string } | null;
}

/** (#528) 관리자 사용자 상세의 기기 한 줄. 토큰은 없다 */
export interface AdminPushDevice {
  platform: 'IOS' | 'ANDROID';
  appVersion: string;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface AdminGroupRow {
  id: number;
  name: string;
  type: GroupType;
  memberCount: number;
  eventCount: number;
  createdAt: Date;
  hidden: HiddenState | null;
}

export interface AdminGroupDetail extends AdminGroupRow {
  members: { userId: number; nickname: string; displayName: string | null; joinedAt: Date }[];
  /** 시작 시각 내림차순 최근 20개 (숨긴 것 포함) */
  recentEvents: { id: number; title: string; startsAt: Date; allDay: boolean; repeat: EventRepeat | null; hidden: boolean }[];
}

export interface AdminEventRow {
  id: number;
  title: string;
  group: { id: number; name: string; hidden: boolean };
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  repeat: EventRepeat | null;
  creator: { id: number; nickname: string } | null;
  createdAt: Date;
  hidden: HiddenState | null;
}

/** 상세에만 메모와 장소 (목록에는 싣지 않는다) */
export interface AdminEventDetail extends AdminEventRow {
  memo: string | null;
  place: string | null;
}

export interface HideInput {
  reason: string;
  hiddenAt: Date;
  hiddenById: number;
}

const HIDDEN_SELECT = { hiddenAt: true, hiddenReason: true, hiddenBy: { select: { id: true, nickname: true } } } as const;

function toHidden(row: { hiddenAt: Date | null; hiddenReason: string | null; hiddenBy: { id: number; nickname: string } | null }): HiddenState | null {
  return row.hiddenAt ? { reason: row.hiddenReason ?? '', hiddenAt: row.hiddenAt, hiddenBy: row.hiddenBy } : null;
}

const GROUP_SELECT = {
  id: true,
  name: true,
  type: true,
  createdAt: true,
  ...HIDDEN_SELECT,
  _count: { select: { memberships: true, events: true } },
} as const;

type GroupRecord = {
  id: number;
  name: string;
  type: GroupType;
  createdAt: Date;
  hiddenAt: Date | null;
  hiddenReason: string | null;
  hiddenBy: { id: number; nickname: string } | null;
  _count: { memberships: number; events: number };
};

function toGroupRow(row: GroupRecord): AdminGroupRow {
  return { id: row.id, name: row.name, type: row.type, memberCount: row._count.memberships, eventCount: row._count.events, createdAt: row.createdAt, hidden: toHidden(row) };
}

const EVENT_SELECT = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  repeat: true,
  createdAt: true,
  ...HIDDEN_SELECT,
  group: { select: { id: true, name: true, hiddenAt: true } },
  creator: { select: { id: true, nickname: true } },
} as const;

type EventRecord = {
  id: number;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  repeat: EventRepeat | null;
  createdAt: Date;
  hiddenAt: Date | null;
  hiddenReason: string | null;
  hiddenBy: { id: number; nickname: string } | null;
  group: { id: number; name: string; hiddenAt: Date | null };
  creator: { id: number; nickname: string } | null;
};

function toEventRow(row: EventRecord): AdminEventRow {
  return {
    id: row.id,
    title: row.title,
    group: { id: row.group.id, name: row.group.name, hidden: row.group.hiddenAt !== null },
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    repeat: row.repeat,
    creator: row.creator,
    createdAt: row.createdAt,
    hidden: toHidden(row),
  };
}

function pageOf<T extends { id: number }>(rows: T[], limit: number): { items: T[]; nextCursor: number | null } {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}

@Injectable()
export class AdminModerationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 팀 ----------

  /** q 는 팀 이름 부분 일치 */
  async listGroups(query: { q: string | null; limit: number; cursor: number | null }): Promise<{ items: AdminGroupRow[]; nextCursor: number | null }> {
    const rows = await this.prisma.group.findMany({
      where: { ...(query.q ? { name: { contains: query.q } } : {}), ...(query.cursor !== null ? { id: { lt: query.cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      select: GROUP_SELECT,
    });
    return pageOf(rows.map(toGroupRow), query.limit);
  }

  async findGroup(id: number): Promise<AdminGroupDetail | null> {
    const row = await this.prisma.group.findUnique({
      where: { id },
      select: {
        ...GROUP_SELECT,
        memberships: { orderBy: { joinedAt: 'asc' }, select: { userId: true, displayName: true, joinedAt: true, user: { select: { nickname: true } } } },
        events: { orderBy: { startsAt: 'desc' }, take: 20, select: { id: true, title: true, startsAt: true, allDay: true, repeat: true, hiddenAt: true } },
      },
    });
    if (!row) return null;
    const { memberships, events, ...group } = row;
    return {
      ...toGroupRow(group),
      members: memberships.map((m) => ({ userId: m.userId, nickname: m.user.nickname, displayName: m.displayName, joinedAt: m.joinedAt })),
      recentEvents: events.map(({ hiddenAt, ...e }) => ({ ...e, hidden: hiddenAt !== null })),
    };
  }

  /** 사용자가 속한 팀 (관리자 사용자 상세), 가입순 */
  async listGroupsOfUser(userId: number): Promise<AdminGroupRow[]> {
    const rows = await this.prisma.membership.findMany({ where: { userId }, orderBy: { joinedAt: 'asc' }, select: { group: { select: GROUP_SELECT } } });
    return rows.map((row) => toGroupRow(row.group));
  }

  /** (#528) 관리자 사용자 상세의 푸시 기기 요약. 토큰은 읽지 않는다(응답에 실리지 않게). 최근 확인 먼저 */
  listPushDevicesOfUser(userId: number): Promise<AdminPushDevice[]> {
    return this.prisma.pushDevice.findMany({
      where: { userId },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      select: { platform: true, appVersion: true, createdAt: true, lastSeenAt: true },
    });
  }

  /** 숨기기(input) 또는 숨김 해제(null). 없는 팀이면 false */
  async setGroupHidden(id: number, input: HideInput | null): Promise<boolean> {
    const { count } = await this.prisma.group.updateMany({
      where: { id },
      data: input ? { hiddenAt: input.hiddenAt, hiddenReason: input.reason, hiddenById: input.hiddenById } : { hiddenAt: null, hiddenReason: null, hiddenById: null },
    });
    return count > 0;
  }

  /**
   * 팀 삭제 (모든 멤버에게서). 마지막 멤버가 나갈 때와 같은 정리: 이 팀을 처음 여는 달력으로 고정한 사용자는 LAST 로 되돌리고(D-192)
   * 팀을 지우면 멤버십, 일정, 기념일, 할 일, 투표, 공유 링크, 구독 주소, 기록이 FK Cascade 로 같이 지워진다. 없으면 false
   */
  async deleteGroupTx(id: number): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.group.findUnique({ where: { id }, select: { id: true } });
      if (!found) return false;
      await tx.user.updateMany({ where: { startGroupId: id }, data: START_CALENDAR_RESET });
      await tx.group.delete({ where: { id } });
      return true;
    });
  }

  // ---------- 일정 ----------

  /** q 는 제목 부분 일치, groupId 는 그 팀만 */
  async listEvents(query: { q: string | null; groupId: number | null; limit: number; cursor: number | null }): Promise<{ items: AdminEventRow[]; nextCursor: number | null }> {
    const rows = await this.prisma.event.findMany({
      where: {
        ...(query.q ? { title: { contains: query.q } } : {}),
        ...(query.groupId !== null ? { groupId: query.groupId } : {}),
        ...(query.cursor !== null ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      select: EVENT_SELECT,
    });
    return pageOf(rows.map(toEventRow), query.limit);
  }

  async findEvent(id: number): Promise<AdminEventDetail | null> {
    const row = await this.prisma.event.findUnique({ where: { id }, select: { ...EVENT_SELECT, memo: true, placeText: true, placeQuery: true } });
    if (!row) return null;
    const { memo, placeText, placeQuery, ...rest } = row;
    return { ...toEventRow(rest), memo, place: placeText ?? placeQuery };
  }

  async setEventHidden(id: number, input: HideInput | null): Promise<boolean> {
    const { count } = await this.prisma.event.updateMany({
      where: { id },
      data: input ? { hiddenAt: input.hiddenAt, hiddenReason: input.reason, hiddenById: input.hiddenById } : { hiddenAt: null, hiddenReason: null, hiddenById: null },
    });
    return count > 0;
  }

  /**
   * 일정 삭제 (반복이면 원본째). 예외, 참여자, 응답, 반응, 공유 링크, 가져오기 기록은 FK Cascade, 새 소식 기록과 투표의 일정 연결은 SetNull.
   * 멤버 삭제와 달리 새 소식 기록, 변경 알림, 되돌리기 보관을 남기지 않는다 (관리자 조치 기록만, D-286). 없으면 false
   */
  async deleteEvent(id: number): Promise<boolean> {
    const { count } = await this.prisma.event.deleteMany({ where: { id } });
    return count > 0;
  }
}
