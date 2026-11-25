import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import type { PageQuery } from '../common/page-query.js';
import { type AdminUserRow, UsersRepository } from '../users/users.repository.js';
import { AdminActionsRepository } from './admin-actions.repository.js';
import { type AdminEventDetail, type AdminEventRow, type AdminGroupDetail, type AdminGroupRow, AdminModerationRepository } from './admin-moderation.repository.js';

const GROUP_NOT_FOUND = '팀을 찾을 수 없어요';
const EVENT_NOT_FOUND = '일정을 찾을 수 없어요';

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
  ) {}

  listGroups(query: PageQuery & { q: string | null }): Promise<{ items: AdminGroupRow[]; nextCursor: number | null }> {
    return this.repo.listGroups(query);
  }

  async group(id: number): Promise<AdminGroupDetail> {
    const row = await this.repo.findGroup(id);
    if (!row) throw new ApiException('NOT_FOUND', GROUP_NOT_FOUND);
    return row;
  }

  async hideGroup(adminId: number, id: number, reason: string, now = new Date()): Promise<AdminGroupDetail> {
    if (!(await this.repo.setGroupHidden(id, { reason, hiddenAt: now, hiddenById: adminId }))) throw new ApiException('NOT_FOUND', GROUP_NOT_FOUND);
    await this.actions.record({ adminId, action: 'group_hide', targetType: 'group', targetId: id, reason });
    return this.group(id);
  }

  async unhideGroup(adminId: number, id: number): Promise<AdminGroupDetail> {
    if (!(await this.repo.setGroupHidden(id, null))) throw new ApiException('NOT_FOUND', GROUP_NOT_FOUND);
    await this.actions.record({ adminId, action: 'group_unhide', targetType: 'group', targetId: id });
    return this.group(id);
  }

  /** 모든 멤버에게서 팀을 지운다. 기록의 reason 에 팀 이름을 남긴다(행이 사라지므로) */
  async deleteGroup(adminId: number, id: number): Promise<{ ok: true }> {
    const row = await this.repo.findGroup(id);
    if (!row || !(await this.repo.deleteGroupTx(id))) throw new ApiException('NOT_FOUND', GROUP_NOT_FOUND);
    await this.actions.record({ adminId, action: 'group_delete', targetType: 'group', targetId: id, reason: row.name.slice(0, 200) });
    return { ok: true };
  }

  listEvents(query: PageQuery & { q: string | null; groupId: number | null }): Promise<{ items: AdminEventRow[]; nextCursor: number | null }> {
    return this.repo.listEvents(query);
  }

  async event(id: number): Promise<AdminEventDetail> {
    const row = await this.repo.findEvent(id);
    if (!row) throw new ApiException('NOT_FOUND', EVENT_NOT_FOUND);
    return row;
  }

  async hideEvent(adminId: number, id: number, reason: string, now = new Date()): Promise<AdminEventDetail> {
    if (!(await this.repo.setEventHidden(id, { reason, hiddenAt: now, hiddenById: adminId }))) throw new ApiException('NOT_FOUND', EVENT_NOT_FOUND);
    await this.actions.record({ adminId, action: 'event_hide', targetType: 'event', targetId: id, reason });
    return this.event(id);
  }

  async unhideEvent(adminId: number, id: number): Promise<AdminEventDetail> {
    if (!(await this.repo.setEventHidden(id, null))) throw new ApiException('NOT_FOUND', EVENT_NOT_FOUND);
    await this.actions.record({ adminId, action: 'event_unhide', targetType: 'event', targetId: id });
    return this.event(id);
  }

  async deleteEvent(adminId: number, id: number): Promise<{ ok: true }> {
    const row = await this.repo.findEvent(id);
    if (!row || !(await this.repo.deleteEvent(id))) throw new ApiException('NOT_FOUND', EVENT_NOT_FOUND);
    await this.actions.record({ adminId, action: 'event_delete', targetType: 'event', targetId: id, reason: row.title.slice(0, 200) });
    return { ok: true };
  }

  /** GET /admin/users/:id. 사용자와 속한 팀 */
  async user(id: number): Promise<{ user: AdminUserRow; teams: AdminGroupRow[] }> {
    const user = await this.users.findForAdmin(id);
    if (!user) throw new ApiException('NOT_FOUND', '사용자를 찾을 수 없어요');
    return { user, teams: await this.repo.listGroupsOfUser(id) };
  }
}
