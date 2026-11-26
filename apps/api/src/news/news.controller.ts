import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { IdParam } from '../common/id-param.js';
import { NewsService } from './news.service.js';

@Controller('groups/:groupId/news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  /** `?v=2` 면 팀 활동 기록을 섞는다 (#191). 없거나 다른 값이면 예전 응답 그대로 (D-155) */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @IdParam('groupId') groupId: number,
    @Query('v') v?: string,
  ) {
    return this.news.list(user.id, groupId, new Date(), v === '2' ? 2 : 1);
  }

  @Post('seen')
  @HttpCode(200)
  seen(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number) {
    return this.news.markSeen(user.id, groupId);
  }
}
