import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { IdParam } from '../common/id-param.js';
import { NewsService } from './news.service.js';

@Controller('groups/:groupId/news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number) {
    return this.news.list(user.id, groupId);
  }

  @Post('seen')
  @HttpCode(200)
  seen(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number) {
    return this.news.markSeen(user.id, groupId);
  }
}
