import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { MEMBER_COLORS } from '../common/member.js';
import { UsersRepository } from '../users/users.repository.js';
import type { AuthProvider, ProviderProfile } from './providers/auth-provider.js';

/** 로그인 후 돌아갈 웹 경로. 인증흐름.md 2단계 규칙 */
const NEXT_PATH = /^\/[A-Za-z0-9/_-]*$/;

export interface OAuthState {
  nonce: string;
  next: string;
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
  ) {}

  sanitizeNext(next: unknown): string {
    return typeof next === 'string' && NEXT_PATH.test(next) ? next : '/';
  }

  /** nonce 는 32바이트 랜덤 hex. state 는 서명하지 않는다 (결정기록 D-08) */
  createState(next: string): { nonce: string; state: string } {
    const nonce = randomBytes(32).toString('hex');
    const state = Buffer.from(JSON.stringify({ nonce, next } satisfies OAuthState), 'utf8').toString('base64url');
    return { nonce, state };
  }

  parseState(state: unknown): OAuthState | null {
    if (typeof state !== 'string' || !state) return null;
    try {
      const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as Partial<OAuthState>;
      if (typeof parsed.nonce !== 'string' || !parsed.nonce) return null;
      return { nonce: parsed.nonce, next: this.sanitizeNext(parsed.next) };
    } catch {
      return null;
    }
  }

  /**
   * 소셜 로그인 (인증흐름.md 2장 4단계, 결정기록 D-34).
   * - 연결 계정이 있으면 rawProfile 만 갱신. 닉네임/사진은 우리 서비스 값이라 덮지 않는다 (D-36)
   * - 없으면 User + AuthAccount + PERSONAL 팀 + 첫 색 멤버십을 한 트랜잭션으로
   */
  async login(provider: AuthProvider, profile: ProviderProfile): Promise<AuthUser> {
    const account = await this.users.findAuthAccount(provider, profile.providerUserId);
    if (account) return this.users.updateRawProfile(account.id, profile.raw);
    return this.users.createWithAccountTx(
      {
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email ?? null,
        rawProfile: profile.raw,
        nickname: profile.nickname,
        profileImageUrl: profile.profileImageUrl,
      },
      { name: PERSONAL_GROUP_NAME, color: MEMBER_COLORS[0] },
    );
  }

  /** JWT 표준상 sub 는 문자열이라 숫자 ID 를 문자열로 싣는다. 가드가 다시 정수로 읽는다 */
  async signToken(userId: number): Promise<string> {
    return this.jwt.signAsync({ sub: String(userId) });
  }
}
