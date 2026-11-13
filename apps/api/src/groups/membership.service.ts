import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/errors.js';
import { deriveKey } from '../email-login/email-crypto.js';
import { MemberResolver, MemberWithJoin, toMember } from '../common/member.js';
import { MembershipsRepository, MembershipWithUser } from '../memberships/memberships.repository.js';
import { GroupsRepository } from './groups.repository.js';
import { INVITE_MARKER_KEY_INFO, inviteMarker, matchInviteMarker } from './invite-marker.js';

export interface GroupDetail {
  id: number;
  type: 'PERSONAL' | 'TEAM';
  name: string;
  inviteCode: string | null;
  inviteUrl: string | null;
  /** (#196) inviteUrl + `?by=<요청자 표식>` (D-157). 코드가 없으면 null */
  inviteShareUrl: string | null;
  /** (#311) 주소용 공개 코드 (`?team=`). 초대 권한 없음 */
  publicCode: string;
  createdAt: Date;
  members: MemberWithJoin[];
  /**
   * notify: (#188) 나 자신의 "이 팀 알림 받기", showBirthday: (#305) "이 팀 달력에 내 생일 보이기".
   * 다른 멤버의 값은 싣지 않는다
   */
  me: MemberWithJoin & { notify: boolean; showBirthday: boolean };
}

/** 멤버십 확인과 멤버 목록. 모든 그룹 자원 서비스가 첫 줄에서 `assertMember` 를 부른다 */
@Injectable()
export class MembershipService {
  /** (#196) 보낸 사람 표식 키. JWT_SECRET 에서 파생 (D-157), 처음 쓸 때 만든다 */
  private markerKey: Buffer | null = null;

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

  /** (#311) 멤버인지만. 공개 코드 조회처럼 403 대신 404 로 답해야 할 때 */
  async isMember(userId: number, groupId: number): Promise<boolean> {
    return (await this.membershipsRepo.findByUserAndGroup(userId, groupId)) !== null;
  }

  /** (#199) 내가 속한 팀 (번호, 이름, 공개 코드), 가입순. 일정 검색의 팀 범위 */
  async listGroupsOf(userId: number): Promise<{ id: number; name: string; publicCode: string }[]> {
    const rows = await this.membershipsRepo.listForUserWithGroup(userId);
    return rows.map(({ group }) => ({ id: group.id, name: group.name, publicCode: group.publicCode }));
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

  /** (#196) 이 사용자가 보내는 초대 주소. 코드가 없으면 null */
  inviteShareUrl(inviteCode: string | null, groupId: number, userId: number): string | null {
    const url = this.inviteUrl(inviteCode);
    return url && `${url}?by=${inviteMarker(this.key(), groupId, userId)}`;
  }

  /** (#196) by 와 맞는 멤버의 userId. 틀리면 null */
  matchInviter(groupId: number, memberUserIds: readonly number[], by: unknown): number | null {
    return matchInviteMarker(this.key(), groupId, memberUserIds, by);
  }

  private key(): Buffer {
    this.markerKey ??= deriveKey(this.config.getOrThrow<string>('JWT_SECRET'), INVITE_MARKER_KEY_INFO);
    return this.markerKey;
  }

  /** GroupDetail 조립. 호출 전에 멤버십이 확인돼 있어야 한다 */
  async groupDetail(groupId: number, userId: number): Promise<GroupDetail> {
    const group = await this.groupsRepo.findById(groupId);
    if (!group) throw new ApiException('NOT_FOUND', '팀을 찾을 수 없어요');
    const rows = await this.listMembers(groupId);
    const members = rows.map(toMember);
    const me = members.find((member) => member.userId === userId);
    const myRow = rows.find((row) => row.userId === userId);
    if (!me || !myRow) throw new ApiException('FORBIDDEN');
    return {
      id: group.id,
      type: group.type,
      name: group.name,
      inviteCode: group.inviteCode,
      inviteUrl: this.inviteUrl(group.inviteCode),
      inviteShareUrl: this.inviteShareUrl(group.inviteCode, group.id, userId),
      publicCode: group.publicCode,
      createdAt: group.createdAt,
      members,
      me: { ...me, notify: myRow.notify, showBirthday: myRow.showBirthday },
    };
  }
}
