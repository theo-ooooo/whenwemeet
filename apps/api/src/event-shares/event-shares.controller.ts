import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser, OptionalUser } from '../auth/current-user.decorator.js';
import { OptionalAuth } from '../auth/jwt-auth.guard.js';
import { IdParam } from '../common/id-param.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { CreateEventShareDto } from './dto/event-share.dto.js';
import { EventSharesService } from './event-shares.service.js';

/** (#274) 보내는 쪽: 그 일정(반복이면 `occurrence` 회차)의 링크 조회, 만들기, 끊기 (api.md 2.10) */
@Controller('groups/:groupId/events/:eventId/share')
export class EventShareLinksController {
  constructor(private readonly shares: EventSharesService) {}

  @Get()
  get(
    @CurrentUser() user: AuthUser,
    @IdParam('groupId') groupId: number,
    @IdParam('eventId') eventId: number,
    @Query('occurrence') occurrence: unknown,
  ) {
    return this.shares.getLink(user.id, groupId, eventId, occurrence);
  }

  /** 새로 만들면 201, 살아 있는 링크를 돌려주면 200 */
  @Post()
  @RateLimit('eventShareCreate')
  async create(
    @CurrentUser() user: AuthUser,
    @IdParam('groupId') groupId: number,
    @IdParam('eventId') eventId: number,
    @Body() dto: CreateEventShareDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { link, created } = await this.shares.createLink(user.id, groupId, eventId, dto.occurrence);
    res.status(created ? 201 : 200);
    return link;
  }

  @Delete()
  revoke(
    @CurrentUser() user: AuthUser,
    @IdParam('groupId') groupId: number,
    @IdParam('eventId') eventId: number,
    @Query('occurrence') occurrence: unknown,
  ) {
    return this.shares.revokeLink(user.id, groupId, eventId, occurrence);
  }
}

/** (#274) 받는 쪽: 공개 미리보기(선택 인증)와 합류 */
@Controller('event-shares')
export class EventSharesController {
  constructor(private readonly shares: EventSharesService) {}

  @OptionalAuth()
  @Get(':token')
  @RateLimit('eventSharePreview')
  preview(@Param('token') token: string, @OptionalUser() user: AuthUser | null) {
    return this.shares.preview(token, user?.id ?? null);
  }

  /** 이미 멤버여도 200 (멱등). 요청 제한은 초대 코드 합류와 같은 묶음 (D-185) */
  @Post(':token/join')
  @HttpCode(200)
  @RateLimit('inviteJoin')
  join(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.shares.join(user.id, token);
  }
}
