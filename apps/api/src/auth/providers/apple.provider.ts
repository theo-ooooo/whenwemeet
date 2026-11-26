import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
  type CryptoKey,
  type JWTVerifyGetKey,
} from 'jose';
import { ApiException } from '../../common/errors.js';
import type { AuthProviderClient, LinkedAccount } from './auth-provider.js';

export const APPLE_ISSUER = 'https://appleid.apple.com';
export const APPLE_KEYS_URL = `${APPLE_ISSUER}/auth/keys`;
export const APPLE_AUTHORIZE_URL = `${APPLE_ISSUER}/auth/authorize`;
export const APPLE_TOKEN_URL = `${APPLE_ISSUER}/auth/token`;
export const APPLE_REVOKE_URL = `${APPLE_ISSUER}/auth/revoke`;

/** 하나라도 없으면 애플 엔드포인트 전부 503 APPLE_NOT_CONFIGURED (앱.md 3.2, D-55) */
export const APPLE_ENV_KEYS = [
  'APPLE_TEAM_ID',
  'APPLE_KEY_ID',
  'APPLE_PRIVATE_KEY',
  'APPLE_BUNDLE_ID',
  'APPLE_SERVICE_ID',
  'APPLE_REDIRECT_URI',
] as const;

/** Apple 공개키 집합 주입 토큰. 운영은 원격 JWKS, 테스트는 로컬 키 */
export const APPLE_JWKS = Symbol('APPLE_JWKS');

/** 운영용 키 집합. 캐시와 키 교체 시 재조회는 jose 기본 동작 */
export function createAppleJwks(): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(APPLE_KEYS_URL));
}

/** client_secret 유효 시간(초). 요청마다 새로 만든다 (앱.md 3.2) */
const CLIENT_SECRET_TTL_SECONDS = 5 * 60;

/** 시계 오차 허용(초) */
const CLOCK_TOLERANCE_SECONDS = 60;

/** 토큰 자체가 잘못된 경우의 jose 오류 코드. 이 밖의 오류(JWKS 조회 실패 등)는 애플 쪽 장애로 본다 */
const INVALID_TOKEN_CODES = new Set([
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWS_INVALID',
  'ERR_JWT_INVALID',
  'ERR_JWT_EXPIRED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
]);

export interface AppleVerifyOptions {
  /** 이 경로에서 허용하는 aud 하나 (네이티브 = 번들 ID, 웹과 Android = Service ID) */
  audience: string;
  /** 토큰의 nonce 클레임과 같아야 하는 값 */
  nonce: string;
  /**
   * true 면 nonce 클레임이 반드시 있어야 한다 (iOS identity token).
   * false 면 있을 때만 대조하고, 없으면 `nonce_supported` 가 false 일 때만 통과 (코드 교환으로 받은 id_token)
   */
  nonceRequired: boolean;
}

export interface AppleTokens {
  idToken: string;
  /** 폐기(탈퇴)에 쓴다. 응답에 없으면 null */
  refreshToken: string | null;
}

/**
 * Sign in with Apple (앱.md 3.2 ~ 3.5, D-50, D-51). jose 로 Apple JWKS 검증, ES256 client_secret 으로
 * 인가 코드 교환과 토큰 폐기. 이메일은 요청도 저장도 하지 않는다
 */
