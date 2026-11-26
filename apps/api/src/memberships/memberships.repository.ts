import { Injectable } from '@nestjs/common';
import {
  toUserRow,
  USER_PUBLIC_SELECT,
  type MembershipRow,
  type UserPublicRecord,
} from '../common/member.js';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import { snapshotName } from '../group-activities/activity.js';
import { GroupActivitiesRepository } from '../group-activities/group-activities.repository.js';
import { CalendarFeedsRepository } from '../calendar-feed/calendar-feeds.repository.js';
import { deleteMemberResponsesTx } from '../event-responses/event-responses.repository.js';
import { EventSharesRepository } from '../event-shares/event-shares.repository.js';
import { Db, PrismaService } from '../prisma/prisma.service.js';
import { PushNotificationsRepository } from '../push/push-notifications.repository.js';

export const MEMBERSHIP_WITH_USER = {
  select: {
    id: true,
    userId: true,
    groupId: true,
    color: true,
    displayName: true,
    lastSeenAt: true,
    joinedAt: true,
    notify: true,
    showBirthday: true,
    user: USER_PUBLIC_SELECT,
  },
} as const;

/** (#300) 고정한 팀에서 나가거나 팀이 지워졌을 때 처음 여는 달력을 마지막에 본 달력으로 (D-192) */
export const START_CALENDAR_RESET = {
  startCalendarMode: 'LAST',
  startGroupId: null,
} as const;

/** notify: (#188) 팀 설정 "이 팀 알림 받기", showBirthday: (#305) "이 팀 달력에 내 생일 보이기" */
export type MembershipWithUser = MembershipRow & {
  id: number;
  groupId: number;
  lastSeenAt: Date;
  notify: boolean;
  showBirthday: boolean;
};

/** user 를 USER_PUBLIC_SELECT 모양으로 읽은 멤버십 행 → 응답용 `{ nickname, profileImageUrl }` */
function withUserRow<T extends { user: UserPublicRecord }>(
  row: T,
  urls: FileUrlBuilder,
): Omit<T, 'user'> & { user: MembershipRow['user'] } {
  return { ...row, user: toUserRow(row.user, urls) };
}

/** 팀 목록 화면용 한 행. 내 멤버십 + 팀 요약 */
export interface MembershipGroupRow {
  color: string;
  displayName: string | null;
  lastSeenAt: Date;
  /** (#297) 안 읽은 새 소식 수의 기준 */
  joinedAt: Date;
  user: { nickname: string };
  /** (#515) hiddenAt, hiddenReason: 운영 숨김 (D-286). 숨기지 않았으면 null */
  group: {
    id: number;
    type: 'PERSONAL' | 'TEAM';
    name: string;
    publicCode: string;
    hiddenAt: Date | null;
    hiddenReason: string | null;
    _count: { memberships: number };
  };
}

/** (#515) 멤버십 확인 결과. groupHidden 은 운영 숨김이면 사유, 아니면 null (D-286) */
export type MembershipAccess = MembershipWithUser & {
  groupHidden?: { reason: string } | null;
};

/** 탈퇴 처리용. 멤버십마다 팀 종류만 */
export interface MembershipGroupTypeRow {
  id: number;
  groupId: number;
  groupType: 'PERSONAL' | 'TEAM';
}

export interface MembershipMeInput {
  color?: string;
  displayName?: string | null;
  /** (#188) */
  notify?: boolean;
  /** (#305) */
  showBirthday?: boolean;
}

/** (#274) 합류 경로. 일정 링크로 들어오면 그 링크의 합류 수를 세고 새 소식에 경로를 남긴다 (D-185) */
export interface JoinVia {
  eventShareId: number;
}

