import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { ApiException } from '../common/errors.js';
import { AuthProviders } from '../auth/providers/auth-providers.js';
import { AvatarsService } from '../avatars/avatars.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { AccountCleanupPlan, type StartCalendarRow, UsersRepository } from '../users/users.repository.js';
import type { UpdateStartCalendarDto } from './dto/update-start-calendar.dto.js';

/** (#300) GET /me, PATCH /me/start-calendar 응답의 처음 여는 달력. groupId 는 GROUP 일 때만 값 */
export type StartCalendar = StartCalendarRow;

/** (#300) GET /me 응답 */
export type MeProfile = AuthUser & { startCalendar: StartCalendar };

const LAST: StartCalendar = { mode: 'LAST', groupId: null };

/** 저장값을 응답 값으로. GROUP 인데 팀이 없으면(FK SetNull) LAST, GROUP 이 아니면 groupId 는 null (D-192) */
function toStartCalendar(row: StartCalendarRow | null): StartCalendar {
  if (!row) return LAST;
  if (row.mode === 'GROUP') return row.groupId === null ? LAST : row;
  return { mode: row.mode, groupId: null };
}

function invalid(field: string, message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', message, [{ field, message }]);
}

@Injectable()
export class MeService {
  constructor(
    private readonly users: UsersRepository,
    private readonly membershipsRepo: MembershipsRepository,
    private readonly providers: AuthProviders,
    private readonly avatars: AvatarsService,
  ) {}

  /** GET /me (#300). 가드가 읽은 사용자 + 처음 여는 달력 */
  async getProfile(user: AuthUser): Promise<MeProfile> {
    return { ...user, startCalendar: toStartCalendar(await this.users.findStartCalendar(user.id)) };
  }

  /**
   * PATCH /me/start-calendar (#300, D-191).
   * 짝: GROUP 이면 groupId 필수, LAST 와 PERSONAL 은 groupId 없음 또는 null (아니면 400 VALIDATION_FAILED).
   * GROUP 은 내 팀이어야 하고(아니면 403 FORBIDDEN, 없는 팀도 같다) 개인 팀은 PERSONAL 로 고른다 (400)
   */
  async updateStartCalendar(userId: number, dto: UpdateStartCalendarDto): Promise<StartCalendar> {
    const groupId = dto.groupId ?? null;
    if (dto.mode !== 'GROUP') {
      if (groupId !== null) throw invalid('groupId', '팀을 고를 때만 팀 ID 를 보내 주세요');
      return toStartCalendar(await this.users.updateStartCalendar(userId, { mode: dto.mode, groupId: null }));
    }
    if (groupId === null) throw invalid('groupId', '고정할 팀을 골라 주세요');
    const membership = (await this.membershipsRepo.listByUserWithGroupType(userId)).find((row) => row.groupId === groupId);
    if (!membership) throw new ApiException('FORBIDDEN');
    if (membership.groupType === 'PERSONAL') throw invalid('groupId', '내 달력은 "내 달력" 으로 골라 주세요');
    return toStartCalendar(await this.users.updateStartCalendar(userId, { mode: 'GROUP', groupId }));
  }

  /** PATCH /me. DTO 가 trim 과 1~20자를 검사한 값 */
  updateNickname(userId: number, nickname: string): Promise<AuthUser> {
    return this.users.updateNickname(userId, nickname);
  }

  /**
   * 회원 탈퇴 (api.md 2.7, 결정기록 D-24).
   * 1. 연결된 AuthAccount 마다 제공자별 unlink (D-34, 애플은 토큰 폐기 앱.md 3.5). 하나라도 실패하면 502 를 돌려주고 DB 는 건드리지 않는다
   *    (DEV 는 할 일이 없다. 이미 끊긴 계정은 제공자가 성공으로 처리하므로 재시도해도 안전)
   * 2. 저장소에서 내 파일 객체 전부 삭제 (실패는 로그만, api.md `DELETE /me`)
   * 3. 한 트랜잭션: PERSONAL 팀 삭제 → TEAM 멤버십마다 나가기 → File 행 삭제 → AuthAccount 삭제 → User 삭제 (FK SetNull 로 "탈퇴한 멤버")
   */
  async deleteAccount(userId: number): Promise<{ ok: true }> {
    for (const account of await this.users.listAuthAccounts(userId)) {
      await this.providers.get(account.provider).unlink(account);
    }

    await this.avatars.purgeObjects(userId);

    const plan: AccountCleanupPlan = { deleteGroupIds: [], leave: [] };
    for (const membership of await this.membershipsRepo.listByUserWithGroupType(userId)) {
      if (membership.groupType === 'PERSONAL') plan.deleteGroupIds.push(membership.groupId);
      else plan.leave.push({ membershipId: membership.id, groupId: membership.groupId });
    }
    await this.users.deleteAccountTx(userId, plan);
    return { ok: true };
  }
}
