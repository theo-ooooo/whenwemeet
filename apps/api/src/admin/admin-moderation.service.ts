import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import type { GroupType } from '../generated/prisma/enums.js';
import type { PageQuery } from '../common/page-query.js';
import { NotificationPreferencesRepository } from '../notification-preferences/notification-preferences.repository.js';
import {
  type NotificationSettings,
  toNotificationSettings,
} from '../push/push-devices.repository.js';
import {
  type AdminUserRow,
  UsersRepository,
} from '../users/users.repository.js';
import { AdminActionsRepository } from './admin-actions.repository.js';
import {
  type AdminEventDetail,
  type AdminEventRow,
  type AdminGroupDetail,
  type AdminGroupRow,
  AdminModerationRepository,
  type AdminPushDevice,
} from './admin-moderation.repository.js';
import { AdminReportsRepository } from './admin-reports.repository.js';

const GROUP_NOT_FOUND = '팀을 찾을 수 없어요';
const EVENT_NOT_FOUND = '일정을 찾을 수 없어요';

/**
 * (#528) 관리자 사용자 상세의 알림 설정 (읽기 전용). settings 는 그 사람의 내 정보 > 알림 과 같은 모양(행이 없으면 기본값),
 * devices 는 푸시 기기 요약(종류, 앱 버전, 등록, 마지막 확인). 토큰은 싣지 않는다. 방해 금지 시간 같은 시각 설정은 없다(설계 3-4)
 */
export interface AdminUserNotifications {
  settings: NotificationSettings;
  devices: AdminPushDevice[];
}

/**
 * (#515) 관리자 팀, 일정 관리 (api.md 2.16, D-286). 숨기기는 사유 필수, 숨김 해제, 삭제. 바뀐 뒤 조치 기록 한 줄.
 * 관리자 확인은 컨트롤러의 AdminGuard
 */
@Injectable()
export class AdminModerationService {
  constructor(
    private readonly repo: AdminModerationRepository,
    private readonly users: UsersRepository,
    private readonly actions: AdminActionsRepository,
    private readonly preferences: NotificationPreferencesRepository,
    private readonly reports: AdminReportsRepository,
  ) {}

  /**
   * (#536) 숨기거나 지운 대상의 접수 중 신고를 처리 완료로 닫는다(D-289). 신고 탭에서 숨겨도, 팀, 일정 탭에서 숨겨도 같다.
   * 닫은 신고가 있으면 조치 기록 report_resolve 한 줄 (메모 = "숨김: 사유" 또는 "삭제")
   */
  private async closeReports(
    adminId: number,
    targetType: 'group' | 'event',
    targetId: number,
    resolution: string,
    at: Date,
  ): Promise<void> {
    const note = resolution.slice(0, 200);
    const closed = await this.reports.closeOpen({
      targetType,
      targetId,
      status: 'resolved',
      adminId,
      resolution: note,
      at,
    });
    if (closed > 0)
      await this.actions.record({
        adminId,
        action: 'report_resolve',
        targetType,
        targetId,
        reason: note,
      });
  }

  listGroups(
    query: PageQuery & { q: string | null; type: GroupType | null },
  ): Promise<{ items: AdminGroupRow[]; nextCursor: number | null }> {
    return this.repo.listGroups(query);
  }

  async group(id: number): Promise<AdminGroupDetail> {
    const row = await this.repo.findGroup(id);
    if (!row) throw new ApiException('NOT_FOUND', GROUP_NOT_FOUND);
    return row;
  }

  async hideGroup(
    adminId: number,
    id: number,
    reason: string,
    now = new Date(),
  ): Promise<AdminGroupDetail> {
    if (
      !(await this.repo.setGroupHidden(id, {
        reason,
        hiddenAt: now,
        hiddenById: adminId,
      }))
    )
      throw new ApiException('NOT_FOUND', GROUP_NOT_FOUND);
    await this.actions.record({
      adminId,
      action: 'group_hide',
      targetType: 'group',
      targetId: id,
      reason,
    });
    await this.closeReports(adminId, 'group', id, `숨김: ${reason}`, now);
    return this.group(id);
  }

