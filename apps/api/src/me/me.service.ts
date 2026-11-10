import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { AuthProviders } from '../auth/providers/auth-providers.js';
import { AvatarsService } from '../avatars/avatars.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { AccountCleanupPlan, UsersRepository } from '../users/users.repository.js';

@Injectable()
export class MeService {
  constructor(
    private readonly users: UsersRepository,
    private readonly membershipsRepo: MembershipsRepository,
    private readonly providers: AuthProviders,
    private readonly avatars: AvatarsService,
  ) {}

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
