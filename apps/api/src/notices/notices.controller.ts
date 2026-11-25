import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin/admin-access.js';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser, OptionalUser } from '../auth/current-user.decorator.js';
import { OptionalAuth } from '../auth/jwt-auth.guard.js';
import { IdParam } from '../common/id-param.js';
import { parsePageQuery } from '../common/page-query.js';
import { CreateNoticeDto, UpdateNoticeDto } from './dto/notice.dto.js';
import { NoticesService } from './notices.service.js';

/** (#515) 공지 읽기 (api.md 2.16). 로그인 없이 열리고(선택 인증), 로그인했으면 unread 를 계산한다 */
@Controller('notices')
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  @OptionalAuth()
  list(@OptionalUser() user: AuthUser | null, @Query('limit') limit?: unknown, @Query('cursor') cursor?: unknown) {
    return this.notices.listPublished(user?.id ?? null, parsePageQuery({ limit, cursor }));
  }

  /** 목록을 본 시각 기록. 멱등이라 200. ':id' 보다 먼저 등록 */
  @Post('seen')
  @HttpCode(200)
  seen(@CurrentUser() user: AuthUser) {
    return this.notices.markSeen(user.id);
  }

  @Get(':id')
  @OptionalAuth()
  get(@OptionalUser() user: AuthUser | null, @IdParam('id') id: number) {
    return this.notices.get(user?.id ?? null, id);
  }
}

/** (#515) 공지 작성 (api.md 2.16). 관리자만, 아니면 403 */
@Controller('admin/notices')
@UseGuards(AdminGuard)
export class AdminNoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  list(@Query('limit') limit?: unknown, @Query('cursor') cursor?: unknown) {
    return this.notices.listAll(parsePageQuery({ limit, cursor }));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @IdParam('id') id: number) {
    return this.notices.get(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNoticeDto) {
    return this.notices.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @IdParam('id') id: number, @Body() dto: UpdateNoticeDto) {
    return this.notices.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @IdParam('id') id: number) {
    return this.notices.remove(user.id, id);
  }
}
