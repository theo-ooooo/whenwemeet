import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiException } from '../common/errors.js';
import { IdParam } from '../common/id-param.js';
import { parsePageQuery } from '../common/page-query.js';
import type {
  ReportStatus,
  ReportTargetType,
} from '../generated/prisma/enums.js';
import {
  DismissReportDto,
  REPORT_TARGET_TYPES,
  ResolveReportDto,
} from '../reports/dto/report.dto.js';
import { AdminGuard } from './admin-access.js';
import { AdminReportsService } from './admin-reports.service.js';

const REPORT_STATUSES: readonly ReportStatus[] = [
  'open',
  'resolved',
  'dismissed',
];

function invalid(field: string, message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', message, [{ field, message }]);
}

/** `?status=` 원문. 없거나 빈 값이면 null(전체), open, resolved, dismissed 밖이면 400 */
function parseStatus(raw: unknown): ReportStatus | null {
  if (raw === undefined || raw === '') return null;
  if (
    typeof raw === 'string' &&
    (REPORT_STATUSES as readonly string[]).includes(raw)
  )
    return raw as ReportStatus;
  throw invalid(
    'status',
    'status 는 open, resolved, dismissed 중 하나여야 해요',
  );
}

/** `?targetType=` 또는 경로의 대상 종류. required 면 빈 값도 400 */
function parseTargetType(
  raw: unknown,
  field: string,
  required = false,
): ReportTargetType | null {
  if (!required && (raw === undefined || raw === '')) return null;
  if (
    typeof raw === 'string' &&
    (REPORT_TARGET_TYPES as readonly string[]).includes(raw)
  )
    return raw as ReportTargetType;
  throw invalid(field, `${field} 는 group, event, user 중 하나여야 해요`);
}

/** (#536) 관리자 신고 탭 (api.md 2.18, D-289). 관리자만 */
@Controller('admin/reports')
@UseGuards(AdminGuard)
export class AdminReportsController {
  constructor(private readonly reports: AdminReportsService) {}

  /** 대상별 묶음. status 없으면 전체 */
  @Get()
  list(
    @Query('status') status?: unknown,
    @Query('targetType') targetType?: unknown,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ) {
    return this.reports.list({
      status: parseStatus(status),
      targetType: parseTargetType(targetType, 'targetType'),
      ...parsePageQuery({ limit, cursor }),
    });
  }

  /** 탭 배지 */
  @Get('open-count')
  openCount() {
    return this.reports.openCount();
  }

  /** 대상 하나의 신고와 미리 보기 */
  @Get('targets/:targetType/:targetId')
  target(
    @Param('targetType') targetType: string,
    @IdParam('targetId') targetId: number,
  ) {
    return this.reports.target(
      parseTargetType(targetType, 'targetType', true)!,
      targetId,
    );
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(
    @CurrentUser() user: AuthUser,
    @IdParam('id') id: number,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reports.resolve(user.id, id, dto.resolution);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  dismiss(
    @CurrentUser() user: AuthUser,
    @IdParam('id') id: number,
    @Body() dto: DismissReportDto,
  ) {
    return this.reports.dismiss(
      user.id,
      id,
      dto.resolution?.trim() ? dto.resolution.trim() : null,
    );
  }
}
