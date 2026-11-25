import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { parsePageQuery } from '../common/page-query.js';
import { AdminGuard } from './admin-access.js';
import { AdminActionsRepository } from './admin-actions.repository.js';

/** (#515) 관리자 조치 기록 읽기 (api.md 2.16, D-286). 읽기 전용, 관리자만 */
@Controller('admin/logs')
@UseGuards(AdminGuard)
export class AdminLogsController {
  constructor(private readonly actions: AdminActionsRepository) {}

  @Get()
  list(@Query('limit') limit?: unknown, @Query('cursor') cursor?: unknown) {
    return this.actions.list(parsePageQuery({ limit, cursor }));
  }
}
