import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { CreateReportDto } from './dto/report.dto.js';
import { type ReportResult, ReportsService } from './reports.service.js';

/** (#536) 신고하기 `POST /reports` (api.md 2.18, D-289). 로그인, 사용자당 하루 10번 */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** 새 신고는 201, 접수 중인 내 신고가 이미 있으면 새로 만들지 않고 그것을 200 으로 */
  @Post()
  @RateLimit('report')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto, @Res({ passthrough: true }) res: Response): Promise<ReportResult> {
    const result = await this.reports.create(user.id, dto);
    if (result.duplicate) res.status(200);
    return result;
  }
}
