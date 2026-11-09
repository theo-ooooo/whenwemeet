import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { MemberWithJoin, pickLeastUsedColor, toMember } from '../common/member.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateMeDto } from './dto/group.dto.js';
import { generateInviteCode, isUniqueViolation, normalizeInviteCode } from './invite-code.js';
import { Db, GroupDetail, MembershipService } from './membership.service.js';

export interface GroupSummary {
  id: string;
  type: 'PERSONAL' | 'TEAM';
  name: string;
  memberCount: number;
  me: { color: string; displayName: string };
  unreadNewsCount: number;
}

/** 초대 코드 충돌 시 재생성 횟수 상한 (32^6 공간이라 사실상 1회에 끝난다) */
const INVITE_CODE_RETRIES = 5;

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipService,
  ) {}

  /** PERSONAL 먼저, 그다음 joinedAt 순. unreadNewsCount 는 팀마다 count (결정기록 D-23) */
  async list(userId: string): Promise<GroupSummary[]> {
    const rows = await this.prisma.membership.findMany({
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
    rows.sort((a, b) => Number(b.group.type === 'PERSONAL') - Number(a.group.type === 'PERSONAL'));

    const summaries: GroupSummary[] = [];
    for (const row of rows) {
      const unreadNewsCount = await this.prisma.eventLog.count({
        where: {
          groupId: row.group.id,
          createdAt: { gt: row.lastSeenAt },
          OR: [{ actorId: null }, { actorId: { not: userId } }],
        },
      });
      summaries.push({
        id: row.group.id,
        type: row.group.type,
        name: row.group.name,
        memberCount: row.group._count.memberships,
        me: { color: row.color, displayName: row.displayName ?? row.user.nickname },
        unreadNewsCount,
      });
    }
    return summaries;
  }

  /** TEAM 팀 생성. 요청자가 첫 멤버, 초대 코드 발급 */
  async create(userId: string, name: string): Promise<GroupDetail> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const group = await tx.group.create({
            data: {
              type: 'TEAM',
              name,
              inviteCode: generateInviteCode(),
              memberships: { create: { userId, color: pickLeastUsedColor([]) } },
            },
            select: { id: true },
          });
          return this.memberships.groupDetail(group.id, userId, tx);
        });
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= INVITE_CODE_RETRIES) throw error;
      }
    }
  }

  async detail(userId: string, groupId: string): Promise<GroupDetail> {
    await this.memberships.assertMember(userId, groupId);
    return this.memberships.groupDetail(groupId, userId);
  }

  async rename(userId: string, groupId: string, name: string): Promise<GroupDetail> {
    await this.memberships.assertMember(userId, groupId);
    await this.prisma.group.update({ where: { id: groupId }, data: { name } });
    return this.memberships.groupDetail(groupId, userId);
  }

  /** 새 코드로 교체. 이전 코드는 즉시 무효. PERSONAL 이면 GROUP_NOT_INVITABLE (결정기록 D-04) */
  async rotateInviteCode(userId: string, groupId: string): Promise<{ inviteCode: string; inviteUrl: string }> {
    await this.memberships.assertMember(userId, groupId);
    const group = await this.prisma.group.findUnique({ where: { id: groupId }, select: { type: true } });
    if (!group) throw new ApiException('NOT_FOUND', '팀을 찾을 수 없어요');
    if (group.type === 'PERSONAL') throw new ApiException('GROUP_NOT_INVITABLE');

    for (let attempt = 0; ; attempt += 1) {
      const inviteCode = generateInviteCode();
      try {
        await this.prisma.group.update({ where: { id: groupId }, data: { inviteCode } });
        return { inviteCode, inviteUrl: this.memberships.inviteUrl(inviteCode)! };
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= INVITE_CODE_RETRIES) throw error;
      }
    }
  }

  /** 로그인 전 미리보기 (결정기록 D-20). 팀 이름과 인원수만 */
  async invitePreview(codeRaw: string): Promise<{ groupName: string; memberCount: number }> {
    const group = await this.findByInviteCode(codeRaw, this.prisma);
    return { groupName: group.name, memberCount: group._count.memberships };
  }

  /** 코드로 참여. 이미 멤버면 같은 응답 (멱등, 결정기록 D-19) */
  async join(userId: string, codeRaw: string): Promise<GroupDetail> {
    const group = await this.findByInviteCode(codeRaw, this.prisma);
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.membership.findUnique({
          where: { userId_groupId: { userId, groupId: group.id } },
          select: { id: true },
        });
        if (existing) return;
        const used = await tx.membership.findMany({ where: { groupId: group.id }, select: { color: true } });
        await tx.membership.create({
          data: { userId, groupId: group.id, color: pickLeastUsedColor(used.map((m) => m.color)) },
        });
      });
    } catch (error) {
      // 같은 링크를 동시에 두 번 눌러 멤버십이 먼저 생긴 경우도 멱등하게 성공
      if (!isUniqueViolation(error)) throw error;
    }
    return this.memberships.groupDetail(group.id, userId);
  }

  /** 내 색/표시 이름. displayName null 은 닉네임으로 되돌림 */
  async updateMe(userId: string, groupId: string, dto: UpdateMeDto): Promise<MemberWithJoin> {
    const membership = await this.memberships.assertMember(userId, groupId);
    const data: { color?: string; displayName?: string | null } = {};
    if (dto.color !== undefined) data.color = dto.color.toUpperCase();
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    const updated = await this.prisma.membership.update({
      where: { id: membership.id },
      data,
      select: {
        userId: true,
        color: true,
        displayName: true,
        joinedAt: true,
        user: { select: { nickname: true, profileImageUrl: true } },
      },
    });
    return toMember(updated);
  }

  /** 팀 나가기 (api.md 2.7). 한 트랜잭션 */
  async leave(userId: string, groupId: string): Promise<{ groupDeleted: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const membership = await this.memberships.assertMember(userId, groupId, tx);
      const group = await tx.group.findUnique({ where: { id: groupId }, select: { type: true } });
      if (!group) throw new ApiException('NOT_FOUND', '팀을 찾을 수 없어요');
      if (group.type === 'PERSONAL') throw new ApiException('GROUP_PERSONAL_LEAVE');
      return { groupDeleted: await this.removeMembership(tx, membership.id, groupId) };
    });
  }

  /** 멤버십 삭제 후 남은 멤버가 0 이면 팀 삭제 (Cascade). 탈퇴 처리도 같은 단계를 쓴다 */
  async removeMembership(tx: Db, membershipId: string, groupId: string): Promise<boolean> {
    await tx.membership.delete({ where: { id: membershipId } });
    const remaining = await tx.membership.count({ where: { groupId } });
    if (remaining > 0) return false;
    await tx.group.delete({ where: { id: groupId } });
    return true;
  }

  private async findByInviteCode(codeRaw: string, db: Db) {
    const code = normalizeInviteCode(codeRaw);
    const group = code
      ? await db.group.findUnique({
          where: { inviteCode: code },
          select: { id: true, name: true, _count: { select: { memberships: true } } },
        })
      : null;
    if (!group) throw new ApiException('INVITE_NOT_FOUND');
    return group;
  }
}
