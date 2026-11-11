import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/jwt-auth.guard.js';
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
  constructor(private readonly emailLogin: EmailLoginService) {}

  @Post('request')
  @HttpCode(200)
  request(@Body() dto: EmailRequestDto, @ClientIp() clientIp: string): Promise<{ cooldownSec: number; expiresInSec: number }> {
    return this.emailLogin.request({ email: dto.email, next: dto.next, clientIp });
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
