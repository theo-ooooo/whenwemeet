import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../../common/errors.js';
import type { AuthProviderClient, ProviderProfile } from './auth-provider.js';

export const KAKAO_AUTHORIZE_URL = 'https://kauth.kakao.com/oauth/authorize';
export const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
export const KAKAO_ME_URL = 'https://kapi.kakao.com/v2/user/me';
export const KAKAO_UNLINK_URL = 'https://kapi.kakao.com/v1/user/unlink';

/** 카카오가 "연결되지 않은 사용자" 를 알리는 코드. unlink 가 이미 끊긴 경우는 성공으로 본다 */
const KAKAO_NOT_REGISTERED = -101;

/** 카카오 OAuth 호출 (인증흐름.md 1장). fetch 를 직접 쓰며 수집은 id, nickname, profile_image 만 */
@Injectable()
export class KakaoProvider implements AuthProviderClient {
  readonly provider = 'KAKAO' as const;

  constructor(private readonly config: ConfigService) {}

  /** 로그인에 필요한 설정이 있는지. 없으면 로그인/탈퇴 엔드포인트만 503 (결정기록 D-29) */
  isLoginConfigured(): boolean {
    return Boolean(this.config.get<string>('KAKAO_CLIENT_ID') && this.config.get<string>('KAKAO_REDIRECT_URI'));
  }

  isUnlinkConfigured(): boolean {
    return Boolean(this.config.get<string>('KAKAO_ADMIN_KEY'));
  }

  authorizeUrl(state: string): string {
    this.assertLoginConfigured();
    const params = new URLSearchParams({
      client_id: this.config.getOrThrow<string>('KAKAO_CLIENT_ID'),
      redirect_uri: this.config.getOrThrow<string>('KAKAO_REDIRECT_URI'),
      response_type: 'code',
      state,
      scope: 'profile_nickname,profile_image',
    });
    return `${KAKAO_AUTHORIZE_URL}?${params.toString()}`;
  }

  /** 인가 코드 → 액세스 토큰 → 프로필 */
  async exchangeCode(code: string): Promise<ProviderProfile> {
    return this.fetchProfile(await this.requestAccessToken(code));
  }

  /** 인가 코드 → 액세스 토큰 */
  async requestAccessToken(code: string): Promise<string> {
    this.assertLoginConfigured();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.getOrThrow<string>('KAKAO_CLIENT_ID'),
      redirect_uri: this.config.getOrThrow<string>('KAKAO_REDIRECT_URI'),
      code,
    });
    const secret = this.config.get<string>('KAKAO_CLIENT_SECRET');
    if (secret) body.set('client_secret', secret);

    const res = await fetch(KAKAO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
    });
    if (!res.ok) throw new ApiException('KAKAO_ERROR');
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new ApiException('KAKAO_ERROR');
    return json.access_token;
  }

  /** 액세스 토큰 → 프로필 (id, nickname, profile_image_url 만). raw 에도 이 셋만 남긴다 */
  async fetchProfile(accessToken: string): Promise<ProviderProfile> {
    const res = await fetch(KAKAO_ME_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new ApiException('KAKAO_ERROR');
    const json = (await res.json()) as {
      id?: number | string;
      kakao_account?: { profile?: { nickname?: string; profile_image_url?: string } };
    };
    if (json.id === undefined || json.id === null) throw new ApiException('KAKAO_ERROR');
    const profile = json.kakao_account?.profile;
    return {
      providerUserId: String(json.id),
      nickname: (profile?.nickname ?? '').trim().slice(0, 50) || '카카오 사용자',
      profileImageUrl: profile?.profile_image_url?.slice(0, 500) ?? null,
      raw: { id: json.id, nickname: profile?.nickname ?? null, profile_image_url: profile?.profile_image_url ?? null },
    };
  }

  /** 회원 탈퇴 시 연결 끊기 (Admin Key). 이미 끊긴 사용자는 성공으로 본다 (api.md 2.7) */
  async unlink(providerUserId: string): Promise<void> {
    if (!this.isUnlinkConfigured()) throw new ApiException('KAKAO_NOT_CONFIGURED');
    const body = new URLSearchParams({ target_id_type: 'user_id', target_id: providerUserId });
    const res = await fetch(KAKAO_UNLINK_URL, {
      method: 'POST',
      headers: {
        Authorization: `KakaoAK ${this.config.getOrThrow<string>('KAKAO_ADMIN_KEY')}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body,
    });
    if (res.ok) return;
    const json = (await res.json().catch(() => ({}))) as { code?: number };
    if (json.code === KAKAO_NOT_REGISTERED) return;
    throw new ApiException('KAKAO_ERROR');
  }

  private assertLoginConfigured(): void {
    if (!this.isLoginConfigured()) throw new ApiException('KAKAO_NOT_CONFIGURED');
  }
}
