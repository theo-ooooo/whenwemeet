import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/errors.js';
import { AppAuthService, type HandoffIssued } from './app-auth.service.js';
import { AuthService } from './auth.service.js';
import { linkFailureUrl, linkTicketUrl } from './link-urls.js';
import { LinkTicketsService } from './link-tickets.service.js';
import { sha256hex } from './pkce.js';
import type { ProviderProfile } from './providers/auth-provider.js';
import { AppleProvider } from './providers/apple.provider.js';

/** 애플은 이름을 첫 로그인에만 준다. 없으면 이 값 (앱.md 3.2) */
export const APPLE_DEFAULT_NICKNAME = '새 사용자';
const NICKNAME_MAX_LENGTH = 20;

/**
 * GET /auth/apple 이 만드는 state. 서명하지 않고 nonce 쿠키와 대조한다 (카카오와 같은 방식, D-08).
 * (#204) Android 셸 복귀(client=app, cc, whenwemeet://auth)는 #145 로 셸이 부르지 않아 지웠다. 웹 전용
 */
export interface AppleState {
  nonce: string;
  next: string;
  /** (#198) 로그인 방법 연결이면 시작 표식 (D-257) */
  intent?: string;
}

/** POST /auth/apple/callback 의 form_post 본문 중 쓰는 것 */
export interface AppleCallbackInput {
  code?: string;
  state?: string;
  user?: string;
  error?: string;
  /** wwm_apple_state 쿠키 값 */
  cookieNonce: string | null;
}

export interface AppleNativeInput {
  identityToken: string;
  authorizationCode: string;
  nonce: string;
  nickname?: string;
  codeChallenge: string;
}

/** (#198) 네이티브 검증만 (로그인, 연결 공용) */
export type AppleNativeProof = Pick<AppleNativeInput, 'identityToken' | 'authorizationCode' | 'nonce'>;

const HANGUL_ONLY = /^[가-힣]+$/;

/**
 * 애플 이름(성, 이름) → 닉네임 초기값. 공백을 정리하고 20자로 자른다.
 * 한글 이름은 붙여 쓰고(김 + 철수 → 김철수), 그 밖은 띄어 쓴다
 */
export function appleNickname(familyName: unknown, givenName: unknown): string {
  const parts = [familyName, givenName].map((part) => (typeof part === 'string' ? part.replace(/\s+/g, ' ').trim() : '')).filter(Boolean);
  const joined = parts.every((part) => HANGUL_ONLY.test(part)) ? parts.join('') : parts.join(' ');
  return joined.slice(0, NICKNAME_MAX_LENGTH).trim() || APPLE_DEFAULT_NICKNAME;
}

/** 애플 로그인 흐름 (앱.md 3.3 ~ 3.4). 검증, 코드 교환, 폐기는 AppleProvider, 사용자 생성은 AuthService.login */
@Injectable()
export class AppleAuthService {
  constructor(
    private readonly apple: AppleProvider,
    private readonly auth: AuthService,
    private readonly appAuth: AppAuthService,
    private readonly config: ConfigService,
    private readonly linkTickets: LinkTicketsService,
  ) {}

  /**
   * POST /auth/apple/native (앱.md 3.3). identity token 검증(aud = 번들 ID, nonce = sha256hex(요청 nonce))
   * → 코드 교환(client_id = 번들 ID) → 교환 id_token 검증과 sub 일치 → login + refresh token 저장 → handoff
   */
  async loginNative(input: AppleNativeInput): Promise<HandoffIssued> {
    const nickname = input.nickname?.trim().slice(0, NICKNAME_MAX_LENGTH) || APPLE_DEFAULT_NICKNAME;
    const user = await this.auth.login(this.apple.provider, await this.verifyNative(input, nickname));
    return this.appAuth.issueHandoff(user.id, input.codeChallenge);
  }

  /**
   * 네이티브 증명 검증 → 프로필. 로그인(loginNative)과 로그인 방법 연결(#198, POST /me/auth-accounts)이 같이 쓴다.
   * identity token(aud = 번들 ID, nonce 필수) → 코드 교환 → 교환 id_token 의 sub 일치
   */
  async verifyNative(input: AppleNativeProof, nickname = APPLE_DEFAULT_NICKNAME): Promise<ProviderProfile> {
    this.apple.assertConfigured();
    const audience = this.apple.bundleId();
    const nonce = sha256hex(input.nonce);
    const { sub } = await this.apple.verifyIdToken(input.identityToken, { audience, nonce, nonceRequired: true });
    const tokens = await this.apple.exchangeCode(input.authorizationCode, audience);
    const exchanged = await this.apple.verifyIdToken(tokens.idToken, { audience, nonce, nonceRequired: false });
    if (exchanged.sub !== sub) throw new ApiException('SOCIAL_TOKEN_INVALID');
    return this.profile(sub, nickname, audience, tokens.refreshToken);
  }

