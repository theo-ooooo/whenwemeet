import { Injectable, Logger } from '@nestjs/common';
import type { LinkCandidate } from '../auth-link-tickets/auth-link-tickets.repository.js';
import { AppleAuthService } from '../auth/apple-auth.service.js';
import { assertFreshSession, LINK_INTENT_TTL_SECONDS, LinkTicketsService, type WebLinkProvider } from '../auth/link-tickets.service.js';
import { AuthProviders } from '../auth/providers/auth-providers.js';
import { KakaoProvider } from '../auth/providers/kakao.provider.js';
import { AppleProvider } from '../auth/providers/apple.provider.js';
import type { AuthProvider } from '../auth/providers/auth-provider.js';
import { AvatarsService } from '../avatars/avatars.service.js';
import { ApiException } from '../common/errors.js';
import { isUniqueViolation } from '../groups/invite-code.js';
import { maskEmail } from '../email-login/email-crypto.js';
import { EmailLoginService } from '../email-login/email-login.service.js';
import { type AuthAccountRow, AuthAccountsRepository, type LinkOutcome } from './auth-accounts.repository.js';
import type { LinkAuthAccountDto } from './dto/auth-accounts.dto.js';

/** GET /me/auth-accounts 의 한 줄 (#198, api.md) */
export interface AuthAccountView {
  id: number;
  provider: AuthProvider;
  /** 이메일은 가린 주소, 카카오 "카카오 계정", Apple "Apple ID" */
  label: string;
  createdAt: Date;
}

export interface LinkResult {
  account: AuthAccountView;
  /** 다른 빈 계정을 흡수했으면 true (정책 2, D-257) */
  absorbed: boolean;
}

/** 목록 표시 이름. Apple 은 이메일을 받지 않아(D-50) 주소를 보일 수 없다 */
export function accountLabel(row: Pick<AuthAccountRow, 'provider' | 'providerUserId' | 'email'>): string {
  switch (row.provider) {
    case 'KAKAO':
      return '카카오 계정';
    case 'APPLE':
      return 'Apple ID';
    case 'EMAIL':
      return maskEmail(row.email ?? row.providerUserId);
    case 'DEV':
      return `개발 계정 (${row.providerUserId})`;
    default:
      return row.provider;
  }
}

function toView(row: AuthAccountRow): AuthAccountView {
  return { id: row.id, provider: row.provider, label: accountLabel(row), createdAt: row.createdAt };
}

