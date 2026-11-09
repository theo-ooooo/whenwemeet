import { Injectable } from '@nestjs/common';
import type { AuthProvider, RawProfile } from '../auth/providers/auth-provider.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const USER_SELECT = { id: true, nickname: true, profileImageUrl: true, createdAt: true } as const;

/** 응답과 request.user 에 쓰는 사용자 요약 */
export interface UserSummary {
  id: number;
  nickname: string;
  profileImageUrl: string | null;
  createdAt: Date;
}

/** 가입 시 만들 사용자와 연결 계정 */
export interface NewAccountInput {
  provider: AuthProvider;
  providerUserId: string;
  email: string | null;
  rawProfile: RawProfile;
  nickname: string;
  profileImageUrl: string | null;
}

/** 탈퇴 시 제공자별 unlink 대상 */
export interface AuthAccountRef {
  provider: AuthProvider;
  providerUserId: string;
}

/** 탈퇴 시 지울 것. Service 가 멤버십 목록을 보고 정한다 */
export interface AccountCleanupPlan {
  /** 통째로 지울 팀 (PERSONAL) */
  deleteGroupIds: number[];
  /** 나가기 처리할 TEAM 멤버십 */
  leave: { membershipId: number; groupId: number }[];
}

@Injectable()
export class UsersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsRepository,
  ) {}

  findById(id: number): Promise<UserSummary | null> {
    return this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  }

  /** (provider, providerUserId) 로 연결 계정 하나 */
  findAuthAccount(provider: AuthProvider, providerUserId: string): Promise<{ id: number } | null> {
    return this.prisma.authAccount.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
      select: { id: true },
    });
  }

  /** 재로그인 시 제공자 원본 프로필만 갱신하고 연결된 사용자를 돌려준다. User 의 닉네임/사진은 건드리지 않는다 (D-36) */
  async updateRawProfile(authAccountId: number, rawProfile: RawProfile): Promise<UserSummary> {
    const account = await this.prisma.authAccount.update({
      where: { id: authAccountId },
      data: { rawProfile },
      select: { user: { select: USER_SELECT } },
    });
    return account.user;
  }

  listAuthAccounts(userId: number): Promise<AuthAccountRef[]> {
    return this.prisma.authAccount.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { provider: true, providerUserId: true },
    });
  }

  /** 사용자 + 연결 계정 + PERSONAL 팀 + 첫 멤버십을 한 트랜잭션으로 */
  createWithAccountTx(input: NewAccountInput, personalGroup: { name: string; color: string }): Promise<UserSummary> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          nickname: input.nickname,
          profileImageUrl: input.profileImageUrl,
          authAccounts: {
            create: {
              provider: input.provider,
              providerUserId: input.providerUserId,
              email: input.email,
              rawProfile: input.rawProfile,
            },
          },
        },
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

  /** 팀 삭제 → 멤버십마다 나가기 → 연결 계정 삭제 → User 삭제 (FK SetNull 로 "탈퇴한 멤버") 를 한 트랜잭션으로 */
  async deleteAccountTx(userId: number, plan: AccountCleanupPlan): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const groupId of plan.deleteGroupIds) {
        await tx.group.delete({ where: { id: groupId } });
      }
      for (const { membershipId, groupId } of plan.leave) {
        await this.memberships.removeWithGroupPrune(tx, membershipId, groupId);
      }
      await tx.authAccount.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
  }
}
