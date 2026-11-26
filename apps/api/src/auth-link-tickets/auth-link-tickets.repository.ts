import { Injectable } from '@nestjs/common';
import type {
  AuthProvider,
  ProviderCredentials,
  RawProfile,
} from '../auth/providers/auth-provider.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** 연결하려는 두 번째 로그인. 티켓 행과 앱 토큰 경로, 이메일 코드 경로가 같은 모양으로 넘긴다 */
export interface LinkCandidate {
  provider: AuthProvider;
  providerUserId: string;
  email: string | null;
  rawProfile: RawProfile | null;
  /** Apple 토큰 폐기용 (D-51) */
  credentials?: ProviderCredentials;
}

/** 발급할 티켓 한 건. 원문은 받지 않는다 */
export interface NewLinkTicket extends LinkCandidate {
  userId: number;
  /** sha256hex(티켓) */
  tokenHash: string;
  expiresAt: Date;
}

/** (#198) 웹 OAuth 로 받은 두 번째 로그인 결과의 5분 1회용 티켓 (D-257). 세션이 아니다 */
@Injectable()
export class AuthLinkTicketsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: NewLinkTicket): Promise<void> {
    await this.prisma.authLinkTicket.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        provider: input.provider,
        providerUserId: input.providerUserId,
        email: input.email,
        ...(input.rawProfile === null ? {} : { rawProfile: input.rawProfile }),
        providerClientId: input.credentials?.providerClientId ?? null,
        refreshToken: input.credentials?.refreshToken ?? null,
        expiresAt: input.expiresAt,
      },
      select: { id: true },
    });
  }

  /** 만료 시각이 before 보다 이른 행 삭제 (발급 때마다 하는 청소) */
  async deleteExpiredBefore(before: Date): Promise<number> {
    const { count } = await this.prisma.authLinkTicket.deleteMany({
      where: { expiresAt: { lt: before } },
    });
    return count;
  }

  /**
   * 1회 소비. 해시가 맞고, 시작한 사용자가 userId 이고, 쓰이지 않았고 만료 전인 행만 조건부 updateMany 한 문장으로 usedAt 을 채운다.
   * 동시 요청 두 개 중 count 1 을 받은 쪽만 이긴다. 아니면 null (이유는 구분하지 않는다)
   */
  async consume(
    tokenHash: string,
    userId: number,
    now: Date,
  ): Promise<LinkCandidate | null> {
    const { count } = await this.prisma.authLinkTicket.updateMany({
      where: { tokenHash, userId, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count !== 1) return null;
    const row = await this.prisma.authLinkTicket.findUnique({
      where: { tokenHash },
      select: {
        provider: true,
        providerUserId: true,
        email: true,
        rawProfile: true,
        providerClientId: true,
        refreshToken: true,
      },
    });
    if (!row) return null;
    return {
      provider: row.provider,
      providerUserId: row.providerUserId,
      email: row.email,
      rawProfile: (row.rawProfile as RawProfile | null) ?? null,
      ...(row.providerClientId && row.refreshToken
        ? {
            credentials: {
              providerClientId: row.providerClientId,
              refreshToken: row.refreshToken,
            },
          }
        : {}),
    };
  }
}