/** 동시 연결로 유일키 충돌(P2002)이나 교착(P2034)이 나면 한 번 다시 판정한다 */
function isRetryable(error: unknown): boolean {
  return isUniqueViolation(error) || (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2034');
}

/**
 * (#198) 내 정보 > 로그인 방법 (D-257). 연결은 세션(최근 로그인 10분) + 두 번째 로그인의 소유 증명 둘 다로만 한다.
 * 같은 사람 판단은 사용자가 직접 연결한 것뿐(자동 병합 없음). 이미 다른 계정이면 그 계정이 비었을 때만 흡수
 */
@Injectable()
export class AuthAccountsService {
  private readonly logger = new Logger('AuthAccounts');

  constructor(
    private readonly accounts: AuthAccountsRepository,
    private readonly linkTickets: LinkTicketsService,
    private readonly kakao: KakaoProvider,
    private readonly apple: AppleProvider,
    private readonly appleAuth: AppleAuthService,
    private readonly emailLogin: EmailLoginService,
    private readonly providers: AuthProviders,
    private readonly avatars: AvatarsService,
  ) {}

  /** GET /me/auth-accounts */
  async list(userId: number): Promise<AuthAccountView[]> {
    return (await this.accounts.list(userId)).map(toView);
  }

  /**
   * POST /me/auth-accounts/link-start. 웹 OAuth 연결의 시작 표식(10분, 시작한 사용자 id 서명).
   * 최근 로그인이 아니면 409 REAUTH_REQUIRED, 같은 제공자가 이미 있으면 409 PROVIDER_ALREADY_LINKED, 미설정이면 503
   */
  async start(userId: number, iat: number | null, provider: WebLinkProvider): Promise<{ intent: string; expiresIn: number }> {
    assertFreshSession(iat);
    if (await this.accounts.hasProvider(userId, provider)) throw new ApiException('PROVIDER_ALREADY_LINKED');
    if (provider === 'KAKAO' && !this.kakao.isLoginConfigured()) throw new ApiException('KAKAO_NOT_CONFIGURED');
    if (provider === 'APPLE') this.apple.assertConfigured();
    return { intent: await this.linkTickets.createIntent(userId, provider), expiresIn: LINK_INTENT_TTL_SECONDS };
  }

  /**
   * POST /me/auth-accounts. 최근 로그인 검사 → 두 번째 로그인 증명 확인(티켓 소비, 앱 토큰 검증, 이메일 코드 소비) → 연결 트랜잭션.
   * 200 { account, absorbed } / 409 PROVIDER_ALREADY_LINKED | AUTH_ACCOUNT_IN_USE | REAUTH_REQUIRED
   */
  async link(userId: number, iat: number | null, dto: LinkAuthAccountDto): Promise<LinkResult> {
    assertFreshSession(iat);
    const candidate = await this.proof(userId, dto);
    let outcome: LinkOutcome;
    try {
      outcome = await this.accounts.linkTx(userId, candidate);
    } catch (error) {
      if (!isRetryable(error)) throw error;
      outcome = await this.accounts.linkTx(userId, candidate);
    }
    switch (outcome.kind) {
      case 'ALREADY_MINE':
        return { account: toView(outcome.account), absorbed: false };
      case 'PROVIDER_TAKEN':
        throw new ApiException('PROVIDER_ALREADY_LINKED');
      case 'IN_USE':
        this.logger.log(`link userId=${userId} provider=${candidate.provider} result=IN_USE blockers=${outcome.blockers.join(',')}`);
        throw new ApiException('AUTH_ACCOUNT_IN_USE');
      case 'LINKED':
        if (outcome.absorbed) {
          // 행은 커밋됐다. 저장소 객체는 실패해도 로그만 (탈퇴와 같은 원칙)
          await this.avatars.purgeFiles(outcome.absorbed.files);
          this.logger.log(`link userId=${userId} provider=${candidate.provider} result=ABSORBED absorbedUserId=${outcome.absorbed.userId}`);
        } else {
          this.logger.log(`link userId=${userId} provider=${candidate.provider} result=LINKED`);
        }
        return { account: toView(outcome.account), absorbed: outcome.absorbed !== null };
    }
  }

  /**
   * DELETE /me/auth-accounts/:id. 마지막 하나면 409 LAST_AUTH_ACCOUNT. 제공자 unlink(카카오 연결 끊기, Apple 토큰 폐기)를
   * 먼저 하고 실패하면 502 로 DB 를 건드리지 않는다 (탈퇴와 같은 원칙). 세션은 사용자 단위라 그대로
   */
  async unlink(userId: number, accountId: number): Promise<{ ok: true }> {
    const account = await this.accounts.findOwned(userId, accountId);
    if (!account) throw new ApiException('NOT_FOUND');
    if ((await this.accounts.countByUser(userId)) <= 1) throw new ApiException('LAST_AUTH_ACCOUNT');
    await this.providers.get(account.provider).unlink(account);
    const outcome = await this.accounts.unlinkTx(userId, accountId);
    if (outcome === 'NOT_FOUND') throw new ApiException('NOT_FOUND');
    if (outcome === 'LAST') throw new ApiException('LAST_AUTH_ACCOUNT');
    this.logger.log(`unlink userId=${userId} provider=${account.provider}`);
    return { ok: true };
  }

  /** 두 번째 로그인의 소유 증명 → 연결할 계정. 본문은 넷 중 정확히 하나 */
  private async proof(userId: number, dto: LinkAuthAccountDto): Promise<LinkCandidate> {
    if ((dto.ticket === undefined) === (dto.provider === undefined)) {
      throw new ApiException('VALIDATION_FAILED', 'ticket 또는 provider 중 하나만 보내 주세요', [{ field: 'provider', message: 'ticket 또는 provider 중 하나만 보내 주세요' }]);
    }
    if (dto.ticket !== undefined) return this.linkTickets.consume(userId, dto.ticket);
    switch (dto.provider) {
      case 'KAKAO': {
        // /auth/kakao/native 와 같은 검증: access_token_info 의 app_id → 프로필
        await this.kakao.verifyAppToken(dto.accessToken!);
        const profile = await this.kakao.fetchProfile(dto.accessToken!);
        return { provider: 'KAKAO', providerUserId: profile.providerUserId, email: null, rawProfile: profile.raw };
      }
      case 'APPLE': {
        // /auth/apple/native 와 같은 검증: identity token(번들 ID, nonce) → 코드 교환 → sub 일치. refresh token 은 해제 때 폐기용
        const profile = await this.appleAuth.verifyNative({ identityToken: dto.identityToken!, authorizationCode: dto.authorizationCode!, nonce: dto.nonce! });
        return { provider: 'APPLE', providerUserId: profile.providerUserId, email: null, rawProfile: profile.raw, ...(profile.credentials ? { credentials: profile.credentials } : {}) };
      }
      default: {
        const email = await this.emailLogin.verifyLinkCode(userId, dto.email!, dto.code!);
        return { provider: 'EMAIL', providerUserId: email, email, rawProfile: null };
      }
    }
  }
}
