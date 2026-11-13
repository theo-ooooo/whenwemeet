import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { MemberWithJoin, pickLeastUsedColor, toMember } from '../common/member.js';
import { generatePublicCode } from '../common/public-code.js';
import { EventLogsRepository } from '../event-logs/event-logs.repository.js';
import { snapshotName } from '../group-activities/activity.js';
import { GroupActivitiesRepository } from '../group-activities/group-activities.repository.js';
import { type JoinVia, type MembershipMeInput, MembershipsRepository } from '../memberships/memberships.repository.js';
import { unseenAfter } from '../news/news.service.js';
import { PushScheduler } from '../push/push.scheduler.js';
import type { UpdateMeDto } from './dto/group.dto.js';
import { GroupsRepository, InviteGroupRow } from './groups.repository.js';
import { generateInviteCode, isUniqueViolation, normalizeInviteCode } from './invite-code.js';
import { GroupDetail, MembershipService } from './membership.service.js';

/** (#196) 초대 미리보기 (api.md 2.2 InvitePreview, D-157, D-158) */
export interface InvitePreview {
  groupName: string;
  memberCount: number;
  inviter: { nickname: string } | null;
  isMember: boolean;
  /** isMember 일 때만. 비멤버에게 팀 id 를 주지 않는다 */
  groupId: number | null;
  /** (#311) isMember 일 때만. 웹이 `/calendar?team=<코드>` 로 간다 */
  groupCode: string | null;
}

export interface GroupSummary {
  id: number;
  type: 'PERSONAL' | 'TEAM';
  name: string;
  /** (#311) 주소용 공개 코드 (`?team=`) */
  publicCode: string;
  memberCount: number;
  me: { color: string; displayName: string };
  unreadNewsCount: number;
}

/** (#278, D-250) 팀 만들기 쓰임. 서버는 저장하지 않고 로그로만 센다 */
export const GROUP_PRESETS = ['two', 'family', 'friends', 'study'] as const;
export type GroupPreset = (typeof GROUP_PRESETS)[number];

/** 아는 쓰임이면 그 값, 아니면(없음, 모르는 값, 문자열 아님) null */
export function parseGroupPreset(raw: unknown): GroupPreset | null {
  return typeof raw === 'string' && (GROUP_PRESETS as readonly string[]).includes(raw) ? (raw as GroupPreset) : null;
}

/** 초대 코드 충돌 시 재생성 횟수 상한 (32^6 공간이라 사실상 1회에 끝난다) */
const INVITE_CODE_RETRIES = 5;

@Injectable()
export class GroupsService {
  private readonly logger = new Logger('Groups');

  constructor(
    private readonly groupsRepo: GroupsRepository,
    private readonly membershipsRepo: MembershipsRepository,
    private readonly eventLogs: EventLogsRepository,
    private readonly memberships: MembershipService,
    private readonly pushScheduler: PushScheduler,
    private readonly activities: GroupActivitiesRepository,
  ) {}

  /**
   * PERSONAL 먼저, 그다음 joinedAt 순. unreadNewsCount 는 팀마다 일정 기록 + 팀 활동 기록 count (결정기록 D-23, D-154).
   * (#297) 새 소식 목록과 같이 내가 들어오기 전 기록은 세지 않는다 (D-180)
   */
  async list(userId: number): Promise<GroupSummary[]> {
    const rows = await this.membershipsRepo.listForUserWithGroup(userId);
    rows.sort((a, b) => Number(b.group.type === 'PERSONAL') - Number(a.group.type === 'PERSONAL'));

    const summaries: GroupSummary[] = [];
    for (const row of rows) {
      const after = unseenAfter(row.lastSeenAt, row.joinedAt);
      // (#189) 투표로 정한 일정의 CREATED 로그는 새 소식에서 숨기므로(POLL_CLOSED 한 줄로 보인다) 그 수만큼 뺀다 (D-236)
      const unreadNewsCount =
        (await this.eventLogs.countUnseenByOthers(row.group.id, after, userId)) +
        (await this.activities.countUnseenByOthers(row.group.id, after, userId)) -
        (await this.activities.countUnseenPollClosedByOthers(row.group.id, after, userId));
      summaries.push({
        id: row.group.id,
        type: row.group.type,
        name: row.group.name,
        publicCode: row.group.publicCode,
        memberCount: row.group._count.memberships,
        me: { color: row.color, displayName: row.displayName ?? row.user.nickname },
        unreadNewsCount,
      });
    }
    return summaries;
  }

