import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { AdminGuard } from './admin-access.js';
import { AdminStatsService, type StatsRange } from './admin-stats.service.js';

/** `?range=` 원문. 없거나 빈 값이면 7, 7 과 30 밖이면 400 */
function parseRange(raw: unknown): StatsRange {
  if (raw === undefined || raw === '' || raw === '7') return 7;
  if (raw === '30') return 30;
  throw new ApiException('VALIDATION_FAILED', 'range 는 7 또는 30 이어야 해요', [{ field: 'range', message: 'range 는 7 또는 30 이어야 해요' }]);
}

/** (#537) 관리자 대시보드 지표 (api.md 2.19, D-290). 관리자만 */
@Controller('admin/stats')
@UseGuards(AdminGuard)
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get()
  get(@Query('range') range?: unknown) {
    return this.stats.stats(parseRange(range));
  }
}
