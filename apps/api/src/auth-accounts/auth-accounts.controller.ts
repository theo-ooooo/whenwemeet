import { Body, Controller, Delete, Get, Header, HttpCode, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser, SessionIssuedAt } from '../auth/current-user.decorator.js';
import { IdParam } from '../common/id-param.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { type AuthAccountView, AuthAccountsService, type LinkResult } from './auth-accounts.service.js';
import { LinkAuthAccountDto, LinkStartDto } from './dto/auth-accounts.dto.js';

/** (#198) 내 정보 > 로그인 방법 (api.md, D-257) */
@Controller('me/auth-accounts')
export class AuthAccountsController {
  constructor(private readonly service: AuthAccountsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AuthAccountView[]> {
    return this.service.list(user.id);
  }

  /** 웹 OAuth 연결 시작 표식. 웹 `/me/link/start` route handler 가 받아 `/v1/auth/<제공자>?mode=link&intent=` 로 보낸다 */
  @Post('link-start')
  @HttpCode(200)
  @RateLimit('login')
  @Header('Cache-Control', 'no-store')
  start(@CurrentUser() user: AuthUser, @SessionIssuedAt() iat: number | null, @Body() dto: LinkStartDto): Promise<{ intent: string; expiresIn: number }> {
    return this.service.start(user.id, iat, dto.provider);
  }

  @Post()
  @HttpCode(200)
  @RateLimit('login')
  @Header('Cache-Control', 'no-store')
  link(@CurrentUser() user: AuthUser, @SessionIssuedAt() iat: number | null, @Body() dto: LinkAuthAccountDto): Promise<LinkResult> {
    return this.service.link(user.id, iat, dto);
  }

  @Delete(':id')
  unlink(@CurrentUser() user: AuthUser, @IdParam('id') id: number): Promise<{ ok: true }> {
    return this.service.unlink(user.id, id);
  }
}
