import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import type { CreateReportDto } from './dto/report.dto.js';
import { type ReportReceipt, ReportsRepository } from './reports.repository.js';

/** (#536) 내가 볼 수 없는 대상은 있는지도 알리지 않는다 (404) */
const NOT_FOUND = '신고할 대상을 찾을 수 없어요';

/** (#536) POST /reports 응답. duplicate 면 새로 만들지 않고 접수 중인 내 신고를 돌려준 것 (200) */
export type ReportResult = ReportReceipt & { duplicate: boolean };

/**
 * (#536) 신고하기 (api.md 2.18, D-289). 신고하는 사람이 볼 수 있는 대상만:
 * - group: 내가 멤버인 팀. 개인 달력은 내 것이라 403
 * - event: 내가 멤버인 팀의 보이는 일정. 내가 만든 일정은 403
 * - user: 나와 같은 팀에 있는 사람. 나 자신은 403
 * 하루 횟수는 요청 제한(report, 사용자당 하루 10번)이 센다
 */
@Injectable()
export class ReportsService {
  constructor(private readonly repo: ReportsRepository) {}

  async create(reporterId: number, dto: CreateReportDto): Promise<ReportResult> {
    await this.assertReportable(reporterId, dto.targetType, dto.targetId);
    const detail = dto.detail?.trim() ? dto.detail.trim() : null;
    const { report, duplicate } = await this.repo.createUnlessOpen({ reporterId, targetType: dto.targetType, targetId: dto.targetId, reason: dto.reason, detail });
    return { ...report, duplicate };
  }

  private async assertReportable(reporterId: number, targetType: CreateReportDto['targetType'], targetId: number): Promise<void> {
    if (targetType === 'group') {
      const type = await this.repo.findMemberGroupType(reporterId, targetId);
      if (type === null) throw new ApiException('NOT_FOUND', NOT_FOUND);
      if (type === 'PERSONAL') throw new ApiException('FORBIDDEN', '내 개인 달력은 신고할 수 없어요');
      return;
    }
    if (targetType === 'event') {
      const event = await this.repo.findVisibleEventCreator(reporterId, targetId);
      if (!event) throw new ApiException('NOT_FOUND', NOT_FOUND);
      if (event.creatorId === reporterId) throw new ApiException('FORBIDDEN', '내가 만든 일정은 신고할 수 없어요');
      return;
    }
    if (targetId === reporterId) throw new ApiException('FORBIDDEN', '나를 신고할 수는 없어요');
    if (!(await this.repo.sharesGroup(reporterId, targetId))) throw new ApiException('NOT_FOUND', NOT_FOUND);
  }
}
