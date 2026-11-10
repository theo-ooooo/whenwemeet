import { Injectable } from '@nestjs/common';
import { AuthHandoffsRepository } from '../auth-handoffs/auth-handoffs.repository.js';
import { ApiException } from '../common/errors.js';
import { AuthService } from './auth.service.js';
import { randomToken, s256Challenge, sha256hex } from './pkce.js';
import { KakaoProvider } from './providers/kakao.provider.js';

/** handoff 유효 시간(초). 응답의 expiresIn 과 같다 (앱.md 2.1) */
export const HANDOFF_TTL_SECONDS = 60;

/** 만료 후 이만큼 지난 handoff 는 발급 때 지운다 (앱.md 2.1 청소) */
const HANDOFF_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface HandoffIssued {
  handoff: string;
  expiresIn: number;
}

/**
 * 앱(Expo 셸) 로그인 (앱.md 2 ~ 3장). 셸은 세션 JWT 를 받지 않고 60초 1회용 handoff 만 받는다 (D-44).
 * 웹 서버가 handoff + verifier 를 세션 JWT 로 바꿔 쿠키에 싣는다
 */
@Injectable()
export class AppAuthService {
  constructor(
    private readonly handoffs: AuthHandoffsRepository,
    private readonly auth: AuthService,
    private readonly kakao: KakaoProvider,
  ) {}

  /**
   * POST /auth/kakao/native (앱.md 3.1).
   * access_token_info 로 우리 앱의 토큰인지 확인 → 웹 콜백과 같은 프로필 조회와 로그인(upsert, 신규면 사진 복사) → handoff
   */
  async loginWithKakao(accessToken: string, codeChallenge: string): Promise<HandoffIssued> {
    await this.kakao.verifyAppToken(accessToken);
    const profile = await this.kakao.fetchProfile(accessToken);
    const user = await this.auth.login(this.kakao.provider, profile);
    return this.issueHandoff(user.id, codeChallenge);
  }

  /** handoff 발급. 토큰은 응답에만 있고 DB 에는 해시만 남는다. 오래된 행 청소를 겸한다 (앱.md 2.1) */
  async issueHandoff(userId: number, codeChallenge: string): Promise<HandoffIssued> {
    const now = Date.now();
    await this.handoffs.deleteExpiredBefore(new Date(now - HANDOFF_RETENTION_MS));
    const handoff = randomToken();
    await this.handoffs.create({
      userId,
      tokenHash: sha256hex(handoff),
      codeChallenge,
      expiresAt: new Date(now + HANDOFF_TTL_SECONDS * 1000),
    });
    return { handoff, expiresIn: HANDOFF_TTL_SECONDS };
  }

  /**
   * POST /auth/handoff (앱.md 2.2). 1회 소비 후 세션 JWT.
   * 없음, 만료, 사용됨, verifier 불일치는 모두 401 HANDOFF_INVALID (어느 것인지 알려주지 않는다)
   */
  async exchangeHandoff(handoff: string, verifier: string): Promise<{ token: string }> {
    const userId = await this.handoffs.consume(sha256hex(handoff), s256Challenge(verifier), new Date());
    if (userId === null) throw new ApiException('HANDOFF_INVALID');
    return { token: await this.auth.signToken(userId) };
  }
}
