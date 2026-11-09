import { Injectable } from '@nestjs/common';
import { KakaoClient } from '../auth/kakao.client.js';
import { ApiException } from '../common/errors.js';
import { GroupsService } from '../groups/groups.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kakao: KakaoClient,
    private readonly groups: GroupsService,
  ) {}

  /**
   * 회원 탈퇴 (api.md 2.7, 결정기록 D-24).
   * 1. 카카오 unlink. 실패하면 502 를 돌려주고 DB 는 건드리지 않는다
   * 2. 한 트랜잭션: PERSONAL 팀 삭제 → TEAM 멤버십마다 나가기 → User 삭제 (FK SetNull 로 "탈퇴한 멤버")
   */
  async deleteAccount(userId: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { kakaoId: true } });
    if (!user) throw new ApiException('UNAUTHORIZED');

    // 개발 전용 사용자(kakaoId 음수) 는 카카오에 연결된 적이 없다 (결정기록 D-29)
    if (user.kakaoId >= 0n) await this.kakao.unlink(user.kakaoId);

    await this.prisma.$transaction(async (tx) => {
      const memberships = await tx.membership.findMany({
        where: { userId },
        select: { id: true, groupId: true, group: { select: { type: true } } },
      });
      for (const membership of memberships) {
        if (membership.group.type === 'PERSONAL') {
          await tx.group.delete({ where: { id: membership.groupId } });
        } else {
          await this.groups.removeMembership(tx, membership.id, membership.groupId);
        }
      }
      await tx.user.delete({ where: { id: userId } });
    });
    return { ok: true };
  }
}
