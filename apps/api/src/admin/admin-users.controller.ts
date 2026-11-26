import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiException } from '../common/errors.js';
import { IdParam } from '../common/id-param.js';
import type { AdminPlatform } from '../users/users.repository.js';
import { parsePageQuery, parseSearchText } from '../common/page-query.js';
import { AdminGuard } from './admin-access.js';
import { AdminModerationService } from './admin-moderation.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { UpdateRoleDto } from './dto/role.dto.js';

/** (#528) `?platform=` 원문. 없거나 빈 값이면 null, ios, android, web 밖이면 400 */
function parsePlatform(raw: unknown): AdminPlatform | null {
  if (raw === undefined || raw === '') return null;
  if (raw === 'ios' || raw === 'android' || raw === 'web') return raw;
  throw new ApiException(
    'VALIDATION_FAILED',
    'platform 은 ios, android, web 중 하나여야 해요',
    [
      {
        field: 'platform',
        message: 'platform 은 ios, android, web 중 하나여야 해요',
      },
    ],
  );
}

/** (#515) 관리자 사용자 관리 (api.md 2.16). 관리자만, 아니면 403 */
@Controller('admin/users')
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly moderation: AdminModerationService,
  ) {}

  @Get()
  list(
    @Query('q') q?: unknown,
    @Query('platform') platform?: unknown,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ) {
    return this.users.list({
      q: parseSearchText(q),
      platform: parsePlatform(platform),
      ...parsePageQuery({ limit, cursor }),
    });
  }

  /** 사용자와 속한 팀 */
  @Get(':id')
  get(@IdParam('id') id: number) {
    return this.moderation.user(id);
  }

  @Patch(':id/role')
  changeRole(
    @CurrentUser() user: AuthUser,
    @IdParam('id') id: number,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.users.changeRole(user.id, id, dto.role);
  }
}