@Injectable()
export class MembershipsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
    private readonly push: PushNotificationsRepository,
    private readonly activities: GroupActivitiesRepository,
    private readonly eventShares: EventSharesRepository,
    private readonly calendarFeeds: CalendarFeedsRepository,
  ) {}

  /** (#515) 팀 운영 숨김도 같이 읽는다 (멤버십 확인이 GROUP_HIDDEN 을 가른다) */
  async findByUserAndGroup(
    userId: number,
    groupId: number,
  ): Promise<MembershipAccess | null> {
    const row = await this.prisma.membership.findUnique({
      where: { userId_groupId: { userId, groupId } },
      select: {
        ...MEMBERSHIP_WITH_USER.select,
        group: { select: { hiddenAt: true, hiddenReason: true } },
      },
    });
    if (!row) return null;
    const { group, ...rest } = row;
    return {
      ...withUserRow(rest, this.urls),
      groupHidden: group.hiddenAt ? { reason: group.hiddenReason ?? '' } : null,
    };
  }

  /** joinedAt 오름차순 */
  async listByGroup(groupId: number): Promise<MembershipWithUser[]> {
    const rows = await this.prisma.membership.findMany({
      where: { groupId },
      orderBy: { joinedAt: 'asc' },
      ...MEMBERSHIP_WITH_USER,
    });
    return rows.map((row) => withUserRow(row, this.urls));
  }

  /** 내가 속한 팀 전부, joinedAt 오름차순 */
  listForUserWithGroup(userId: number): Promise<MembershipGroupRow[]> {
    return this.prisma.membership.findMany({
      where: { userId },
      orderBy: { joinedAt: 'asc' },
      select: {
        color: true,
        displayName: true,
        lastSeenAt: true,
        joinedAt: true,
        user: { select: { nickname: true } },
        group: {
          select: {
            id: true,
            type: true,
            name: true,
            publicCode: true,
            hiddenAt: true,
            hiddenReason: true,
            _count: { select: { memberships: true } },
          },
        },
      },
    });
  }

  async listByUserWithGroupType(
    userId: number,
  ): Promise<MembershipGroupTypeRow[]> {
    const rows = await this.prisma.membership.findMany({
      where: { userId },
      select: { id: true, groupId: true, group: { select: { type: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      groupId: row.groupId,
      groupType: row.group.type,
    }));
  }

  async listUserIds(groupId: number): Promise<number[]> {
    const rows = await this.prisma.membership.findMany({
      where: { groupId },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  /** 사용자들이 속한 모든 팀 ID, 중복 없이 */
  async listDistinctGroupIds(userIds: number[]): Promise<number[]> {
    const rows = await this.prisma.membership.findMany({
      where: { userId: { in: userIds } },
      select: { groupId: true },
      distinct: ['groupId'],
    });
    return rows.map((row) => row.groupId);
  }

  async updateMe(
    membershipId: number,
    data: MembershipMeInput,
  ): Promise<MembershipRow & { notify: boolean; showBirthday: boolean }> {
    const row = await this.prisma.membership.update({
      where: { id: membershipId },
      data,
      select: {
        userId: true,
        color: true,
        displayName: true,
        joinedAt: true,
        notify: true,
        showBirthday: true,
        user: USER_PUBLIC_SELECT,
      },
    });
    return withUserRow(row, this.urls);
  }

  markSeen(membershipId: number, at: Date): Promise<{ lastSeenAt: Date }> {
    return this.prisma.membership.update({
      where: { id: membershipId },
      data: { lastSeenAt: at },
      select: { lastSeenAt: true },
    });
  }

  /**
   * 아직 멤버가 아니면 팀에서 쓰인 색을 보고 고른 색으로 멤버십 생성. 이미 멤버면 아무것도 하지 않는다.
   * 새로 만들었으면 같은 트랜잭션에서 합류 알림을 예약하고(#188, D-91) 새 소식에 합류를 남긴 뒤(#191) true.
   * 멱등 재호출은 기록하지 않는다. (#274) via 가 있으면 그 일정 링크의 합류 수 +1, 새 소식 payload `{ via: 'EVENT_SHARE' }` (D-185)
   */
  async addMemberIfAbsentTx(
    userId: number,
    groupId: number,
    pickColor: (usedColors: string[]) => string,
    via?: JoinVia,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.membership.findUnique({
        where: { userId_groupId: { userId, groupId } },
        select: { id: true },
      });
      if (existing) return false;
      const used = await tx.membership.findMany({
        where: { groupId },
        select: { color: true },
      });
      const created = await tx.membership.create({
        data: { userId, groupId, color: pickColor(used.map((m) => m.color)) },
        select: { id: true, user: { select: { nickname: true } } },
      });
      await this.push.scheduleJoinTx(
        tx,
        { id: created.id, groupId, userId },
        new Date(),
      );
      await this.activities.recordTx(tx, {
        groupId,
        type: 'MEMBER_JOINED',
        actor: { id: userId, name: snapshotName(null, created.user.nickname) },
        payload: via ? { via: 'EVENT_SHARE' } : null,
      });
      if (via)
        await this.eventShares.incrementJoinCountTx(tx, via.eventShareId);
      return true;
    });
  }

  /** 팀 나가기. 멤버십 삭제 후 남은 멤버가 0 이면 팀 삭제 (Cascade). 팀이 삭제됐으면 true */
  leaveGroupTx(membershipId: number, groupId: number): Promise<boolean> {
    return this.prisma.$transaction((tx) =>
      this.removeWithGroupPrune(tx, membershipId, groupId, 'MEMBER_LEFT'),
    );
  }

  /**
   * 멤버십 삭제 + 그 팀 일정의 참여자 행 삭제(#248, D-139) + 빈 팀 정리 한 단계. 탈퇴 트랜잭션도 같은 단계를 쓴다.
   * 참여자 정리는 일정 변경이 아니라 로그, 새 소식, 알림을 남기지 않는다. 행이 0 이 된 일정은 "참여자 없음".
   * 멤버십을 먼저 지운다: 일정 저장은 멤버십을 공유 잠금으로 읽어 확인하므로(D-133) 이 순서여야 고아 행이 남지 않는다.
   * (#191) 팀이 남으면 나가기(MEMBER_LEFT) 또는 탈퇴(MEMBER_DELETED)를 지운 멤버십의 표시 이름 스냅샷으로 남긴다.
   * 팀이 지워지면 볼 사람이 없어 남기지 않는다.
   * (#274) 그 사람이 이 팀에서 만든 일정 공유 링크는 끊는다 (D-183). 팀이 지워지면 Cascade 로 같이 사라진다
   * (#300) 그 사람이 이 팀을 처음 여는 달력으로 고정했으면 LAST 로 되돌린다. 팀이 지워지면 이 팀을 고정한 사람 전부 (D-192)
   * (#193) 그 사람의 이 팀 구독 주소를 지운다 (즉시 404, D-217). 팀이 지워지면 Cascade
   * (#190) 그 팀 일정의 그 사람 참석 여부, 반응을 지운다 (다시 들어와도 복구하지 않는다)
   */
  async removeWithGroupPrune(
    db: Db,
    membershipId: number,
    groupId: number,
    activity: 'MEMBER_LEFT' | 'MEMBER_DELETED',
  ): Promise<boolean> {
    const removed = await db.membership.delete({
      where: { id: membershipId },
      select: {
        userId: true,
        displayName: true,
        user: { select: { nickname: true } },
      },
    });
    const { userId } = removed;
    await db.user.updateMany({
      where: { id: userId, startGroupId: groupId },
      data: START_CALENDAR_RESET,
    });
    await db.eventParticipant.deleteMany({
      where: { userId, event: { groupId } },
    });
    // (#190) 그 팀 일정의 내 참석 여부, 반응도 지운다 (탈퇴는 User Cascade 로도 지워진다)
    await deleteMemberResponsesTx(db, userId, groupId);
    // (#189) 이 팀 투표의 내 표와 대상 행. 기록 없이 지운다 (설계 약속-투표.md 3장)
    await db.pollVote.deleteMany({
      where: { userId, option: { poll: { groupId } } },
    });
    await db.pollParticipant.deleteMany({
      where: { userId, poll: { groupId } },
    });
    await this.eventShares.revokeCreatorTx(db, groupId, userId, new Date());
    await this.calendarFeeds.deleteMemberTx(db, userId, groupId);
    const remaining = await db.membership.count({ where: { groupId } });
    if (remaining > 0) {
      await this.activities.recordTx(db, {
        groupId,
        type: activity,
        actor: {
          id: userId,
          name: snapshotName(removed.displayName, removed.user.nickname),
        },
      });
      return false;
    }
    // FK SetNull 만으로는 mode 가 GROUP 으로 남으므로 지우기 전에 되돌린다
    await db.user.updateMany({
      where: { startGroupId: groupId },
      data: START_CALENDAR_RESET,
    });
    await db.group.delete({ where: { id: groupId } });
    return true;
  }
}
