import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Res, UseFilters } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/jwt-auth.guard.js';
import { IdParam } from '../common/id-param.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { BareExceptionFilter } from './bare-exception.filter.js';
import { CalendarFeedService } from './calendar-feed.service.js';
import { UpsertCalendarFeedDto } from './dto/calendar-feed.dto.js';

/** (#193) 내 구독 주소 조회, 만들기와 설정, 재발급, 끄기 (api.md 2.12). 멤버만 */
@Controller('groups/:groupId/calendar-feed')
export class CalendarFeedSettingsController {
  constructor(private readonly feeds: CalendarFeedService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number) {
    return this.feeds.get(user.id, groupId);
  }

  @Put()
  upsert(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @Body() dto: UpsertCalendarFeedDto) {
    return this.feeds.upsert(user.id, groupId, { includeMemo: dto.includeMemo, includeAnniversaries: dto.includeAnniversaries });
  }

  @Post('rotate')
  @HttpCode(200)
  rotate(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number) {
    return this.feeds.rotate(user.id, groupId);
  }

  @Delete()
  remove(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number) {
    return this.feeds.remove(user.id, groupId);
  }
}

/**
 * (#193) 공개 피드 `GET /v1/ics/:token.ics`. 로그인 없음, 응답 봉투 없음(text/calendar 그대로), 실패는 본문 없는 상태 코드.
 * 요청 제한: 주소 10 / 1분, IP 60 / 1분 (D-219)
 */
@Controller('ics')
@UseFilters(BareExceptionFilter)
export class CalendarFeedPublicController {
  constructor(private readonly feeds: CalendarFeedService) {}

  @Public()
  @Get(':token.ics')
  @RateLimit('icsFeed')
  async feed(@Param('token') token: string, @Headers('if-none-match') ifNoneMatch: string | undefined, @Res() res: Response): Promise<void> {
    const result = await this.feeds.feed(token, ifNoneMatch);
    res.setHeader('ETag', result.etag);
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (result.notModified) {
      res.status(304).end();
      return;
    }
    res.status(200).type('text/calendar; charset=utf-8').send(result.body);
  }
}
