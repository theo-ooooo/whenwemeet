import { Injectable } from '@nestjs/common';
import type { MembershipRow } from '../common/member.js';
import { Db, PrismaService } from '../prisma/prisma.service.js';

export const MEMBERSHIP_WITH_USER = {
  select: {
    id: true,
    userId: true,
    groupId: true,
    color: true,
    displayName: true,
    lastSeenAt: true,
    joinedAt: true,
    user: { select: { nickname: true, profileImageUrl: true } },
  },
} as const;

export type MembershipWithUser = MembershipRow & { id: number; groupId: number; lastSeenAt: Date };

/** 팀 목록 화면용 한 행. 내 멤버십 + 팀 요약 */
export interface MembershipGroupRow {
  color: string;
  displayName: string | null;
  lastSeenAt: Date;
  user: { nickname: string };
  group: { id: number; type: 'PERSONAL' | 'TEAM'; name: string; _count: { memberships: number } };
}

/** 탈퇴 처리용. 멤버십마다 팀 종류만 */
export interface MembershipGroupTypeRow {
  id: number;
  groupId: number;
  groupType: 'PERSONAL' | 'TEAM';
}

export interface MembershipMeInput {
  color?: string;
  displayName?: string | null;
}

@Injectable()
export class MembershipsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUserAndGroup(userId: number, groupId: number): Promise<MembershipWithUser | null> {
    return this.prisma.membership.findUnique({ where: { userId_groupId: { userId, groupId } }, ...MEMBERSHIP_WITH_USER });
  }

  /** joinedAt 오름차순 */
  listByGroup(groupId: number): Promise<MembershipWithUser[]> {
    return this.prisma.membership.findMany({ where: { groupId }, orderBy: { joinedAt: 'asc' }, ...MEMBERSHIP_WITH_USER });
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
        user: { select: { nickname: true } },
        group: { select: { id: true, type: true, name: true, _count: { select: { memberships: true } } } },
      },
    });
  }

  async listByUserWithGroupType(userId: number): Promise<MembershipGroupTypeRow[]> {
    const rows = await this.prisma.membership.findMany({
      where: { userId },
      select: { id: true, groupId: true, group: { select: { type: true } } },
    });
    return rows.map((row) => ({ id: row.id, groupId: row.groupId, groupType: row.group.type }));
  }

  async listUserIds(groupId: number): Promise<number[]> {
    const rows = await this.prisma.membership.findMany({ where: { groupId }, select: { userId: true } });
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

  updateMe(membershipId: number, data: MembershipMeInput): Promise<MembershipRow> {
    return this.prisma.membership.update({
      where: { id: membershipId },
      data,
      select: {
        userId: true,
        color: true,
        displayName: true,
        joinedAt: true,
        user: { select: { nickname: true, profileImageUrl: true } },
      },
    });
  }

  markSeen(membershipId: number, at: Date): Promise<{ lastSeenAt: Date }> {
    return this.prisma.membership.update({ where: { id: membershipId }, data: { lastSeenAt: at }, select: { lastSeenAt: true } });
  }

  /** 아직 멤버가 아니면 팀에서 쓰인 색을 보고 고른 색으로 멤버십 생성. 이미 멤버면 아무것도 하지 않는다 */
  async addMemberIfAbsentTx(userId: number, groupId: number, pickColor: (usedColors: string[]) => string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.membership.findUnique({
        where: { userId_groupId: { userId, groupId } },
        select: { id: true },
      });
      if (existing) return;
      const used = await tx.membership.findMany({ where: { groupId }, select: { color: true } });
      await tx.membership.create({ data: { userId, groupId, color: pickColor(used.map((m) => m.color)) } });
    });
  }

  /** 팀 나가기. 멤버십 삭제 후 남은 멤버가 0 이면 팀 삭제 (Cascade). 팀이 삭제됐으면 true */
  leaveGroupTx(membershipId: number, groupId: number): Promise<boolean> {
    return this.prisma.$transaction((tx) => this.removeWithGroupPrune(tx, membershipId, groupId));
  }

  /** 멤버십 삭제 + 빈 팀 정리 한 단계. 탈퇴 트랜잭션도 같은 단계를 쓴다 */
  async removeWithGroupPrune(db: Db, membershipId: number, groupId: number): Promise<boolean> {
    await db.membership.delete({ where: { id: membershipId } });
    const remaining = await db.membership.count({ where: { groupId } });
    if (remaining > 0) return false;
    await db.group.delete({ where: { id: groupId } });
    return true;
  }
}
