import { Injectable } from '@nestjs/common';
import { type AnniversaryReminder, type AnniversaryReminderFlags, DEFAULT_ANNIVERSARY_REMINDERS, flagsFromRows, REMINDER_ROWS_SELECT, rowsFromFlags, toReminderFlags } from '../anniversaries/anniversary-reminders.js';
import type { AuthProvider, LinkedAccount, ProviderCredentials, RawProfile } from '../auth/providers/auth-provider.js';
import { FILE_LOCATION_SELECT, FileUrlBuilder, type FileLocation } from '../files/file-url.builder.js';
import type { UserRole } from '../generated/prisma/enums.js';
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
const BIRTHDAY_SELECT = { birthday: true, birthdayReminders: REMINDER_ROWS_SELECT } as const;

/** (#305) 내 생일과 팀원에게 알리는 시점. (#369) 시점은 BirthdayReminder 행 (켜진 시점마다 하나, D-249) */
export interface BirthdayRow extends AnniversaryReminderFlags {
  /** 'MM-DD'. 없으면 null */
  birthday: string | null;
}

function toBirthdayRow(row: { birthday: string | null; birthdayReminders: { offset: AnniversaryReminder }[] }): BirthdayRow {
  return { birthday: row.birthday, ...flagsFromRows(row.birthdayReminders) };
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

/** (#515) 관리자 사용자 목록 한 줄. providers 는 연결된 로그인 방법(가입 순) */
export interface AdminUserRow {
  id: number;
  nickname: string;
  role: UserRole;
  /** (#523) 프로필 사진 공개 주소. 없으면 null (이니셜) */
  profileImageUrl: string | null;
  createdAt: Date;
  providers: AuthProvider[];
}

const ADMIN_USER_SELECT = {
  id: true,
  nickname: true,
  role: true,
  avatar: { select: FILE_LOCATION_SELECT },
  createdAt: true,
  authAccounts: { select: { provider: true }, orderBy: { id: 'asc' } },
} as const;

function toAdminUserRow(
  row: { id: number; nickname: string; role: UserRole; avatar: FileLocation | null; createdAt: Date; authAccounts: { provider: AuthProvider }[] },
  urls: FileUrlBuilder,
): AdminUserRow {
  return {
    id: row.id,
    nickname: row.nickname,
    role: row.role,
    profileImageUrl: urls.publicUrlOrNull(row.avatar),
    createdAt: row.createdAt,
    providers: row.authAccounts.map((account) => account.provider),
  };
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
  /** (#450) AI 비서 안내 동의 시각. 아직이면 null (D-270) */
  async findAssistantConsent(id: number): Promise<Date | null> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: { assistantConsentAt: true } });
    return row?.assistantConsentAt ?? null;
  }

  /** (#450) 동의 시각을 처음 한 번만 넣고 저장된 값을 돌려준다 (멱등. 이미 있으면 처음 값 그대로) */
  async recordAssistantConsent(id: number, at: Date): Promise<Date> {
    await this.prisma.user.updateMany({ where: { id, assistantConsentAt: null }, data: { assistantConsentAt: at } });
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { assistantConsentAt: true } });
    return row.assistantConsentAt ?? at;
  }

  async findBirthday(id: number): Promise<BirthdayRow | null> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: BIRTHDAY_SELECT });
    return row && toBirthdayRow(row);
  }

  /** (#305) 내 생일 저장. birthday null 이면 지운다 (알림 칸은 그대로 두어 다시 넣을 때 이어 쓴다) */
  async updateBirthday(id: number, data: { birthday: string | null; reminders?: AnniversaryReminderFlags }): Promise<BirthdayRow> {
    const row = await this.prisma.user.update({
      where: { id },
      data: {
        birthday: data.birthday,
        ...(data.reminders ? { birthdayReminders: { deleteMany: {}, create: rowsFromFlags(data.reminders) } } : {}),
      },
      select: BIRTHDAY_SELECT,
    });
    return toBirthdayRow(row);
  }

  /** (#515) 역할. 사용자가 없으면 null (D-285). 관리자 판정은 매 요청 이 값으로 한다 */
  async findRole(id: number): Promise<UserRole | null> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    return row?.role ?? null;
  }

  /** (#515) 역할 바꾸기. 없는 사용자면 null */
  async updateRole(id: number, role: UserRole): Promise<AdminUserRow | null> {
    const { count } = await this.prisma.user.updateMany({ where: { id }, data: { role } });
    if (count === 0) return null;
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: ADMIN_USER_SELECT });
    return toAdminUserRow(row, this.urls);
  }

  /** (#515) 관리자 사용자 상세 한 줄. 없으면 null */
  async findForAdmin(id: number): Promise<AdminUserRow | null> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: ADMIN_USER_SELECT });
    return row && toAdminUserRow(row, this.urls);
  }

  /** (#515) 공지 목록을 마지막으로 본 시각. 아직이거나 사용자가 없으면 null */
  async findNoticesSeenAt(id: number): Promise<Date | null> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: { noticesSeenAt: true } });
    return row?.noticesSeenAt ?? null;
  }

  /** (#515) 공지 목록을 본 시각 기록 */
  async markNoticesSeen(id: number, at: Date): Promise<Date> {
    await this.prisma.user.updateMany({ where: { id }, data: { noticesSeenAt: at } });
    return at;
  }

  /**
   * (#515) 관리자 사용자 목록. id 내림차순(최근 가입 먼저), q 는 닉네임 부분 일치, cursor 는 앞 페이지 마지막 id(그보다 작은 것부터).
   * limit + 1 개를 읽어 다음 페이지가 있는지 본다
   */
  async listForAdmin(query: { q: string | null; limit: number; cursor: number | null }): Promise<{ items: AdminUserRow[]; nextCursor: number | null }> {
    const rows = await this.prisma.user.findMany({
      where: {
        ...(query.q ? { nickname: { contains: query.q } } : {}),
        ...(query.cursor !== null ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      select: ADMIN_USER_SELECT,
    });
    const page = rows.slice(0, query.limit).map((row) => toAdminUserRow(row, this.urls));
    return { items: page, nextCursor: rows.length > query.limit ? page[page.length - 1].id : null };
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
          // (#369) 내 생일 알림 시점의 기본(당일만, D-232). 생일을 넣기 전에도 저장해 두고 PATCH /me/birthday 가 바꾼다
          birthdayReminders: { create: rowsFromFlags(toReminderFlags(DEFAULT_ANNIVERSARY_REMINDERS)) },
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
      // (#198) 내가 요청한 이메일 연결 메일 행 (다른 주소일 수 있다)
      await tx.emailLoginChallenge.deleteMany({ where: { purpose: 'LINK', userId } });
      await tx.authAccount.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
  }
}
