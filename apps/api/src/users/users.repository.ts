import { Injectable } from '@nestjs/common';
import type { BirthdayReminderColumns } from '../anniversaries/birthdays.js';
import type { AuthProvider, LinkedAccount, ProviderCredentials, RawProfile } from '../auth/providers/auth-provider.js';
import { FILE_LOCATION_SELECT, FileUrlBuilder, type FileLocation } from '../files/file-url.builder.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** 사진은 File 의 provider/key 로 읽는다 (결정기록 D-38, D-56). 밖으로는 `toUserSummary` 로 `profileImageUrl` 로 바꿔 내보낸다 */
export const USER_SELECT = { id: true, nickname: true, avatar: { select: FILE_LOCATION_SELECT }, createdAt: true } as const;

/** 응답과 request.user 에 쓰는 사용자 요약 */
export interface UserSummary {
  id: number;
  nickname: string;
  profileImageUrl: string | null;
  createdAt: Date;
}

interface UserRecord {
  id: number;
  nickname: string;
  avatar: FileLocation | null;
  createdAt: Date;
}

function toUserSummary(record: UserRecord, urls: FileUrlBuilder): UserSummary {
  return { id: record.id, nickname: record.nickname, profileImageUrl: urls.publicUrlOrNull(record.avatar), createdAt: record.createdAt };
}

/** (#300) 처음 여는 달력 (D-191). LAST 마지막에 본 달력, PERSONAL 내 달력, GROUP 고정한 팀 */
const BIRTHDAY_SELECT = { birthday: true, birthdayRemindDayOf: true, birthdayRemindDayBefore: true, birthdayRemindWeekBefore: true } as const;

/** (#305) User 의 생일 칸 */
export interface BirthdayRow extends BirthdayReminderColumns {
  /** 'MM-DD'. 없으면 null */
  birthday: string | null;
}

export const START_CALENDAR_MODES = ['LAST', 'PERSONAL', 'GROUP'] as const;
export type StartCalendarMode = (typeof START_CALENDAR_MODES)[number];

/** (#300) 저장된 그대로의 처음 여는 달력. GROUP 인데 groupId 가 null 인 행(FK SetNull)은 Service 가 LAST 로 읽는다 */
export interface StartCalendarRow {
  mode: StartCalendarMode;
  groupId: number | null;
}

/** 가입 시 만들 사용자와 연결 계정. 소셜 프로필 사진은 가입 뒤 R2 로 따로 복사한다 (AvatarsService.importFromUrl) */
export interface NewAccountInput {
  provider: AuthProvider;
  providerUserId: string;
  email: string | null;
  /** 이메일 계정(#245)은 원본 프로필이 없어 null (컬럼 NULL 로 둔다) */
  rawProfile: RawProfile | null;
  nickname: string;
  /** 애플 토큰 폐기용 (D-51). 없으면 null 로 둔다 */
  credentials?: ProviderCredentials;
}

