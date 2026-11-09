import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { NewsService } from './news.service.js';

@Controller('groups/:groupId/news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string) {
    return this.news.list(user.id, groupId);
  }

  @Post('seen')
  @HttpCode(200)
  seen(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string) {
    return this.news.markSeen(user.id, groupId);
  }
}
