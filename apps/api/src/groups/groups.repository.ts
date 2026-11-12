import { Injectable } from '@nestjs/common';
import type { ActivityActor } from '../group-activities/activity.js';
import { EventSharesRepository } from '../event-shares/event-shares.repository.js';
import { GroupActivitiesRepository } from '../group-activities/group-activities.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface GroupRow {
  id: number;
  type: 'PERSONAL' | 'TEAM';
  name: string;
  inviteCode: string | null;
  /** (#311) 주소용 공개 코드 */
  publicCode: string;
  createdAt: Date;
}

/** 초대 코드로 찾은 팀. 미리보기와 참여에 쓴다 */
export interface InviteGroupRow {
  id: number;
  name: string;
  publicCode: string;
  memberCount: number;
}

export interface CreateTeamInput {
  name: string;
  inviteCode: string;
  /** (#311) 공개 코드. 충돌은 초대 코드처럼 P2002 로 던져진다 */
  publicCode: string;
  firstMember: { userId: number; color: string };
}

@Injectable()
export class GroupsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: GroupActivitiesRepository,
    private readonly eventShares: EventSharesRepository,
  ) {}

  findById(groupId: number): Promise<GroupRow | null> {
    return this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, type: true, name: true, inviteCode: true, publicCode: true, createdAt: true },
    });
  }

  findType(groupId: number): Promise<{ type: 'PERSONAL' | 'TEAM' } | null> {
    return this.prisma.group.findUnique({ where: { id: groupId }, select: { type: true } });
  }

  async findByInviteCode(inviteCode: string): Promise<InviteGroupRow | null> {
    const group = await this.prisma.group.findUnique({
      where: { inviteCode },
      select: { id: true, name: true, publicCode: true, _count: { select: { memberships: true } } },
    });
    return group && { id: group.id, name: group.name, publicCode: group.publicCode, memberCount: group._count.memberships };
  }

  /** TEAM 팀과 첫 멤버십을 함께 생성 (중첩 쓰기라 원자적). 초대 코드 충돌은 P2002 로 던져진다 */
  createTeam(input: CreateTeamInput): Promise<{ id: number }> {
    return this.prisma.group.create({
      data: {
        type: 'TEAM',
        name: input.name,
        inviteCode: input.inviteCode,
        publicCode: input.publicCode,
        memberships: { create: { userId: input.firstMember.userId, color: input.firstMember.color } },
      },
      select: { id: true },
    });
  }

  /** 이름 변경. 실제로 바뀐 경우만 같은 트랜잭션에서 새 소식에 GROUP_RENAMED { from, to } 를 남긴다 (#191) */
  async renameWithActivityTx(groupId: number, name: string, actor: ActivityActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.group.findUnique({ where: { id: groupId }, select: { name: true } });
      if (!current || current.name === name) return;
      await tx.group.update({ where: { id: groupId }, data: { name } });
      await this.activities.recordTx(tx, { groupId, type: 'GROUP_RENAMED', actor, payload: { from: current.name, to: name } });
    });
  }

  /** 새 초대 코드로 바꾸고 (#274) 그 팀의 살아 있는 일정 공유 링크도 모두 끊는다 (D-183). 코드 충돌은 P2002 로 던져지고 끊기도 되돌려진다 */
  async setInviteCodeTx(groupId: number, inviteCode: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.group.update({ where: { id: groupId }, data: { inviteCode } });
      await this.eventShares.revokeGroupTx(tx, groupId, new Date());
    });
  }
}
