import { AuthHandoffsRepository } from '../auth-handoffs/auth-handoffs.repository.js';
import { ApiException } from '../common/errors.js';
import { UsersRepository } from '../users/users.repository.js';
import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { AppAuthService, HANDOFF_TTL_SECONDS } from './app-auth.service.js';
import { s256Challenge, sha256hex } from './pkce.js';

const VERIFIER = 'v'.repeat(43);
const CHALLENGE = s256Challenge(VERIFIER);

describe('AppAuthService', () => {
  let handoffs: RepositoryMock<AuthHandoffsRepository>;
  let users: RepositoryMock<UsersRepository>;
  let service: AppAuthService;
  const auth = {
    login: vi.fn(),
    signToken: vi.fn(async (id: number) => `jwt-for-${id}`),
  };
  const kakao = {
    provider: 'KAKAO' as const,
    verifyAppToken: vi.fn(),
    fetchProfile: vi.fn(),
  };
  const profile = {
    providerUserId: '77',
    nickname: '앱유저',
    profileImageUrl: 'https://img',
    raw: { id: 77 },
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-10T00:00:00.000Z') });
    handoffs = mockRepository(AuthHandoffsRepository);
    handoffs.create.mockResolvedValue(undefined);
    handoffs.deleteExpiredBefore.mockResolvedValue(0);
    auth.signToken.mockClear();
    auth.login.mockReset().mockResolvedValue({
      id: 3,
      nickname: '앱유저',
      profileImageUrl: null,
      createdAt: new Date(),
    });
    kakao.verifyAppToken.mockReset().mockResolvedValue(undefined);
    kakao.fetchProfile.mockReset().mockResolvedValue(profile);
    users = mockRepository(UsersRepository);
    users.markAppLogin.mockResolvedValue(undefined);
    service = new AppAuthService(
      handoffs as never,
      auth as never,
      kakao as never,
      users as never,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('issueHandoff', () => {
    it('해시와 challenge 만 저장하고 원문은 응답에만, 60초 유효, 하루 지난 행 청소', async () => {
      const issued = await service.issueHandoff(3, CHALLENGE);
      expect(issued.expiresIn).toBe(HANDOFF_TTL_SECONDS);
      expect(issued.handoff).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(handoffs.create).toHaveBeenCalledWith({
        userId: 3,
        tokenHash: sha256hex(issued.handoff),
        codeChallenge: CHALLENGE,
        expiresAt: new Date('2026-11-10T00:01:00.000Z'),
      });
      expect(handoffs.deleteExpiredBefore).toHaveBeenCalledWith(
        new Date('2026-11-09T00:00:00.000Z'),
      );
      expect(JSON.stringify(handoffs.create.mock.calls)).not.toContain(
        issued.handoff,
      );
    });
  });

  describe('exchangeHandoff', () => {
    it('해시, verifier 의 S256, 현재 시각으로 1회 소비하고 세션 JWT', async () => {
      handoffs.consume.mockResolvedValue(3);
      expect(await service.exchangeHandoff('h'.repeat(43), VERIFIER)).toEqual({
        token: 'jwt-for-3',
      });
      expect(handoffs.consume).toHaveBeenCalledWith(
        sha256hex('h'.repeat(43)),
        CHALLENGE,
        new Date('2026-11-10T00:00:00.000Z'),
      );
      // (#188) 앱 로그인 시각 기록 (D-97)
      expect(users.markAppLogin).toHaveBeenCalledWith(
        3,
        new Date('2026-11-10T00:00:00.000Z'),
      );
    });

    it('발급 후 교환 성공, 두 번째 교환은 401 (Repository 가 이미 쓴 행을 거절)', async () => {
      const { handoff } = await service.issueHandoff(3, CHALLENGE);
      const stored = handoffs.create.mock.calls[0][0];
      let used = false;
      handoffs.consume.mockImplementation(async (hash, challenge, now) => {
        if (
          used ||
          hash !== stored.tokenHash ||
          challenge !== stored.codeChallenge ||
          now >= stored.expiresAt
        )
          return null;
        used = true;
        return stored.userId;
      });
      expect(await service.exchangeHandoff(handoff, VERIFIER)).toEqual({
        token: 'jwt-for-3',
      });
      await expect(
        service.exchangeHandoff(handoff, VERIFIER),
      ).rejects.toMatchObject({ code: 'HANDOFF_INVALID' });
    });

    it('61초 뒤, verifier 불일치, 없는 handoff 는 모두 401 HANDOFF_INVALID', async () => {
      const { handoff } = await service.issueHandoff(3, CHALLENGE);
      const stored = handoffs.create.mock.calls[0][0];
      handoffs.consume.mockImplementation(async (hash, challenge, now) =>
        hash === stored.tokenHash &&
        challenge === stored.codeChallenge &&
        now < stored.expiresAt
          ? stored.userId
          : null,
      );

      await expect(
        service.exchangeHandoff(handoff, 'w'.repeat(43)),
      ).rejects.toMatchObject({ code: 'HANDOFF_INVALID' });
      await expect(
        service.exchangeHandoff('x'.repeat(43), VERIFIER),
      ).rejects.toMatchObject({ code: 'HANDOFF_INVALID' });
      vi.setSystemTime(new Date('2026-11-10T00:01:01.000Z'));
      const expired = service.exchangeHandoff(handoff, VERIFIER);
      await expect(expired).rejects.toBeInstanceOf(ApiException);
      await expect(expired).rejects.toMatchObject({
        code: 'HANDOFF_INVALID',
        status: 401,
      });
      expect(auth.signToken).not.toHaveBeenCalled();
      expect(users.markAppLogin).not.toHaveBeenCalled();
    });
  });

  describe('loginWithKakao (앱.md 3.1)', () => {
    it('토큰 확인 → 웹과 같은 프로필 조회와 login → handoff', async () => {
      const issued = await service.loginWithKakao('AT', CHALLENGE);
      expect(kakao.verifyAppToken).toHaveBeenCalledWith('AT');
      expect(kakao.fetchProfile).toHaveBeenCalledWith('AT');
      expect(auth.login).toHaveBeenCalledWith('KAKAO', profile);
      expect(handoffs.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 3, codeChallenge: CHALLENGE }),
      );
      expect(issued.expiresIn).toBe(60);
      expect(kakao.verifyAppToken.mock.invocationCallOrder[0]).toBeLessThan(
        kakao.fetchProfile.mock.invocationCallOrder[0],
      );
    });

    it.each([
      'SOCIAL_TOKEN_INVALID',
      'KAKAO_ERROR',
      'KAKAO_NOT_CONFIGURED',
    ] as const)(
      '토큰 확인 실패(%s) 면 프로필 조회, 로그인, 발급 모두 하지 않는다',
      async (code) => {
        kakao.verifyAppToken.mockRejectedValue(new ApiException(code));
        await expect(
          service.loginWithKakao('AT', CHALLENGE),
        ).rejects.toMatchObject({ code });
        expect(kakao.fetchProfile).not.toHaveBeenCalled();
        expect(auth.login).not.toHaveBeenCalled();
        expect(handoffs.create).not.toHaveBeenCalled();
      },
    );
  });
});
