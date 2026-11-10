import { Body, Controller, Get, Header, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { ApiException } from '../common/errors.js';
import { AppAuthService, type HandoffIssued } from './app-auth.service.js';
import { AppleAuthService } from './apple-auth.service.js';
import { AuthService } from './auth.service.js';
import { AppleNativeLoginDto, HandoffExchangeDto, KakaoNativeLoginDto } from './dto/app-auth.dto.js';
import { DevLoginDto } from './dto/dev-login.dto.js';
import { Public } from './jwt-auth.guard.js';
import { DevProvider } from './providers/dev.provider.js';
import { KakaoProvider } from './providers/kakao.provider.js';

/** CSRF 대조용 nonce 쿠키 (인증흐름.md 1장). API 도메인, Path=/v1/auth, 10분 */
export const STATE_COOKIE = 'wwm_oauth_state';
const STATE_COOKIE_MAX_AGE_MS = 600 * 1000;

/**
 * 애플 state nonce 쿠키 (인증흐름.md 5장). Apple 의 form_post 는 교차 사이트 POST 라 Lax 로는 실리지 않아
 * 이 쿠키만 SameSite=None; Secure. 세션 쿠키 정책은 그대로
 */
export const APPLE_STATE_COOKIE = 'wwm_apple_state';
const APPLE_STATE_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  path: '/v1/auth/apple',
  maxAge: STATE_COOKIE_MAX_AGE_MS,
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly appAuth: AppAuthService,
    private readonly appleAuth: AppleAuthService,
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

  /** 앱 카카오 SDK 로그인 (앱.md 3.1). 세션 JWT 대신 60초 1회용 handoff 를 돌려준다 */
  @Public()
  @Post('kakao/native')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  kakaoNative(@Body() dto: KakaoNativeLoginDto): Promise<HandoffIssued> {
    return this.appAuth.loginWithKakao(dto.accessToken, dto.codeChallenge);
  }

  /** handoff + verifier → 세션 JWT (앱.md 2.2). 호출자는 웹 서버(`/auth/app` route handler) 뿐 */
  @Public()
  @Post('handoff')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  exchangeHandoff(@Body() dto: HandoffExchangeDto): Promise<{ token: string }> {
    return this.appAuth.exchangeHandoff(dto.handoff, dto.verifier);
  }

  /** iOS 앱 애플 로그인 (앱.md 3.3). 세션 JWT 대신 60초 1회용 handoff */
  @Public()
  @Post('apple/native')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  appleNative(@Body() dto: AppleNativeLoginDto): Promise<HandoffIssued> {
    return this.appleAuth.loginNative(dto);
  }

  /** 웹과 Android 애플 로그인 시작 (앱.md 3.4). state 쿠키를 심고 Apple 인가 페이지로 302. 미설정이면 503 */
  @Public()
  @Get('apple')
  startApple(
    @Query('next') next: string | undefined,
    @Query('client') client: string | undefined,
    @Query('cc') cc: string | undefined,
    @Res() res: Response,
  ): void {
    const { nonce, url } = this.appleAuth.start(next, client, cc);
    res.cookie(APPLE_STATE_COOKIE, nonce, APPLE_STATE_COOKIE_OPTIONS);
    res.redirect(302, url);
  }

  /**
   * Apple form_post → 여기 (앱.md 3.4). web 은 웹 콜백으로 JWT, app(Android) 은 whenwemeet://auth?h= 로 handoff.
   * 본문은 Apple 이 정하므로 DTO 로 거르지 않고 문자열 필드만 꺼낸다
   */
  @Public()
  @Post('apple/callback')
  async appleCallback(@Body() body: Record<string, unknown>, @Req() req: Request, @Res() res: Response): Promise<void> {
    const field = (key: string): string | undefined => (typeof body?.[key] === 'string' ? (body[key] as string) : undefined);
    const cookieNonce = readCookie(req.headers.cookie, APPLE_STATE_COOKIE);
    res.clearCookie(APPLE_STATE_COOKIE, { ...APPLE_STATE_COOKIE_OPTIONS, maxAge: undefined });
    const location = await this.appleAuth.completeWeb({
      code: field('code'),
      state: field('state'),
      user: field('user'),
      error: field('error'),
      cookieNonce,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(302, location);
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
