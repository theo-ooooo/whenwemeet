import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { extractBearer, Public, verifySessionClaims } from '../auth/jwt-auth.guard.js';
import { assertFreshSession } from '../auth/link-tickets.service.js';
import { ApiException } from '../common/errors.js';
import { EmailCodeDto, EmailLinkDto, EmailLinkInspectDto, EmailRequestDto, EmailSignupDto } from './dto/email-login.dto.js';
import { ClientIp, EmailLoginGuard } from './email-login.guard.js';
import { AuthResult, EmailLoginService, LinkState } from './email-login.service.js';

/**
 * (#245) 이메일 로그인 (이메일-로그인.md 4장). 웹 서버 전용(X-Internal-Key, D-115), 모두 no-store.
 * 브라우저 쿠키(wwm_session, wwm_signup) 는 웹 route handler 가 심는다
 */
@Public()
@UseGuards(EmailLoginGuard)
@Controller('auth/email')
export class EmailLoginController {
  constructor(
    private readonly emailLogin: EmailLoginService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * (#198) purpose LINK 는 로그인한 사용자의 이메일 연결 (D-257). 웹 서버가 X-Internal-Key 와 함께 세션을 Bearer 로 싣는다.
   * 세션이 없거나 틀리면 401, 최근 로그인(10분)이 아니면 409 REAUTH_REQUIRED. 응답은 LOGIN 과 같다(가입 여부를 드러내지 않음)
   */
  @Post('request')
  @HttpCode(200)
  async request(@Body() dto: EmailRequestDto, @ClientIp() clientIp: string, @Req() req: Request): Promise<{ cooldownSec: number; expiresInSec: number }> {
    if (dto.purpose !== 'LINK') return this.emailLogin.request({ email: dto.email, next: dto.next, clientIp });
    const token = extractBearer(req.headers.authorization);
    const claims = token ? await verifySessionClaims(this.jwt, token) : null;
    if (!claims) throw new ApiException('UNAUTHORIZED');
    assertFreshSession(claims.iat);
    return this.emailLogin.request({ email: dto.email, clientIp, linkUserId: claims.sub });
  }

  @Post('link/inspect')
  @HttpCode(200)
  inspect(@Body() dto: EmailLinkInspectDto): Promise<{ state: LinkState; emailMasked: string | null }> {
    return this.emailLogin.inspect(dto.token);
  }

  @Post('link')
  @HttpCode(200)
  link(@Body() dto: EmailLinkDto): Promise<AuthResult> {
    return this.emailLogin.verifyLink(dto.token, dto.client ?? 'web');
  }

  @Post('code')
  @HttpCode(200)
  code(@Body() dto: EmailCodeDto): Promise<AuthResult> {
    return this.emailLogin.verifyCode(dto.email, dto.code, dto.client ?? 'web');
  }

  @Post('signup')
  @HttpCode(200)
  signup(@Body() dto: EmailSignupDto): Promise<{ token: string; next: string }> {
    return this.emailLogin.signup(dto.signupToken, dto.nickname, dto.client ?? 'web');
  }
}
