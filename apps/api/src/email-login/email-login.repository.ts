import { Injectable } from '@nestjs/common';
import type { EmailLoginVia, EmailSendStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** 메일 1통 = 1행 (이메일-로그인.md 2장, D-111). 토큰과 코드 원문은 받지 않는다 */
export interface NewChallenge {
  email: string;
  linkTokenHash: string;
  codeHash: string;
  expiresAt: Date;
  next: string;
  ipHash: string;
  isReview: boolean;
  sendStatus: EmailSendStatus;
  createdAt: Date;
}

/** 검증에 쓰는 행 모양 */
export interface ChallengeRow {
  id: number;
  email: string;
  linkTokenHash: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  usedAt: Date | null;
  invalidatedAt: Date | null;
  next: string;
  isReview: boolean;
}

const CHALLENGE_SELECT = {
  id: true,
  email: true,
  linkTokenHash: true,
  codeHash: true,
  attempts: true,
  expiresAt: true,
  usedAt: true,
  invalidatedAt: true,
  next: true,
  isReview: true,
} as const;

/** 최근 창 안의 행 수와 가장 오래된 행 시각 (횟수 제한, D-111) */
export interface RecentCount {
  count: number;
  oldest: Date | null;
}

/** 틀린 코드 기록 결과. counted false 면 이미 살아 있지 않은 행 */
export interface WrongCodeResult {
  counted: boolean;
  attempts: number;
  locked: boolean;
}

/** 살아 있는 메일: 쓰이지 않았고 무효가 아니고 만료 전 (2장) */
function live(now: Date) {
  return { usedAt: null, invalidatedAt: null, expiresAt: { gt: now } };
}

/** (#245) 이메일 로그인 발송 기록 (EmailLoginChallenge) */
@Injectable()
export class EmailLoginChallengesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 같은 이메일의 마지막 행 생성 시각 (60초 쿨다운) */
  async latestCreatedAtByEmail(email: string): Promise<Date | null> {
    const row = await this.prisma.emailLoginChallenge.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }

  /** since 이후 같은 이메일 행 수 (1시간 5통). 발송 실패 행도 센다 */
  countRecentByEmail(email: string, since: Date): Promise<RecentCount> {
    return this.countRecent({ email, createdAt: { gt: since } });
  }

  /** since 이후 같은 IP 해시 행 수 (1시간 20통) */
  countRecentByIp(ipHash: string, since: Date): Promise<RecentCount> {
    return this.countRecent({ ipHash, createdAt: { gt: since } });
  }

  /** 같은 이메일의 살아 있는 행을 무효로 하고 새 행을 넣는다. 한 트랜잭션 (4-2 request 3, 5단계). 새 행 id */
  invalidateLiveAndCreateTx(input: NewChallenge): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.emailLoginChallenge.updateMany({
        where: { email: input.email, ...live(input.createdAt) },
        data: { invalidatedAt: input.createdAt },
      });
      const row = await tx.emailLoginChallenge.create({ data: input, select: { id: true } });
      return row.id;
    });
  }

  /** 발송 결과 기록. 행을 넣을 때는 FAILED 로 두고 접수되면 SENT 로 바꾼다 (4-2 request 6단계) */
  async markSendResult(id: number, sendStatus: EmailSendStatus, providerMessageId: string | null): Promise<void> {
    await this.prisma.emailLoginChallenge.updateMany({ where: { id }, data: { sendStatus, providerMessageId } });
  }

  /** before 보다 먼저 만든 행 삭제 (30일 보관, 요청마다 청소). 지운 수 */
  async deleteCreatedBefore(before: Date): Promise<number> {
    const { count } = await this.prisma.emailLoginChallenge.deleteMany({ where: { createdAt: { lt: before } } });
    return count;
  }

  findById(id: number): Promise<ChallengeRow | null> {
    return this.prisma.emailLoginChallenge.findUnique({ where: { id }, select: CHALLENGE_SELECT });
  }

  findByLinkTokenHash(linkTokenHash: string): Promise<ChallengeRow | null> {
    return this.prisma.emailLoginChallenge.findUnique({ where: { linkTokenHash }, select: CHALLENGE_SELECT });
  }

  /** 같은 이메일의 살아 있는 최신 행. 새 요청이 이전 것을 무효로 하므로 보통 최대 1개 */
  findLatestLiveByEmail(email: string, now: Date): Promise<ChallengeRow | null> {
    return this.prisma.emailLoginChallenge.findFirst({
      where: { email, ...live(now) },
      orderBy: { id: 'desc' },
      select: CHALLENGE_SELECT,
    });
  }

  /**
   * 1회 소비. 살아 있는 행만 조건부 updateMany 한 문장으로 usedAt, usedVia 를 채운다.
   * 동시 요청 두 개 중 count 1 을 받은 쪽만 이긴다 (D-49 와 같은 방식)
   */
  async consume(id: number, via: EmailLoginVia, now: Date): Promise<boolean> {
    const { count } = await this.prisma.emailLoginChallenge.updateMany({
      where: { id, ...live(now) },
      data: { usedAt: now, usedVia: via },
    });
    return count === 1;
  }

  /**
   * 틀린 코드 1회. 살아 있고 attempts < max 인 행만 +1 하고, max 에 닿으면 같은 트랜잭션에서 invalidatedAt 을 채운다 (3장).
   * 첫 updateMany 가 행 잠금을 잡아 동시에 틀려도 횟수가 새지 않는다
   */
  registerWrongCodeTx(id: number, now: Date, maxAttempts: number): Promise<WrongCodeResult> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.emailLoginChallenge.updateMany({
        where: { id, attempts: { lt: maxAttempts }, ...live(now) },
        data: { attempts: { increment: 1 } },
      });
      const row = await tx.emailLoginChallenge.findUnique({ where: { id }, select: { attempts: true } });
      const attempts = row?.attempts ?? maxAttempts;
      if (count !== 1) return { counted: false, attempts, locked: false };
      if (attempts < maxAttempts) return { counted: true, attempts, locked: false };
      await tx.emailLoginChallenge.updateMany({ where: { id, invalidatedAt: null }, data: { invalidatedAt: now } });
      return { counted: true, attempts, locked: true };
    });
  }

  /** 처음 이메일이면 소비한 행에 가입 티켓 해시와 만료를 붙인다 (D-114) */
  async setSignupTicket(id: number, signupTokenHash: string, signupExpiresAt: Date): Promise<void> {
    await this.prisma.emailLoginChallenge.updateMany({ where: { id }, data: { signupTokenHash, signupExpiresAt } });
  }

  /** 만료 전 가입 티켓의 이메일과 next */
  findSignupTicket(signupTokenHash: string, now: Date): Promise<{ id: number; email: string; next: string } | null> {
    return this.prisma.emailLoginChallenge.findFirst({
      where: { signupTokenHash, signupExpiresAt: { gt: now } },
      select: { id: true, email: true, next: true },
    });
  }

  /** 가입 티켓 1회 소비. 조건부 updateMany 로 해시를 비운다. count 1 인 요청만 이긴다 */
  async consumeSignupTicket(signupTokenHash: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.emailLoginChallenge.updateMany({
      where: { signupTokenHash, signupExpiresAt: { gt: now } },
      data: { signupTokenHash: null },
    });
    return count === 1;
  }

  private async countRecent(where: { email?: string; ipHash?: string; createdAt: { gt: Date } }): Promise<RecentCount> {
    const result = await this.prisma.emailLoginChallenge.aggregate({ where, _count: { _all: true }, _min: { createdAt: true } });
    return { count: result._count._all, oldest: result._min.createdAt ?? null };
  }
}