  async unhideGroup(adminId: number, id: number): Promise<AdminGroupDetail> {
    if (!(await this.repo.setGroupHidden(id, null)))
      throw new ApiException('NOT_FOUND', GROUP_NOT_FOUND);
    await this.actions.record({
      adminId,
      action: 'group_unhide',
      targetType: 'group',
      targetId: id,
    });
    return this.group(id);
  }

  /** 모든 멤버에게서 팀을 지운다. 기록의 reason 에 팀 이름을 남긴다(행이 사라지므로) */
  async deleteGroup(adminId: number, id: number): Promise<{ ok: true }> {
    const row = await this.repo.findGroup(id);
    if (!row || !(await this.repo.deleteGroupTx(id)))
      throw new ApiException('NOT_FOUND', GROUP_NOT_FOUND);
    await this.actions.record({
      adminId,
      action: 'group_delete',
      targetType: 'group',
      targetId: id,
      reason: row.name.slice(0, 200),
    });
    await this.closeReports(adminId, 'group', id, '삭제', new Date());
    return { ok: true };
  }

  listEvents(
    query: PageQuery & { q: string | null; groupId: number | null },
  ): Promise<{ items: AdminEventRow[]; nextCursor: number | null }> {
    return this.repo.listEvents(query);
  }

  async event(id: number): Promise<AdminEventDetail> {
    const row = await this.repo.findEvent(id);
    if (!row) throw new ApiException('NOT_FOUND', EVENT_NOT_FOUND);
    return row;
  }

  async hideEvent(
    adminId: number,
    id: number,
    reason: string,
    now = new Date(),
  ): Promise<AdminEventDetail> {
    if (
      !(await this.repo.setEventHidden(id, {
        reason,
        hiddenAt: now,
        hiddenById: adminId,
      }))
    )
      throw new ApiException('NOT_FOUND', EVENT_NOT_FOUND);
    await this.actions.record({
      adminId,
      action: 'event_hide',
      targetType: 'event',
      targetId: id,
      reason,
    });
    await this.closeReports(adminId, 'event', id, `숨김: ${reason}`, now);
    return this.event(id);
  }

  async unhideEvent(adminId: number, id: number): Promise<AdminEventDetail> {
    if (!(await this.repo.setEventHidden(id, null)))
      throw new ApiException('NOT_FOUND', EVENT_NOT_FOUND);
    await this.actions.record({
      adminId,
      action: 'event_unhide',
      targetType: 'event',
      targetId: id,
    });
    return this.event(id);
  }

  async deleteEvent(adminId: number, id: number): Promise<{ ok: true }> {
    const row = await this.repo.findEvent(id);
    if (!row || !(await this.repo.deleteEvent(id)))
      throw new ApiException('NOT_FOUND', EVENT_NOT_FOUND);
    await this.actions.record({
      adminId,
      action: 'event_delete',
      targetType: 'event',
      targetId: id,
      reason: row.title.slice(0, 200),
    });
    await this.closeReports(adminId, 'event', id, '삭제', new Date());
    return { ok: true };
  }

  /** GET /admin/users/:id. 사용자와 속한 팀 */
  async user(id: number): Promise<{
    user: AdminUserRow;
    teams: AdminGroupRow[];
    notifications: AdminUserNotifications;
  }> {
    const user = await this.users.findForAdmin(id);
    if (!user) throw new ApiException('NOT_FOUND', '사용자를 찾을 수 없어요');
    const [teams, preferences, devices] = await Promise.all([
      this.repo.listGroupsOfUser(id),
      this.preferences.find(id),
      this.repo.listPushDevicesOfUser(id),
    ]);
    // 사용자를 방금 읽었으니 설정이 null 인 것은 그 사이 탈퇴한 경우뿐이다
    if (!preferences)
      throw new ApiException('NOT_FOUND', '사용자를 찾을 수 없어요');
    return {
      user,
      teams,
      notifications: { settings: toNotificationSettings(preferences), devices },
    };
  }
}
