import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/errors.js';
import { MemberResolver, MemberWithJoin, toMember } from '../common/member.js';
import { MembershipsRepository, MembershipWithUser } from '../memberships/memberships.repository.js';
import { GroupsRepository } from './groups.repository.js';

export interface GroupDetail {
  id: number;
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
    private readonly membershipsRepo: MembershipsRepository,
    private readonly groupsRepo: GroupsRepository,
    private readonly config: ConfigService,
  ) {}

  /** 멤버가 아니면 403 FORBIDDEN. 팀이 없어도 멤버십이 없으므로 같은 403 */
  async assertMember(userId: number, groupId: number): Promise<MembershipWithUser> {
    const membership = await this.membershipsRepo.findByUserAndGroup(userId, groupId);
    if (!membership) throw new ApiException('FORBIDDEN');
    return membership;
  }

  async listMembers(groupId: number): Promise<MembershipWithUser[]> {
    return this.membershipsRepo.listByGroup(groupId);
  }

  async resolverFor(groupId: number): Promise<MemberResolver> {
    return new MemberResolver(await this.listMembers(groupId));
  }

  inviteUrl(inviteCode: string | null): string | null {
    if (!inviteCode) return null;
    return `${this.config.getOrThrow<string>('WEB_ORIGIN')}/join/${inviteCode}`;
  }

  /** GroupDetail 조립. 호출 전에 멤버십이 확인돼 있어야 한다 */
  async groupDetail(groupId: number, userId: number): Promise<GroupDetail> {
    const group = await this.groupsRepo.findById(groupId);
    if (!group) throw new ApiException('NOT_FOUND', '팀을 찾을 수 없어요');
    const members = (await this.listMembers(groupId)).map(toMember);
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
