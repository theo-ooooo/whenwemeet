import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface GroupRow {
  id: string;
  type: 'PERSONAL' | 'TEAM';
  name: string;
  inviteCode: string | null;
  createdAt: Date;
}

/** 초대 코드로 찾은 팀. 미리보기와 참여에 쓴다 */
export interface InviteGroupRow {
  id: string;
  name: string;
  memberCount: number;
}

export interface CreateTeamInput {
  name: string;
  inviteCode: string;
  firstMember: { userId: string; color: string };
}

@Injectable()
export class GroupsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(groupId: string): Promise<GroupRow | null> {
    return this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, type: true, name: true, inviteCode: true, createdAt: true },
    });
  }

  findType(groupId: string): Promise<{ type: 'PERSONAL' | 'TEAM' } | null> {
    return this.prisma.group.findUnique({ where: { id: groupId }, select: { type: true } });
  }

  async findByInviteCode(inviteCode: string): Promise<InviteGroupRow | null> {
    const group = await this.prisma.group.findUnique({
      where: { inviteCode },
      select: { id: true, name: true, _count: { select: { memberships: true } } },
    });
    return group && { id: group.id, name: group.name, memberCount: group._count.memberships };
  }

  /** TEAM 팀과 첫 멤버십을 함께 생성 (중첩 쓰기라 원자적). 초대 코드 충돌은 P2002 로 던져진다 */
  createTeam(input: CreateTeamInput): Promise<{ id: string }> {
    return this.prisma.group.create({
      data: {
        type: 'TEAM',
        name: input.name,
        inviteCode: input.inviteCode,
        memberships: { create: { userId: input.firstMember.userId, color: input.firstMember.color } },
      },
      select: { id: true },
    });
  }

  async rename(groupId: string, name: string): Promise<void> {
    await this.prisma.group.update({ where: { id: groupId }, data: { name } });
  }

  async setInviteCode(groupId: string, inviteCode: string): Promise<void> {
    await this.prisma.group.update({ where: { id: groupId }, data: { inviteCode } });
  }
}