  /** TEAM 팀 생성. 요청자가 첫 멤버, 초대 코드 발급. (#278) preset 은 로그 한 줄만 (저장 안 함) */
  async create(userId: number, name: string, preset?: unknown): Promise<GroupDetail> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const group = await this.groupsRepo.createTeam({
          name,
          inviteCode: generateInviteCode(),
          publicCode: generatePublicCode(),
          firstMember: { userId, color: pickLeastUsedColor([]) },
        });
        const picked = parseGroupPreset(preset);
        if (picked) this.logger.log(`groups.create groupId=${group.id} preset=${picked}`);
        return await this.memberships.groupDetail(group.id, userId);
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= INVITE_CODE_RETRIES) throw error;
      }
    }
  }

  async detail(userId: number, groupId: number): Promise<GroupDetail> {
    await this.memberships.assertMember(userId, groupId);
    return this.memberships.groupDetail(groupId, userId);
  }

  /** 이름 변경. 실제로 바뀌면 새 소식에 남는다 (#191) */
  async rename(userId: number, groupId: number, name: string): Promise<GroupDetail> {
    const me = await this.memberships.assertMember(userId, groupId);
    await this.groupsRepo.renameWithActivityTx(groupId, name, { id: userId, name: snapshotName(me.displayName, me.user.nickname) });
    return this.memberships.groupDetail(groupId, userId);
  }

  /** 새 코드로 교체. 이전 코드와 (#274) 그 팀의 일정 공유 링크는 즉시 무효. PERSONAL 이면 GROUP_NOT_INVITABLE (결정기록 D-04, D-183) */
  async rotateInviteCode(
    userId: number,
    groupId: number,
  ): Promise<{ inviteCode: string; inviteUrl: string; inviteShareUrl: string }> {
    await this.memberships.assertMember(userId, groupId);
    const group = await this.groupsRepo.findType(groupId);
    if (!group) throw new ApiException('NOT_FOUND', '팀을 찾을 수 없어요');
    if (group.type === 'PERSONAL') throw new ApiException('GROUP_NOT_INVITABLE');

    for (let attempt = 0; ; attempt += 1) {
      const inviteCode = generateInviteCode();
      try {
        await this.groupsRepo.setInviteCodeTx(groupId, inviteCode);
        return {
          inviteCode,
          inviteUrl: this.memberships.inviteUrl(inviteCode)!,
          inviteShareUrl: this.memberships.inviteShareUrl(inviteCode, groupId, userId)!,
        };
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= INVITE_CODE_RETRIES) throw error;
      }
    }
  }

  /**
   * 로그인 전 미리보기 (결정기록 D-20). 팀 이름과 인원수.
   * (#196) by 가 현재 멤버의 표식이면 그 사람의 팀 표시 이름(D-157), 로그인한 사용자가 이미 멤버면 isMember + groupId (D-158).
   * 둘 다 없으면 멤버 목록을 읽지 않는다
   */
  async invitePreview(codeRaw: string, by?: unknown, viewerId: number | null = null): Promise<InvitePreview> {
    const group = await this.findByInviteCode(codeRaw);
    const preview: InvitePreview = { groupName: group.name, memberCount: group.memberCount, inviter: null, isMember: false, groupId: null, groupCode: null };
    if (by === undefined && viewerId === null) return preview;

    const members = await this.memberships.listMembers(group.id);
    const inviterId = by === undefined ? null : this.memberships.matchInviter(group.id, members.map((m) => m.userId), by);
    const inviter = members.find((m) => m.userId === inviterId);
    if (inviter) preview.inviter = { nickname: inviter.displayName ?? inviter.user.nickname };
    if (viewerId !== null && members.some((m) => m.userId === viewerId)) {
      preview.isMember = true;
      preview.groupId = group.id;
      preview.groupCode = group.publicCode;
    }
    return preview;
  }

  /** 코드로 참여. 이미 멤버면 같은 응답 (멱등, 결정기록 D-19). 색은 팀에서 가장 적게 쓰인 것 */
  async join(userId: number, codeRaw: string): Promise<GroupDetail> {
    const group = await this.findByInviteCode(codeRaw);
    return this.joinGroup(userId, group.id);
  }

  /**
   * 팀 합류 공통 단계. 초대 코드 합류와 (#274) 일정 링크 합류가 같이 쓴다 (D-185).
   * 멤버 색 배정(D-21), 합류 알림(PushKind.JOIN), 새 소식 기록은 멤버십 트랜잭션 안에서. 이미 멤버면 아무것도 남기지 않는다 (D-19)
   */
  async joinGroup(userId: number, groupId: number, via?: JoinVia): Promise<GroupDetail> {
    let joined = false;
    try {
      joined = await this.membershipsRepo.addMemberIfAbsentTx(userId, groupId, pickLeastUsedColor, via);
    } catch (error) {
      // 같은 링크를 동시에 두 번 눌러 멤버십이 먼저 생긴 경우도 멱등하게 성공
      if (!isUniqueViolation(error)) throw error;
    }
    // (#188) 합류 알림은 트랜잭션에서 예약됐다. 커밋 뒤 틱을 바로 한 번 깨운다 (D-91)
    if (joined) this.pushScheduler.kick();
    return this.memberships.groupDetail(groupId, userId);
  }

  /**
   * 내 색/표시 이름, 이 팀 알림 받기(#188), 이 팀 달력에 내 생일 보이기(#305). displayName null 은 닉네임으로 되돌림.
   * 응답에 내 notify, showBirthday 포함
   */
  async updateMe(userId: number, groupId: number, dto: UpdateMeDto): Promise<MemberWithJoin & { notify: boolean; showBirthday: boolean }> {
    const membership = await this.memberships.assertMember(userId, groupId);
    const data: MembershipMeInput = {};
    if (dto.color !== undefined) data.color = dto.color.toUpperCase();
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.notify !== undefined) data.notify = dto.notify;
    if (dto.showBirthday !== undefined) data.showBirthday = dto.showBirthday;
    const updated = await this.membershipsRepo.updateMe(membership.id, data);
    return { ...toMember(updated), notify: updated.notify, showBirthday: updated.showBirthday };
  }

  /** 팀 나가기 (api.md 2.7). 멤버십 확인 → PERSONAL 거부 → 삭제와 빈 팀 정리는 한 트랜잭션 */
  async leave(userId: number, groupId: number): Promise<{ groupDeleted: boolean }> {
    const membership = await this.memberships.assertMember(userId, groupId);
    const group = await this.groupsRepo.findType(groupId);
    if (!group) throw new ApiException('NOT_FOUND', '팀을 찾을 수 없어요');
    if (group.type === 'PERSONAL') throw new ApiException('GROUP_PERSONAL_LEAVE');
    return { groupDeleted: await this.membershipsRepo.leaveGroupTx(membership.id, groupId) };
  }

  private async findByInviteCode(codeRaw: string): Promise<InviteGroupRow> {
    const code = normalizeInviteCode(codeRaw);
    const group = code ? await this.groupsRepo.findByInviteCode(code) : null;
    if (!group) throw new ApiException('INVITE_NOT_FOUND');
    return group;
  }
}
