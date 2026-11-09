import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { ApiException } from '../common/errors.js';
import { AuthService } from './auth.service.js';
import { DevLoginDto } from './dto/dev-login.dto.js';
import { Public } from './jwt-auth.guard.js';
import { DevProvider } from './providers/dev.provider.js';
import { KakaoProvider } from './providers/kakao.provider.js';

/** CSRF 대조용 nonce 쿠키 (인증흐름.md 1장). API 도메인, Path=/v1/auth, 10분 */
export const STATE_COOKIE = 'wwm_oauth_state';
const STATE_COOKIE_MAX_AGE_MS = 600 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly kakao: KakaoProvider,
    private readonly dev: DevProvider,
    private readonly config: ConfigService,
  ) {}

  /** 302 → 카카오 인가 페이지. 설정이 없으면 503 KAKAO_NOT_CONFIGURED */
  @Public()
  @Get('kakao')
  startKakao(@Query('next') nextRaw: string | undefined, @Res() res: Response): void {
    const next = this.auth.sanitizeNext(nextRaw);
    const { nonce, state } = this.auth.createState(next);
    const url = this.kakao.authorizeUrl(state);
    res.cookie(STATE_COOKIE, nonce, this.stateCookieOptions());
    res.redirect(302, url);
  }

  /** 카카오 → 여기. 성공이면 웹 콜백으로 JWT 전달, 실패면 /login?error= */
  @Public()
  @Get('kakao/callback')
  async kakaoCallback(
    @Query('code') code: string | undefined,
    @Query('state') stateRaw: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const webOrigin = this.config.getOrThrow<string>('WEB_ORIGIN');
    res.clearCookie(STATE_COOKIE, this.stateCookieOptions());

    const state = this.auth.parseState(stateRaw);
    const cookieNonce = readCookie(req.headers.cookie, STATE_COOKIE);
    if (!code || !state || !cookieNonce || cookieNonce !== state.nonce) {
      res.redirect(302, `${webOrigin}/login?error=OAUTH_STATE`);
      return;
    }

    try {
      const profile = await this.kakao.exchangeCode(code);
      const user = await this.auth.login(this.kakao.provider, profile);
      const token = await this.auth.signToken(user.id);
      const params = new URLSearchParams({ token, next: state.next });
      res.redirect(302, `${webOrigin}/auth/callback?${params.toString()}`);
    } catch (error) {
      const codeParam = error instanceof ApiException ? error.code : 'KAKAO_ERROR';
      res.redirect(302, `${webOrigin}/login?error=${codeParam}`);
    }
  }

  /** 개발 전용 (결정기록 D-29). AuthAccount(DEV, 닉네임) 로 로그인. 운영에서는 존재하지 않는 경로처럼 404 */
  @Public()
  @Post('dev-login')
  @HttpCode(200)
  async devLogin(@Body() dto: DevLoginDto): Promise<{ token: string; user: unknown }> {
    if (process.env.NODE_ENV === 'production') throw new ApiException('NOT_FOUND');
    const user = await this.auth.login(this.dev.provider, await this.dev.exchangeCode(dto.nickname));
    const token = await this.auth.signToken(user.id);
    return { token, user };
  }

  private stateCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      path: '/v1/auth',
      maxAge: STATE_COOKIE_MAX_AGE_MS,
      secure: process.env.NODE_ENV === 'production',
    };
  }
}

/** Cookie 헤더에서 이름 하나만 꺼낸다 (cookie-parser 없이) */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}
