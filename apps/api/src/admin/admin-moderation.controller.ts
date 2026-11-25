import { Body, Controller, Delete, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiException } from '../common/errors.js';
import { IdParam } from '../common/id-param.js';
import { parsePageQuery, parseSearchText } from '../common/page-query.js';
import { AdminGuard } from './admin-access.js';
import { AdminModerationService } from './admin-moderation.service.js';
import { HideDto } from './dto/moderation.dto.js';

/** `?groupId=` 원문. 없거나 빈 값이면 null, 양의 정수가 아니면 400 */
function parseGroupFilter(raw: unknown): number | null {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > 2_147_483_647) {
    throw new ApiException('VALIDATION_FAILED', 'groupId 는 양의 정수여야 해요', [{ field: 'groupId', message: 'groupId 는 양의 정수여야 해요' }]);
  }
  return Number(raw);
}

/** (#515) 관리자 팀 관리 (api.md 2.16, D-286). 관리자만 */
@Controller('admin/groups')
@UseGuards(AdminGuard)
export class AdminGroupsController {
  constructor(private readonly moderation: AdminModerationService) {}

  @Get()
  list(@Query('q') q?: unknown, @Query('limit') limit?: unknown, @Query('cursor') cursor?: unknown) {
    return this.moderation.listGroups({ q: parseSearchText(q), ...parsePageQuery({ limit, cursor }) });
  }

  @Get(':id')
  get(@IdParam('id') id: number) {
    return this.moderation.group(id);
  }

  @Post(':id/hide')
  @HttpCode(200)
  hide(@CurrentUser() user: AuthUser, @IdParam('id') id: number, @Body() dto: HideDto) {
    return this.moderation.hideGroup(user.id, id, dto.reason);
  }

  @Post(':id/unhide')
  @HttpCode(200)
  unhide(@CurrentUser() user: AuthUser, @IdParam('id') id: number) {
    return this.moderation.unhideGroup(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @IdParam('id') id: number) {
    return this.moderation.deleteGroup(user.id, id);
  }
}

/** (#515) 관리자 일정 관리 (api.md 2.16, D-286). 목록은 제목만, 메모와 장소는 상세에서 */
@Controller('admin/events')
@UseGuards(AdminGuard)
export class AdminEventsController {
  constructor(private readonly moderation: AdminModerationService) {}

  @Get()
  list(@Query('q') q?: unknown, @Query('groupId') groupId?: unknown, @Query('limit') limit?: unknown, @Query('cursor') cursor?: unknown) {
    return this.moderation.listEvents({ q: parseSearchText(q), groupId: parseGroupFilter(groupId), ...parsePageQuery({ limit, cursor }) });
  }

  @Get(':id')
  get(@IdParam('id') id: number) {
    return this.moderation.event(id);
  }

  @Post(':id/hide')
  @HttpCode(200)
  hide(@CurrentUser() user: AuthUser, @IdParam('id') id: number, @Body() dto: HideDto) {
    return this.moderation.hideEvent(user.id, id, dto.reason);
  }

  @Post(':id/unhide')
  @HttpCode(200)
  unhide(@CurrentUser() user: AuthUser, @IdParam('id') id: number) {
    return this.moderation.unhideEvent(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @IdParam('id') id: number) {
    return this.moderation.deleteEvent(user.id, id);
  }
}
