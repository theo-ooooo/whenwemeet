import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** 발급할 handoff 한 건 (앱.md 2.1). 토큰 원문은 받지 않는다 */
export interface NewHandoff {
  userId: number;
  /** sha256hex(토큰) */
  tokenHash: string;
  /** base64url(sha256(verifier)) */
  codeChallenge: string;
  expiresAt: Date;
}

/** 앱 로그인 결과를 웹 세션으로 넘기는 60초 1회용 토큰 (앱.md 2장, D-49) */
@Injectable()
export class AuthHandoffsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: NewHandoff): Promise<void> {
    await this.prisma.authHandoff.create({ data: input, select: { id: true } });
  }

  /** 만료 시각이 before 보다 이른 행 삭제 (발급 때마다 호출하는 청소, 배치 없음). 지운 수를 돌려준다 */
  async deleteExpiredBefore(before: Date): Promise<number> {
    const { count } = await this.prisma.authHandoff.deleteMany({ where: { expiresAt: { lt: before } } });
    return count;
  }

  /**
   * 1회 소비. 해시, challenge 가 맞고 아직 쓰이지 않았고 만료 전인 행만 조건부 updateMany 한 문장으로 `usedAt` 을 채운다.
   * 동시 요청 두 개 중 count 1 을 받은 쪽만 이긴다. 성공이면 userId, 아니면 null (이유는 구분하지 않음)
   */
  async consume(tokenHash: string, codeChallenge: string, now: Date): Promise<number | null> {
    const { count } = await this.prisma.authHandoff.updateMany({
      where: { tokenHash, codeChallenge, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count !== 1) return null;
    const row = await this.prisma.authHandoff.findUnique({ where: { tokenHash }, select: { userId: true } });
    return row?.userId ?? null;
  }
}
