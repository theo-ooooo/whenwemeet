import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { IdParam } from '../common/id-param.js';
import { parsePageQuery, parseSearchText } from '../common/page-query.js';
import { AdminGuard } from './admin-access.js';
import { AdminUsersService } from './admin-users.service.js';
import { UpdateRoleDto } from './dto/role.dto.js';

/** (#515) 관리자 사용자 관리 (api.md 2.16). 관리자만, 아니면 403 */
@Controller('admin/users')
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(@Query('q') q?: unknown, @Query('limit') limit?: unknown, @Query('cursor') cursor?: unknown) {
    return this.users.list({ q: parseSearchText(q), ...parsePageQuery({ limit, cursor }) });
  }

  @Patch(':id/role')
  changeRole(@CurrentUser() user: AuthUser, @IdParam('id') id: number, @Body() dto: UpdateRoleDto) {
    return this.users.changeRole(user.id, id, dto.role);
  }
}
