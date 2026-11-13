import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { AvatarsService } from '../avatars/avatars.service.js';
import { MEMBER_COLORS } from '../common/member.js';
import { generatePublicCode } from '../common/public-code.js';
import { UsersRepository } from '../users/users.repository.js';
import { sanitizeNext } from './next-path.js';
import type { AuthProvider, ProviderProfile } from './providers/auth-provider.js';

export interface OAuthState {
  nonce: string;
  next: string;
  /** (#198) 로그인 방법 연결이면 시작 표식(서명된 JWT, D-257). 콜백이 다시 검증한다 */
  intent?: string;
}

export interface AuthUser {
  id: number;
  nickname: string;
  profileImageUrl: string | null;
  createdAt: Date;
}

/** 가입 시 자동 생성되는 개인 팀 이름 (인증흐름.md 4단계) */
export const PERSONAL_GROUP_NAME = '내 달력';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly jwt: JwtService,
    private readonly avatars: AvatarsService,
  ) {}

  /** 로그인 후 돌아갈 웹 경로(+쿼리). 규칙은 next-path.ts (인증흐름.md 2단계, D-41) */
  sanitizeNext(next: unknown): string {
    return sanitizeNext(next);
  }

  /** nonce 는 32바이트 랜덤 hex. state 는 서명하지 않는다 (결정기록 D-08) */
  createState(next: string, intent?: string): { nonce: string; state: string } {
    const nonce = randomBytes(32).toString('hex');
    const value: OAuthState = intent ? { nonce, next, intent } : { nonce, next };
    const state = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    return { nonce, state };
  }

  parseState(state: unknown): OAuthState | null {
    if (typeof state !== 'string' || !state) return null;
    try {
      const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as Partial<OAuthState>;
      if (typeof parsed.nonce !== 'string' || !parsed.nonce) return null;
      const next = this.sanitizeNext(parsed.next);
      return typeof parsed.intent === 'string' && parsed.intent ? { nonce: parsed.nonce, next, intent: parsed.intent } : { nonce: parsed.nonce, next };
    } catch {
      return null;
    }
  }

  /**
   * 소셜 로그인 (인증흐름.md 2장 4단계, 결정기록 D-34).
   * - 연결 계정이 있으면 rawProfile 만 갱신. 닉네임/사진은 우리 서비스 값이라 덮지 않는다 (D-36)
   * - 없으면 User + AuthAccount + PERSONAL 팀 + 첫 색 멤버십을 한 트랜잭션으로 만들고,
   *   소셜 프로필 사진을 R2 로 복사한다 (D-37). 복사가 실패해도 가입은 그대로 (사진 없음)
   */
  async login(provider: AuthProvider, profile: ProviderProfile): Promise<AuthUser> {
    const account = await this.users.findAuthAccount(provider, profile.providerUserId);
    if (account) return this.users.updateRawProfile(account.id, profile.raw, profile.credentials);
    const user = await this.users.createWithAccountTx(
      {
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email ?? null,
        rawProfile: profile.raw,
        nickname: profile.nickname,
        credentials: profile.credentials,
      },
      { name: PERSONAL_GROUP_NAME, color: MEMBER_COLORS[0], publicCode: generatePublicCode() },
    );
    const profileImageUrl = await this.avatars.importFromUrl(user.id, profile.profileImageUrl);
    return profileImageUrl ? { ...user, profileImageUrl } : user;
  }

  /** JWT 표준상 sub 는 문자열이라 숫자 ID 를 문자열로 싣는다. 가드가 다시 정수로 읽는다 */
  async signToken(userId: number): Promise<string> {
    return this.jwt.signAsync({ sub: String(userId) });
  }
}