@Injectable()
export class AppleProvider implements AuthProviderClient {
  readonly provider = 'APPLE' as const;
  private readonly logger = new Logger(AppleProvider.name);
  private signingKey: { pem: string; key: Promise<CryptoKey> } | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(APPLE_JWKS) private readonly keys: JWTVerifyGetKey,
  ) {}

  isConfigured(): boolean {
    return APPLE_ENV_KEYS.every((key) =>
      Boolean(this.config.get<string>(key)?.trim()),
    );
  }

  assertConfigured(): void {
    if (!this.isConfigured()) throw new ApiException('APPLE_NOT_CONFIGURED');
  }

  /** iOS 네이티브 경로의 aud 와 client_id */
  bundleId(): string {
    return this.env('APPLE_BUNDLE_ID');
  }

  /** 웹과 Android 경로의 aud 와 client_id */
  serviceId(): string {
    return this.env('APPLE_SERVICE_ID');
  }

  /** 302 대상. scope=name 이면 Apple 이 form_post 를 강제한다 (앱.md 3.4) */
  authorizeUrl(state: string, nonce: string): string {
    this.assertConfigured();
    const params = new URLSearchParams({
      client_id: this.serviceId(),
      redirect_uri: this.env('APPLE_REDIRECT_URI'),
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'name',
      state,
      nonce,
    });
    return `${APPLE_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * identity token / id_token 검증 (앱.md 3.2 표). RS256, iss, aud 하나, exp(오차 60초), nonce.
   * 토큰 위반 → 401 SOCIAL_TOKEN_INVALID, JWKS 조회 실패 → 502 APPLE_ERROR. 돌려주는 것은 sub 뿐
   */
  async verifyIdToken(
    token: string,
    options: AppleVerifyOptions,
  ): Promise<{ sub: string }> {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        algorithms: ['RS256'],
        issuer: APPLE_ISSUER,
        audience: options.audience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp', 'iat'],
      }));
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && INVALID_TOKEN_CODES.has(code))
        throw new ApiException('SOCIAL_TOKEN_INVALID');
      throw new ApiException('APPLE_ERROR');
    }

    if (typeof payload.sub !== 'string' || !payload.sub)
      throw new ApiException('SOCIAL_TOKEN_INVALID');
    if (payload.nonce === undefined) {
      // 코드 교환 응답의 id_token 은 nonce 를 빼먹는 경우가 있다. Apple 안내대로 nonce_supported 가 false 일 때만 넘어간다
      const supported = payload.nonce_supported;
      if (
        options.nonceRequired ||
        (supported !== false && supported !== 'false')
      )
        throw new ApiException('SOCIAL_TOKEN_INVALID');
    } else if (payload.nonce !== options.nonce) {
      throw new ApiException('SOCIAL_TOKEN_INVALID');
    }
    return { sub: payload.sub };
  }

  /**
   * 인가 코드 교환 (D-51). 코드는 1회용 5분이라 identity token 재사용을 막는다.
   * redirect_uri 는 인가 요청에 redirect_uri 를 보낸 웹 경로에서만 싣는다.
   * invalid_grant → 401 SOCIAL_TOKEN_INVALID, 그 밖의 실패 → 502 APPLE_ERROR
   */
  async exchangeCode(
    code: string,
    clientId: string,
    redirectUri?: string,
  ): Promise<AppleTokens> {
    this.assertConfigured();
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: await this.clientSecret(clientId),
      code,
      grant_type: 'authorization_code',
    });
    if (redirectUri) body.set('redirect_uri', redirectUri);

    const res = await this.post(APPLE_TOKEN_URL, body);
    const json = (await res.json().catch(() => ({}))) as {
      id_token?: unknown;
      refresh_token?: unknown;
      error?: unknown;
    };
    if (!res.ok) {
      if (json.error === 'invalid_grant')
        throw new ApiException('SOCIAL_TOKEN_INVALID');
      throw new ApiException('APPLE_ERROR');
    }
    if (typeof json.id_token !== 'string' || !json.id_token)
      throw new ApiException('APPLE_ERROR');
    return {
      idToken: json.id_token,
      refreshToken:
        typeof json.refresh_token === 'string' && json.refresh_token
          ? json.refresh_token
          : null,
    };
  }

  /**
   * 회원 탈퇴 시 토큰 폐기 (앱.md 3.5). 200 → 성공, 400 invalid_grant → 이미 폐기로 보고 성공.
   * refresh token 이나 client_id 가 없으면(교환 실패 등) 건너뛰고 경고 로그. 그 밖의 실패 → 502 APPLE_ERROR
   */
  async unlink(account: LinkedAccount): Promise<void> {
    if (!account.refreshToken || !account.providerClientId) {
      this.logger.warn(
        `폐기할 애플 refresh token 이 없어 건너뜀 (sub ${account.providerUserId})`,
      );
      return;
    }
    this.assertConfigured();
    const body = new URLSearchParams({
      client_id: account.providerClientId,
      client_secret: await this.clientSecret(account.providerClientId),
      token: account.refreshToken,
      token_type_hint: 'refresh_token',
    });
    const res = await this.post(APPLE_REVOKE_URL, body);
    if (res.ok) return;
    const json = (await res.json().catch(() => ({}))) as { error?: unknown };
    if (res.status === 400 && json.error === 'invalid_grant') return;
    throw new ApiException('APPLE_ERROR');
  }

  /**
   * client_secret: ES256 JWT, 헤더 kid = APPLE_KEY_ID, iss = 팀 ID, aud = Apple, sub = client_id, 5분 (앱.md 3.2).
   * .p8 은 한 번만 가져와 둔다. 환경 변수의 `\n` 이스케이프도 받는다
   */
  async clientSecret(clientId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: this.env('APPLE_KEY_ID') })
      .setIssuer(this.env('APPLE_TEAM_ID'))
      .setIssuedAt(now)
      .setExpirationTime(now + CLIENT_SECRET_TTL_SECONDS)
      .setAudience(APPLE_ISSUER)
      .setSubject(clientId)
      .sign(await this.privateKey());
  }

  private privateKey(): Promise<CryptoKey> {
    const pem = this.env('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n');
    if (this.signingKey?.pem !== pem) {
      const key = importPKCS8(pem, 'ES256');
      // 잘못된 키로 실패한 Promise 를 붙잡아 두지 않는다
      key.catch(() => {
        if (this.signingKey?.key === key) this.signingKey = null;
      });
      this.signingKey = { pem, key };
    }
    return this.signingKey.key.catch(() => {
      throw new ApiException('APPLE_ERROR');
    });
  }

  private async post(url: string, body: URLSearchParams): Promise<Response> {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch {
      throw new ApiException('APPLE_ERROR');
    }
  }

  private env(key: (typeof APPLE_ENV_KEYS)[number]): string {
    return this.config.getOrThrow<string>(key).trim();
  }
}
