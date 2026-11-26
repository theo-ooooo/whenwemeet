import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../admin/admin-access.js';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/jwt-auth.guard.js';
import {
  AppReleasesService,
  parseAppPlatform,
} from './app-releases.service.js';
import { UpdateAppReleaseDto } from './dto/app-release.dto.js';

/** (#539) 앱 업데이트 안내 읽기 (api.md 2.17, D-292). 로그인 없이 */
@Controller('app')
export class AppVersionController {
  constructor(private readonly releases: AppReleasesService) {}

  @Get('version')
  @Public()
  version(@Query('platform') platform?: unknown) {
    return this.releases.get(parseAppPlatform(platform));
  }
}

/** (#539) 관리자 "앱 버전" (api.md 2.17). 관리자만, 아니면 403 */
@Controller('admin/app-releases')
@UseGuards(AdminGuard)
export class AdminAppReleasesController {
  constructor(private readonly releases: AppReleasesService) {}

  @Get()
  list() {
    return this.releases.list();
  }

  @Put(':platform')
  update(
    @CurrentUser() user: AuthUser,
    @Param('platform') platform: string,
    @Body() dto: UpdateAppReleaseDto,
  ) {
    return this.releases.update(user.id, parseAppPlatform(platform), dto);
  }
}
