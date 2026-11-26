import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { ApiException } from '../common/errors.js';
import { AssistantService } from '../assistant/assistant.service.js';
import { AuthProviders } from '../auth/providers/auth-providers.js';
import { AvatarsService } from '../avatars/avatars.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import type { CalendarType, UserRole } from '../generated/prisma/enums.js';
import { NoticesService } from '../notices/notices.service.js';
import { AccountCleanupPlan, type BirthdayRow, type StartCalendarRow, UsersRepository } from '../users/users.repository.js';
import { type AnniversaryReminder, DEFAULT_ANNIVERSARY_REMINDERS, fromReminderFlags, toReminderFlags } from '../anniversaries/anniversary-reminders.js';
import type { UpdateBirthdayDto } from './dto/update-birthday.dto.js';
import type { UpdateStartCalendarDto } from './dto/update-start-calendar.dto.js';

/** (#300) GET /me, PATCH /me/start-calendar 응답의 처음 여는 달력. groupId 는 GROUP 일 때만 값 */
export type StartCalendar = StartCalendarRow;

/** (#305) GET /me, PATCH /me/birthday 의 내 생일. date 'MM-DD' 또는 null(없음), reminders 는 팀원에게 알리는 시점 */
export interface BirthdaySettings {
  date: string | null;
  /** (#562) 달력 종류와 윤달 (D-297). 생일이 없으면 SOLAR, false */
  calendar: CalendarType;
  isLeapMonth: boolean;
  reminders: AnniversaryReminder[];
}

/** (#450) GET /me 의 AI 비서 상태 (D-270, D-271). available = 서버에 모델이 있음 (키 또는 가짜) */
export interface AssistantStatus {
  available: boolean;
  consented: boolean;
  dailyLimit: number;
  usedToday: number;
}

/** (#300) GET /me 응답. (#305) 내 생일. (#450) AI 비서. (#515) 역할, 관리자 여부, 안 본 공지가 있는지 (D-285) */
export type MeProfile = AuthUser & {
  startCalendar: StartCalendar;
  birthday: BirthdaySettings;
  assistant: AssistantStatus;
  role: UserRole;
  isAdmin: boolean;
  hasUnreadNotice: boolean;
  /** (#562) 달력 칸에 음력 날짜 보이기 (D-297) */
  showLunar: boolean;
};

const NO_BIRTHDAY: BirthdaySettings = { date: null, calendar: 'SOLAR', isLeapMonth: false, reminders: [...DEFAULT_ANNIVERSARY_REMINDERS] };

const LAST: StartCalendar = { mode: 'LAST', groupId: null };

/** 저장값을 응답 값으로. GROUP 인데 팀이 없으면(FK SetNull) LAST, GROUP 이 아니면 groupId 는 null (D-192) */
function toStartCalendar(row: StartCalendarRow | null): StartCalendar {
  if (!row) return LAST;
  if (row.mode === 'GROUP') return row.groupId === null ? LAST : row;
  return { mode: row.mode, groupId: null };
}

function toBirthdaySettings(row: BirthdayRow): BirthdaySettings {
  return { date: row.birthday, calendar: row.birthdayCalendar, isLeapMonth: row.birthdayLeapMonth, reminders: fromReminderFlags(row) };
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
    private readonly assistant: AssistantService,
    private readonly notices: NoticesService,
  ) {}

  /** GET /me (#300). 가드가 읽은 사용자 + 처음 여는 달력. (#450) AI 비서 상태. (#515) 역할(DB 값), 새 공지 */
  async getProfile(user: AuthUser): Promise<MeProfile> {
    const [start, birthday, assistant, role, hasUnreadNotice, showLunar] = await Promise.all([
      this.users.findStartCalendar(user.id),
      this.users.findBirthday(user.id),
      this.assistant.status(user.id),
      this.users.findRole(user.id),
      this.notices.hasUnread(user.id),
      this.users.findShowLunar(user.id),
    ]);
    const myRole: UserRole = role ?? 'user';
    return {
      ...user,
      startCalendar: toStartCalendar(start),
      birthday: birthday ? toBirthdaySettings(birthday) : NO_BIRTHDAY,
      assistant,
      role: myRole,
      isAdmin: myRole === 'admin',
      hasUnreadNotice,
      showLunar,
    };
  }

  /** (#562) PATCH /me/lunar-display. 달력 칸 음력 표시 켜기, 끄기 (D-297) */
  async updateLunarDisplay(userId: number, showLunar: boolean): Promise<{ showLunar: boolean }> {
    return { showLunar: await this.users.updateShowLunar(userId, showLunar) };
  }

  /** (#450) POST /me/assistant-consent. 멱등 (이미 했으면 처음 값 그대로, D-270) */
  consentAssistant(userId: number): Promise<{ consentedAt: Date }> {
    return this.assistant.consent(userId);
  }

  /**
   * PATCH /me/birthday (#305, D-230). 생일은 하나라 내가 속한 모든 팀(개인 팀 포함)에 같이 바뀐다.
   * 팀마다 보일지는 PATCH /groups/:id/me showBirthday. reminders 생략은 그대로
   */
  async updateBirthday(userId: number, dto: UpdateBirthdayDto): Promise<BirthdaySettings> {
    // (#562) 지우면 양력, 윤달 아님으로 되돌린다. 윤달은 음력일 때만
    const calendar = dto.date === null ? 'SOLAR' : (dto.calendar ?? 'SOLAR');
    if (dto.isLeapMonth === true && calendar !== 'LUNAR') throw invalid('isLeapMonth', '윤달은 음력 생일에만 고를 수 있어요');
    const row = await this.users.updateBirthday(userId, {
      birthday: dto.date,
      birthdayCalendar: calendar,
      birthdayLeapMonth: calendar === 'LUNAR' && dto.isLeapMonth === true,
      ...(dto.reminders !== undefined ? { reminders: toReminderFlags(dto.reminders) } : {}),
    });
    return toBirthdaySettings(row);
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
