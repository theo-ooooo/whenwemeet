import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/errors.js';
import { MemberResolver, MemberWithJoin, MembershipRow, toMember } from '../common/member.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** 트랜잭션 안팎 어디서나 같은 코드를 쓰기 위한 클라이언트 타입 */
export type Db = Prisma.TransactionClient;

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

export type MembershipWithUser = MembershipRow & { id: string; groupId: string; lastSeenAt: Date };

export interface GroupDetail {
  id: string;
  type: 'PERSONAL' | 'TEAM';
  name: string;
  inviteCode: string | null;
  inviteUrl: string | null;
  createdAt: Date;
  members: MemberWithJoin[];
  me: MemberWithJoin;
}

/** 멤버십 확인과 멤버 목록. 모든 그룹 자원 서비스가 첫 줄에서 `assertMember` 를 부른다 */
@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** 멤버가 아니면 403 FORBIDDEN. 팀이 없어도 멤버십이 없으므로 같은 403 */
  async assertMember(userId: string, groupId: string, db: Db = this.prisma): Promise<MembershipWithUser> {
    const membership = await db.membership.findUnique({
      where: { userId_groupId: { userId, groupId } },
      ...MEMBERSHIP_WITH_USER,
    });
    if (!membership) throw new ApiException('FORBIDDEN');
    return membership;
  }

  async listMembers(groupId: string, db: Db = this.prisma): Promise<MembershipWithUser[]> {
    return db.membership.findMany({ where: { groupId }, orderBy: { joinedAt: 'asc' }, ...MEMBERSHIP_WITH_USER });
  }

  async resolverFor(groupId: string, db: Db = this.prisma): Promise<MemberResolver> {
    return new MemberResolver(await this.listMembers(groupId, db));
  }

  inviteUrl(inviteCode: string | null): string | null {
    if (!inviteCode) return null;
    return `${this.config.getOrThrow<string>('WEB_ORIGIN')}/join/${inviteCode}`;
  }

  /** GroupDetail 조립. 호출 전에 멤버십이 확인돼 있어야 한다 */
  async groupDetail(groupId: string, userId: string, db: Db = this.prisma): Promise<GroupDetail> {
    const group = await db.group.findUnique({
      where: { id: groupId },
      select: { id: true, type: true, name: true, inviteCode: true, createdAt: true },
    });
    if (!group) throw new ApiException('NOT_FOUND', '팀을 찾을 수 없어요');
    const members = (await this.listMembers(groupId, db)).map(toMember);
    const me = members.find((member) => member.userId === userId);
    if (!me) throw new ApiException('FORBIDDEN');
    return {
      id: group.id,
      type: group.type,
      name: group.name,
      inviteCode: group.inviteCode,
      inviteUrl: this.inviteUrl(group.inviteCode),
      createdAt: group.createdAt,
      members,
      me,
    };
  }
}
