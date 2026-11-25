import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import type { ReportTargetType } from '../generated/prisma/enums.js';
import { type AdminUserRow, UsersRepository } from '../users/users.repository.js';
import { AdminActionsRepository } from './admin-actions.repository.js';
import { type AdminEventDetail, type AdminGroupDetail, type AdminGroupRow, AdminModerationRepository } from './admin-moderation.repository.js';
import { type AdminReportGroup, type AdminReportRow, AdminReportsRepository, type ReportListQuery } from './admin-reports.repository.js';

/**
 * (#536) 신고 대상 미리 보기. 팀과 일정은 관리자 팀, 일정 상세와 같은 모양이라 화면이 숨기기, 삭제를 그대로 쓴다.
 * 사용자는 정지 기능이 없어 그 사람이 속한 팀을 보이고 팀 숨기기로 이어 준다. 지워진 대상은 null
 */
export type ReportTargetDetail =
  | { type: 'group'; group: AdminGroupDetail }
  | { type: 'event'; event: AdminEventDetail }
  | { type: 'user'; user: AdminUserRow; teams: AdminGroupRow[] };

/** GET /admin/reports/targets/:targetType/:targetId */
export interface AdminReportTarget {
  targetType: ReportTargetType;
  targetId: number;
  target: ReportTargetDetail | null;
  openCount: number;
  /** 최근 것부터 100건 */
  reports: AdminReportRow[];
}

const REPORT_NOT_FOUND = '신고를 찾을 수 없어요';

/**
 * (#536) 관리자 신고 탭 (api.md 2.18, D-289). 처리 완료와 기각은 신고 한 건이 아니라 그 대상의 접수 중 신고 전부를 닫고 조치 기록 한 줄.
 * 팀, 일정 숨기기와 삭제(AdminModerationService)도 그 대상의 접수 중 신고를 처리 완료로 닫는다(closeForModeration)
 */
@Injectable()
export class AdminReportsService {
  constructor(
    private readonly repo: AdminReportsRepository,
    private readonly moderation: AdminModerationRepository,
    private readonly users: UsersRepository,
    private readonly actions: AdminActionsRepository,
  ) {}

  list(query: ReportListQuery): Promise<{ items: AdminReportGroup[]; nextCursor: number | null }> {
    return this.repo.listGroups(query);
  }

  /** 탭 배지: 접수 중 신고가 있는 대상 수 */
  async openCount(): Promise<{ openTargets: number }> {
    return { openTargets: await this.repo.countOpenTargets() };
  }

  async target(targetType: ReportTargetType, targetId: number): Promise<AdminReportTarget> {
    const [reports, target] = await Promise.all([this.repo.listOfTarget({ targetType, targetId }), this.preview(targetType, targetId)]);
    if (reports.length === 0) throw new ApiException('NOT_FOUND', REPORT_NOT_FOUND);
    return { targetType, targetId, target, openCount: reports.filter((r) => r.status === 'open').length, reports };
  }

  /** POST /admin/reports/:id/resolve. 그 대상의 접수 중 신고를 모두 처리 완료로. 이미 다 닫혔으면 바꾸지 않고 상세만 */
  resolve(adminId: number, reportId: number, resolution: string, now = new Date()): Promise<AdminReportTarget> {
    return this.close(adminId, reportId, 'resolved', resolution, now);
  }

  /** POST /admin/reports/:id/dismiss. 조치하지 않고 닫는다(메모 선택) */
  dismiss(adminId: number, reportId: number, resolution: string | null, now = new Date()): Promise<AdminReportTarget> {
    return this.close(adminId, reportId, 'dismissed', resolution, now);
  }

  private async close(adminId: number, reportId: number, status: 'resolved' | 'dismissed', resolution: string | null, now: Date): Promise<AdminReportTarget> {
    const target = await this.repo.findTargetOf(reportId);
    if (!target) throw new ApiException('NOT_FOUND', REPORT_NOT_FOUND);
    const closed = await this.repo.closeOpen({ ...target, status, adminId, resolution, at: now });
    if (closed > 0) {
      await this.actions.record({ adminId, action: status === 'resolved' ? 'report_resolve' : 'report_dismiss', ...target, reason: resolution });
    }
    return this.target(target.targetType, target.targetId);
  }

  private async preview(type: ReportTargetType, id: number): Promise<ReportTargetDetail | null> {
    if (type === 'group') {
      const group = await this.moderation.findGroup(id);
      return group && { type, group };
    }
    if (type === 'event') {
      const event = await this.moderation.findEvent(id);
      return event && { type, event };
    }
    const [user, teams] = await Promise.all([this.users.findForAdmin(id), this.moderation.listGroupsOfUser(id)]);
    return user && { type, user, teams: teams.filter((t) => t.type === 'TEAM') };
  }
}
