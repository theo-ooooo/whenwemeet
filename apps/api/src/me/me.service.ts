import { Injectable } from '@nestjs/common';
import { KakaoClient } from '../auth/kakao.client.js';
import { ApiException } from '../common/errors.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { AccountCleanupPlan, UsersRepository } from '../users/users.repository.js';

@Injectable()
export class MeService {
  constructor(
    private readonly users: UsersRepository,
    private readonly membershipsRepo: MembershipsRepository,
    private readonly kakao: KakaoClient,
  ) {}

  /**
   * 회원 탈퇴 (api.md 2.7, 결정기록 D-24).
   * 1. 카카오 unlink. 실패하면 502 를 돌려주고 DB 는 건드리지 않는다
   * 2. 한 트랜잭션: PERSONAL 팀 삭제 → TEAM 멤버십마다 나가기 → User 삭제 (FK SetNull 로 "탈퇴한 멤버")
   */
  async deleteAccount(userId: string): Promise<{ ok: true }> {
    const user = await this.users.findKakaoId(userId);
    if (!user) throw new ApiException('UNAUTHORIZED');

    // 개발 전용 사용자(kakaoId 음수) 는 카카오에 연결된 적이 없다 (결정기록 D-29)
    if (user.kakaoId >= 0n) await this.kakao.unlink(user.kakaoId);

    const plan: AccountCleanupPlan = { deleteGroupIds: [], leave: [] };
    for (const membership of await this.membershipsRepo.listByUserWithGroupType(userId)) {
      if (membership.groupType === 'PERSONAL') plan.deleteGroupIds.push(membership.groupId);
      else plan.leave.push({ membershipId: membership.id, groupId: membership.groupId });
    }
    await this.users.deleteAccountTx(userId, plan);
    return { ok: true };
  }
}
