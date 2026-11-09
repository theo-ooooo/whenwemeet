import { Injectable } from '@nestjs/common';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const USER_SELECT = { id: true, nickname: true, profileImageUrl: true, createdAt: true } as const;

/** 응답과 request.user 에 쓰는 사용자 요약 */
export interface UserSummary {
  id: string;
  nickname: string;
  profileImageUrl: string | null;
  createdAt: Date;
}

export interface UserProfileInput {
  nickname: string;
  profileImageUrl: string | null;
}

export interface KakaoUserInput extends UserProfileInput {
  kakaoId: bigint;
}

/** 탈퇴 시 지울 것. Service 가 멤버십 목록을 보고 정한다 */
export interface AccountCleanupPlan {
  /** 통째로 지울 팀 (PERSONAL) */
  deleteGroupIds: string[];
  /** 나가기 처리할 TEAM 멤버십 */
  leave: { membershipId: string; groupId: string }[];
}

@Injectable()
export class UsersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsRepository,
  ) {}

  findById(id: string): Promise<UserSummary | null> {
    return this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  }

  findByKakaoId(kakaoId: bigint): Promise<{ id: string } | null> {
    return this.prisma.user.findUnique({ where: { kakaoId }, select: { id: true } });
  }

  findKakaoId(id: string): Promise<{ kakaoId: bigint } | null> {
    return this.prisma.user.findUnique({ where: { id }, select: { kakaoId: true } });
  }

  /** 개발 전용 사용자(kakaoId 음수) 중 같은 닉네임, 가장 먼저 만든 것 */
  findDevUserByNickname(nickname: string): Promise<UserSummary | null> {
    return this.prisma.user.findFirst({
      where: { nickname, kakaoId: { lt: 0n } },
      select: USER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  updateProfile(id: string, profile: UserProfileInput): Promise<UserSummary> {
    return this.prisma.user.update({ where: { id }, data: profile, select: USER_SELECT });
  }

  /** 사용자 생성 + PERSONAL 팀 + 첫 멤버십을 한 트랜잭션으로 */
  createWithPersonalGroupTx(input: KakaoUserInput, personalGroup: { name: string; color: string }): Promise<UserSummary> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { kakaoId: input.kakaoId, nickname: input.nickname, profileImageUrl: input.profileImageUrl },
        select: USER_SELECT,
      });
      await tx.group.create({
        data: {
          type: 'PERSONAL',
          name: personalGroup.name,
          inviteCode: null,
          memberships: { create: { userId: user.id, color: personalGroup.color } },
        },
      });
      return user;
    });
  }

  /** 팀 삭제 → 멤버십마다 나가기 → User 삭제 (FK SetNull 로 "탈퇴한 멤버") 를 한 트랜잭션으로 */
  async deleteAccountTx(userId: string, plan: AccountCleanupPlan): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const groupId of plan.deleteGroupIds) {
        await tx.group.delete({ where: { id: groupId } });
      }
      for (const { membershipId, groupId } of plan.leave) {
        await this.memberships.removeWithGroupPrune(tx, membershipId, groupId);
      }
      await tx.user.delete({ where: { id: userId } });
    });
  }
}
