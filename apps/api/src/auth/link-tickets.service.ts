import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuthLinkTicketsRepository,
  type LinkCandidate,
} from '../auth-link-tickets/auth-link-tickets.repository.js';
import { ApiException } from '../common/errors.js';
import { randomToken, sha256hex } from './pkce.js';
import type { ProviderProfile } from './providers/auth-provider.js';

/** 연결 티켓 유효 시간(초, D-257) */
export const LINK_TICKET_TTL_SECONDS = 5 * 60;
/** 연결 시작 표식(intent) 유효 시간(초). 카카오, Apple 화면에서 머무는 시간을 감안해 티켓보다 길다 */
export const LINK_INTENT_TTL_SECONDS = 10 * 60;
/** 최근 로그인 기준(초). 세션 JWT 의 iat 가 이 안이어야 연결할 수 있다 (이슈 #198 정할 것 3) */
export const LINK_FRESH_SESSION_SECONDS = 10 * 60;
/** 만료 후 이만큼 지난 티켓은 발급 때 지운다 */
const TICKET_RETENTION_MS = 24 * 60 * 60 * 1000;
/** 연결 시작 표식의 typ. 세션 JWT 와 섞이지 않게 sub 를 싣지 않는다 */
const INTENT_TYPE = 'wwm-link-intent';

/** 웹 OAuth 로 연결할 수 있는 제공자 */
export type WebLinkProvider = 'KAKAO' | 'APPLE';

/**
 * 최근 로그인 검사 (D-257). iat 가 없거나 10분이 지났으면 409 REAUTH_REQUIRED.
 * 서버 간 시계 차이로 미래 쪽은 1분까지 허용 (웹 isFreshSession 과 같은 기준)
 */
export function assertFreshSession(
  iat: number | null,
  nowMs = Date.now(),
): void {
  const nowSec = nowMs / 1000;
  if (
    iat === null ||
    iat > nowSec + 60 ||
    nowSec - iat > LINK_FRESH_SESSION_SECONDS
  )
    throw new ApiException('REAUTH_REQUIRED');
}

/**
 * (#198) 로그인 방법 연결의 두 갈래 증표 (D-257).
 * - 시작 표식(intent): 로그인한 웹 서버가 받아 `/auth/kakao?mode=link&intent=` 에 싣는다. 시작한 사용자 id 를 서명해 담고
 *   OAuth state 를 거쳐 콜백까지 간다. sub 가 없어 세션으로 쓰이지 않는다
 * - 티켓: 콜백이 두 번째 로그인 결과를 담아 발급. 5분 1회용, DB 에는 해시만, 시작한 사용자의 세션으로만 소비
 */
@Injectable()
export class LinkTicketsService {
  constructor(
    private readonly jwt: JwtService,
    private readonly tickets: AuthLinkTicketsRepository,
  ) {}

  createIntent(userId: number, provider: WebLinkProvider): Promise<string> {
    return this.jwt.signAsync(
      { typ: INTENT_TYPE, uid: userId, prv: provider },
      { expiresIn: LINK_INTENT_TTL_SECONDS },
    );
  }

  /** 시작 표식 → 시작한 사용자 id. 서명, 만료, 종류, 제공자가 하나라도 틀리면 null */
  async verifyIntent(
    intent: unknown,
    provider: WebLinkProvider,
  ): Promise<number | null> {
    if (typeof intent !== 'string' || !intent || intent.length > 1024)
      return null;
    try {
      const payload = await this.jwt.verifyAsync<{
        typ?: unknown;
        uid?: unknown;
        prv?: unknown;
        sub?: unknown;
      }>(intent);
      if (
        payload.typ !== INTENT_TYPE ||
        payload.prv !== provider ||
        payload.sub !== undefined
      )
        return null;
      return typeof payload.uid === 'number' &&
        Number.isInteger(payload.uid) &&
        payload.uid > 0
        ? payload.uid
        : null;
    } catch {
      return null;
    }
  }

  /** 티켓 발급. 원문은 돌려주는 값에만 있고 DB 에는 해시만. 오래된 행 청소를 겸한다 */
  async issue(
    userId: number,
    provider: WebLinkProvider,
    profile: ProviderProfile,
    now = new Date(),
  ): Promise<string> {
    await this.tickets.deleteExpiredBefore(
      new Date(now.getTime() - TICKET_RETENTION_MS),
    );
    const ticket = randomToken();
    await this.tickets.create({
      userId,
      tokenHash: sha256hex(ticket),
      provider,
      providerUserId: profile.providerUserId,
      email: profile.email ?? null,
      rawProfile: profile.raw,
      ...(profile.credentials ? { credentials: profile.credentials } : {}),
      expiresAt: new Date(now.getTime() + LINK_TICKET_TTL_SECONDS * 1000),
    });
    return ticket;
  }

  /** 티켓 소비. 없음, 만료, 사용됨, 다른 사용자가 시작한 티켓은 모두 400 LINK_TICKET_INVALID */
  async consume(
    userId: number,
    ticket: string,
    now = new Date(),
  ): Promise<LinkCandidate> {
    const candidate = await this.tickets.consume(
      sha256hex(ticket),
      userId,
      now,
    );
    if (!candidate) throw new ApiException('LINK_TICKET_INVALID');
    return candidate;
  }
}