  /**
   * GET /auth/apple (앱.md 3.4, 웹 전용).
   * 쿠키에 심을 nonce 와 Apple 인가 주소를 돌려준다. 설정이 없으면 503
   */
  start(nextRaw: unknown, intent?: string): { nonce: string; url: string } {
    this.apple.assertConfigured();
    const nonce = randomBytes(32).toString('hex');
    const next = this.auth.sanitizeNext(nextRaw);
    const state: AppleState = intent ? { nonce, next, intent } : { nonce, next };
    const encoded = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
    return { nonce, url: this.apple.authorizeUrl(encoded, nonce) };
  }

  parseState(raw: unknown): AppleState | null {
    if (typeof raw !== 'string' || !raw) return null;
    try {
      const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<AppleState>;
      if (typeof parsed.nonce !== 'string' || !parsed.nonce) return null;
      const next = this.auth.sanitizeNext(parsed.next);
      return typeof parsed.intent === 'string' && parsed.intent ? { nonce: parsed.nonce, next, intent: parsed.intent } : { nonce: parsed.nonce, next };
    } catch {
      return null;
    }
  }

  /**
   * POST /auth/apple/callback (앱.md 3.4). 돌아갈 주소(302 Location) 를 만든다. 예외를 던지지 않는다.
   * state 불일치 → OAUTH_STATE, 사용자 취소 → APPLE_CANCELLED, 그 밖 → 오류 코드
   */
  async completeWeb(input: AppleCallbackInput): Promise<string> {
    const state = this.parseState(input.state);
    if (!state || !input.cookieNonce || input.cookieNonce !== state.nonce) return this.failureUrl('OAUTH_STATE');
    // (#198) 연결이면 실패도 내 정보 연결 착지(/me/link)로 돌아간다
    const fail = (code: string) => (state.intent ? linkFailureUrl(this.webOrigin(), code, state.next) : this.failureUrl(code));
    if (input.error) return fail(input.error === 'user_cancelled_authorize' ? 'APPLE_CANCELLED' : 'APPLE_ERROR');
    if (!input.code) return fail('OAUTH_STATE');
    const linkUserId = state.intent ? await this.linkTickets.verifyIntent(state.intent, 'APPLE') : null;
    if (state.intent && linkUserId === null) return fail('LINK_TICKET_INVALID');

    try {
      this.apple.assertConfigured();
      const clientId = this.apple.serviceId();
      const tokens = await this.apple.exchangeCode(input.code, clientId, this.config.getOrThrow<string>('APPLE_REDIRECT_URI').trim());
      const { sub } = await this.apple.verifyIdToken(tokens.idToken, { audience: clientId, nonce: state.nonce, nonceRequired: false });
      const profile = this.profile(sub, nicknameFromUserJson(input.user), clientId, tokens.refreshToken);
      if (linkUserId !== null) {
        // (#198) 로그인하지 않고 시작한 사용자에게 묶인 5분 1회용 연결 티켓만 만든다 (D-257)
        const ticket = await this.linkTickets.issue(linkUserId, 'APPLE', profile);
        return linkTicketUrl(this.webOrigin(), ticket, state.next);
      }
      const user = await this.auth.login(this.apple.provider, profile);

      const token = await this.auth.signToken(user.id);
      return `${this.webOrigin()}/auth/callback?${new URLSearchParams({ token, next: state.next }).toString()}`;
    } catch (error) {
      return fail(error instanceof ApiException ? error.code : 'APPLE_ERROR');
    }
  }

  /** 실패 시 돌아갈 주소: 웹 로그인 화면 */
  failureUrl(code: string): string {
    return `${this.webOrigin()}/login?${new URLSearchParams({ error: code }).toString()}`;
  }

  /** 이메일, 사진은 받지 않는다 (D-50). raw 에는 sub 만 */
  private profile(sub: string, nickname: string, clientId: string, refreshToken: string | null): ProviderProfile {
    return {
      providerUserId: sub,
      nickname,
      profileImageUrl: null,
      email: null,
      raw: { sub },
      ...(refreshToken ? { credentials: { providerClientId: clientId, refreshToken } } : {}),
    };
  }

  private webOrigin(): string {
    return this.config.getOrThrow<string>('WEB_ORIGIN');
  }
}

/** form_post 의 user(JSON, 첫 로그인만) → 닉네임. 깨졌으면 기본값 */
function nicknameFromUserJson(raw: string | undefined): string {
  if (!raw) return APPLE_DEFAULT_NICKNAME;
  try {
    const parsed = JSON.parse(raw) as { name?: { firstName?: unknown; lastName?: unknown } };
    return appleNickname(parsed.name?.lastName, parsed.name?.firstName);
  } catch {
    return APPLE_DEFAULT_NICKNAME;
  }
}