/** 탈퇴 시 제공자별 unlink 대상 (애플은 폐기용 client_id 와 refresh token 포함) */
export interface AuthAccountRef extends LinkedAccount {
  provider: AuthProvider;
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
    private readonly urls: FileUrlBuilder,
  ) {}

  async findById(id: number): Promise<UserSummary | null> {
    const record = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    return record && toUserSummary(record, this.urls);
  }

  /** 닉네임 변경 (D-36). 우리 서비스 값이라 소셜 프로필과 독립 */
  async updateNickname(id: number, nickname: string): Promise<UserSummary> {
    return toUserSummary(await this.prisma.user.update({ where: { id }, data: { nickname }, select: USER_SELECT }), this.urls);
  }

  /** (#300) 처음 여는 달력. 사용자가 없으면 null */
  async findStartCalendar(id: number): Promise<StartCalendarRow | null> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: { startCalendarMode: true, startGroupId: true } });
    return row && { mode: row.startCalendarMode, groupId: row.startGroupId };
  }

  /** (#300) 처음 여는 달력 저장. 짝 검사와 멤버십 확인은 Service 가 끝낸 값 */
  async updateStartCalendar(id: number, value: StartCalendarRow): Promise<StartCalendarRow> {
    const row = await this.prisma.user.update({
      where: { id },
      data: { startCalendarMode: value.mode, startGroupId: value.groupId },
      select: { startCalendarMode: true, startGroupId: true },
    });
    return { mode: row.startCalendarMode, groupId: row.startGroupId };
  }

  /** (#305) 내 생일과 팀원에게 알리는 시점. 사용자가 없으면 null */
  async findBirthday(id: number): Promise<BirthdayRow | null> {
    return this.prisma.user.findUnique({ where: { id }, select: BIRTHDAY_SELECT });
  }

  /** (#305) 내 생일 저장. birthday null 이면 지운다 (알림 칸은 그대로 두어 다시 넣을 때 이어 쓴다) */
  async updateBirthday(id: number, data: Partial<BirthdayRow>): Promise<BirthdayRow> {
    return this.prisma.user.update({ where: { id }, data, select: BIRTHDAY_SELECT });
  }

  /** (#188) 앱 로그인(handoff 교환) 성공 시각. 권한 허용률 지표의 분모 (D-97) */
  async markAppLogin(id: number, at: Date): Promise<void> {
    await this.prisma.user.updateMany({ where: { id }, data: { lastAppLoginAt: at } });
  }

  /** (provider, providerUserId) 로 연결 계정 하나 */
  findAuthAccount(provider: AuthProvider, providerUserId: string): Promise<{ id: number } | null> {
    return this.prisma.authAccount.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
      select: { id: true },
    });
  }

  /** (#245) (provider, providerUserId) 연결 계정의 사용자 ID. 이메일 로그인이 기존 계정인지 가를 때 쓴다 */
  async findUserIdByAccount(provider: AuthProvider, providerUserId: string): Promise<number | null> {
    const account = await this.prisma.authAccount.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
      select: { userId: true },
    });
    return account?.userId ?? null;
  }

  /**
   * 재로그인 시 제공자 원본 프로필(과 애플이면 새 refresh token) 만 갱신하고 연결된 사용자를 돌려준다.
   * User 의 닉네임/사진은 건드리지 않는다 (D-36)
   */
  async updateRawProfile(authAccountId: number, rawProfile: RawProfile, credentials?: ProviderCredentials): Promise<UserSummary> {
    const account = await this.prisma.authAccount.update({
      where: { id: authAccountId },
      data: { rawProfile, ...credentials },
      select: { user: { select: USER_SELECT } },
    });
    return toUserSummary(account.user, this.urls);
  }

  listAuthAccounts(userId: number): Promise<AuthAccountRef[]> {
    return this.prisma.authAccount.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { provider: true, providerUserId: true, providerClientId: true, refreshToken: true },
    });
  }

  /** 사용자 + 연결 계정 + PERSONAL 팀 + 첫 멤버십을 한 트랜잭션으로 */
  createWithAccountTx(input: NewAccountInput, personalGroup: { name: string; color: string; publicCode: string }): Promise<UserSummary> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          nickname: input.nickname,
          authAccounts: {
            create: {
              provider: input.provider,
              providerUserId: input.providerUserId,
              email: input.email,
              ...(input.rawProfile === null ? {} : { rawProfile: input.rawProfile }),
              ...input.credentials,
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
          publicCode: personalGroup.publicCode,
          memberships: { create: { userId: user.id, color: personalGroup.color } },
        },
      });
      return toUserSummary(user, this.urls);
    });
  }

  /**
   * 팀 삭제 → 멤버십마다 나가기(남는 팀에는 탈퇴 기록 MEMBER_DELETED, #191) → 파일 행 삭제 → 이메일 로그인 발송 기록 삭제(#245, 이메일-로그인.md 8-1) → 연결 계정 삭제 → User 삭제
   * (FK SetNull 로 "탈퇴한 멤버") 를 한 트랜잭션으로.
   * 파일 객체는 Service 가 이 호출 전에 저장소에서 지운다
   */
  async deleteAccountTx(userId: number, plan: AccountCleanupPlan): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const groupId of plan.deleteGroupIds) {
        await tx.group.delete({ where: { id: groupId } });
      }
      for (const { membershipId, groupId } of plan.leave) {
        await this.memberships.removeWithGroupPrune(tx, membershipId, groupId, 'MEMBER_DELETED');
      }
      await tx.file.deleteMany({ where: { ownerId: userId } });
      const emailAccounts = await tx.authAccount.findMany({ where: { userId, provider: 'EMAIL' }, select: { providerUserId: true } });
      if (emailAccounts.length > 0) {
        await tx.emailLoginChallenge.deleteMany({ where: { email: { in: emailAccounts.map((account) => account.providerUserId) } } });
      }
      await tx.authAccount.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
  }
}
