import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomInt } from 'node:crypto';
import { MEMBER_COLORS } from '../common/member.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { KakaoProfile } from './kakao.client.js';

/** 로그인 후 돌아갈 웹 경로. 인증흐름.md 2단계 규칙 */
const NEXT_PATH = /^\/[A-Za-z0-9/_-]*$/;

export interface OAuthState {
  nonce: string;
  next: string;
}

export interface AuthUser {
  id: string;
  nickname: string;
  profileImageUrl: string | null;
  createdAt: Date;
}

/** 가입 시 자동 생성되는 개인 팀 이름 (인증흐름.md 4단계) */
export const PERSONAL_GROUP_NAME = '내 달력';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
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

  /** kakaoId 로 upsert. 신규면 같은 트랜잭션에서 PERSONAL 팀 + 멤버십 생성 */
  async upsertKakaoUser(profile: KakaoProfile): Promise<AuthUser> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { kakaoId: profile.kakaoId } });
      if (existing) {
        return tx.user.update({
          where: { id: existing.id },
          data: { nickname: profile.nickname, profileImageUrl: profile.profileImageUrl },
          select: USER_SELECT,
        });
      }
      const user = await tx.user.create({
        data: { kakaoId: profile.kakaoId, nickname: profile.nickname, profileImageUrl: profile.profileImageUrl },
        select: USER_SELECT,
      });
      await tx.group.create({
        data: {
          type: 'PERSONAL',
          name: PERSONAL_GROUP_NAME,
          inviteCode: null,
          memberships: { create: { userId: user.id, color: MEMBER_COLORS[0] } },
        },
      });
      return user;
    });
  }

  /**
   * 개발 전용 사용자 (결정기록 D-29). kakaoId 는 음수라 실제 카카오 회원과 섞이지 않는다.
   * 같은 닉네임의 개발 사용자가 있으면 재사용해 프론트가 반복 로그인할 수 있게 한다
   */
  async upsertDevUser(nickname: string): Promise<AuthUser> {
    const existing = await this.prisma.user.findFirst({
      where: { nickname, kakaoId: { lt: 0n } },
      select: USER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;
    const kakaoId = -BigInt(randomInt(1, 2 ** 31 - 1)) * 1_000_000n - BigInt(randomInt(0, 999_999));
    return this.upsertKakaoUser({ kakaoId, nickname, profileImageUrl: null });
  }

  async signToken(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId });
  }
}

export const USER_SELECT = { id: true, nickname: true, profileImageUrl: true, createdAt: true } as const;
