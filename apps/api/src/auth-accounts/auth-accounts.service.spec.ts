import { ApiException } from '../common/errors.js';
import { accountLabel, AuthAccountsService } from './auth-accounts.service.js';

const NOW_SEC = () => Math.floor(Date.now() / 1000);
const row = (over: object = {}) => ({
  id: 3,
  provider: 'KAKAO',
  providerUserId: '99',
  email: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  ...over,
});

describe('accountLabel', () => {
  it('카카오, Apple 은 고정 문구, 이메일은 가린 주소', () => {
    expect(accountLabel(row() as never)).toBe('카카오 계정');
    expect(accountLabel(row({ provider: 'APPLE' }) as never)).toBe('Apple ID');
    expect(
      accountLabel(
        row({
          provider: 'EMAIL',
          providerUserId: 'kim@gmail.com',
          email: 'kim@gmail.com',
        }) as never,
      ),
    ).toBe('ki***@gmail.com');
  });
});

describe('AuthAccountsService (#198)', () => {
  const accounts = {
    list: vi.fn(),
    findOwned: vi.fn(),
    countByUser: vi.fn(),
    hasProvider: vi.fn(),
    linkTx: vi.fn(),
    unlinkTx: vi.fn(),
  };
  const linkTickets = {
    consume: vi.fn(),
    createIntent: vi.fn(async () => 'INTENT'),
  };
  const kakao = {
    verifyAppToken: vi.fn(),
    fetchProfile: vi.fn(),
    isLoginConfigured: vi.fn(() => true),
  };
  const apple = { assertConfigured: vi.fn() };
  const appleAuth = { verifyNative: vi.fn() };
  const emailLogin = { verifyLinkCode: vi.fn() };
  const unlink = vi.fn();
  const providers = { get: vi.fn(() => ({ unlink })) };
  const avatars = { purgeFiles: vi.fn() };
  const service = new AuthAccountsService(
    accounts as never,
    linkTickets as never,
    kakao as never,
    apple as never,
    appleAuth as never,
    emailLogin as never,
    providers as never,
    avatars as never,
  );

  beforeEach(() => {
    for (const fn of [
      ...Object.values(accounts),
      linkTickets.consume,
      kakao.verifyAppToken,
      kakao.fetchProfile,
      appleAuth.verifyNative,
      emailLogin.verifyLinkCode,
      unlink,
      avatars.purgeFiles,
    ])
      fn.mockReset();
  });

  describe('link', () => {
    it('오래된 세션이면 증명을 소비하기 전에 409 REAUTH_REQUIRED', async () => {
      await expect(
        service.link(1, NOW_SEC() - 601, { ticket: 't' }),
      ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
      await expect(
        service.link(1, null, { ticket: 't' }),
      ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
      expect(linkTickets.consume).not.toHaveBeenCalled();
    });

    it('ticket 과 provider 는 정확히 하나', async () => {
      await expect(service.link(1, NOW_SEC(), {})).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await expect(
        service.link(1, NOW_SEC(), {
          ticket: 't',
          provider: 'KAKAO',
          accessToken: 'a',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('티켓 → 연결, 흡수했으면 파일 객체를 커밋 뒤에 지운다', async () => {
      linkTickets.consume.mockResolvedValue({
        provider: 'KAKAO',
        providerUserId: '99',
        email: null,
        rawProfile: null,
      });
      accounts.linkTx.mockResolvedValue({
        kind: 'LINKED',
        account: row(),
        absorbed: {
          userId: 9,
          files: [{ provider: 'R2', bucket: 'b', key: 'k' }],
        },
      });
      expect(await service.link(1, NOW_SEC(), { ticket: 't' })).toEqual({
        account: {
          id: 3,
          provider: 'KAKAO',
          label: '카카오 계정',
          createdAt: row().createdAt,
        },
        absorbed: true,
      });
      expect(linkTickets.consume).toHaveBeenCalledWith(1, 't');
      expect(avatars.purgeFiles).toHaveBeenCalledWith([
        { provider: 'R2', bucket: 'b', key: 'k' },
      ]);
    });

    it('결과별 응답: 이미 내 것 200, 같은 제공자 409, 다른 계정에 데이터 409', async () => {
      linkTickets.consume.mockResolvedValue({
        provider: 'KAKAO',
        providerUserId: '99',
        email: null,
        rawProfile: null,
      });
      accounts.linkTx.mockResolvedValueOnce({
        kind: 'ALREADY_MINE',
        account: row(),
      });
      await expect(
        service.link(1, NOW_SEC(), { ticket: 't' }),
      ).resolves.toMatchObject({ absorbed: false });
      accounts.linkTx.mockResolvedValueOnce({ kind: 'PROVIDER_TAKEN' });
      await expect(
        service.link(1, NOW_SEC(), { ticket: 't' }),
      ).rejects.toMatchObject({ code: 'PROVIDER_ALREADY_LINKED' });
      accounts.linkTx.mockResolvedValueOnce({
        kind: 'IN_USE',
        blockers: ['group.events'],
      });
      await expect(
        service.link(1, NOW_SEC(), { ticket: 't' }),
      ).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_IN_USE' });
      expect(avatars.purgeFiles).not.toHaveBeenCalled();
    });

    it('동시 연결의 유일키 충돌은 한 번 다시 판정한다. 그 밖의 오류는 그대로', async () => {
      linkTickets.consume.mockResolvedValue({
        provider: 'KAKAO',
        providerUserId: '99',
        email: null,
        rawProfile: null,
      });
      accounts.linkTx
        .mockRejectedValueOnce(
          Object.assign(new Error('dup'), { code: 'P2002' }),
        )
        .mockResolvedValueOnce({ kind: 'IN_USE', blockers: ['memberships'] });
      await expect(
        service.link(1, NOW_SEC(), { ticket: 't' }),
      ).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_IN_USE' });
      accounts.linkTx.mockRejectedValueOnce(new Error('boom'));
      await expect(service.link(1, NOW_SEC(), { ticket: 't' })).rejects.toThrow(
        'boom',
      );
    });

    it('앱 카카오: /auth/kakao/native 와 같은 검증(app_id) 뒤 프로필', async () => {
      kakao.fetchProfile.mockResolvedValue({
        providerUserId: '55',
        raw: { id: 55 },
      });
      accounts.linkTx.mockResolvedValue({
        kind: 'LINKED',
        account: row({ providerUserId: '55' }),
        absorbed: null,
      });
      await service.link(1, NOW_SEC(), {
        provider: 'KAKAO',
        accessToken: 'AT',
      });
      expect(kakao.verifyAppToken).toHaveBeenCalledWith('AT');
      expect(accounts.linkTx).toHaveBeenCalledWith(1, {
        provider: 'KAKAO',
        providerUserId: '55',
        email: null,
        rawProfile: { id: 55 },
      });
      kakao.verifyAppToken.mockRejectedValueOnce(
        new ApiException('SOCIAL_TOKEN_INVALID'),
      );
      await expect(
        service.link(1, NOW_SEC(), { provider: 'KAKAO', accessToken: 'AT' }),
      ).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });
    });

    it('앱 Apple: 네이티브 검증 재사용, refresh token 을 해제 때 폐기용으로 넘긴다', async () => {
      appleAuth.verifyNative.mockResolvedValue({
        providerUserId: 'sub',
        raw: { sub: 'sub' },
        credentials: { providerClientId: 'bundle', refreshToken: 'RT' },
      });
      accounts.linkTx.mockResolvedValue({
        kind: 'LINKED',
        account: row({ provider: 'APPLE' }),
        absorbed: null,
      });
      await service.link(1, NOW_SEC(), {
        provider: 'APPLE',
        identityToken: 'I',
        authorizationCode: 'C',
        nonce: 'n'.repeat(32),
      });
      expect(appleAuth.verifyNative).toHaveBeenCalledWith({
        identityToken: 'I',
        authorizationCode: 'C',
        nonce: 'n'.repeat(32),
      });
      expect(accounts.linkTx).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          provider: 'APPLE',
          credentials: { providerClientId: 'bundle', refreshToken: 'RT' },
        }),
      );
    });

    it('이메일: 내가 요청한 LINK 코드 확인 → 정규화 이메일로 연결', async () => {
      emailLogin.verifyLinkCode.mockResolvedValue('kim@x.com');
      accounts.linkTx.mockResolvedValue({
        kind: 'LINKED',
        account: row({
          provider: 'EMAIL',
          providerUserId: 'kim@x.com',
          email: 'kim@x.com',
        }),
        absorbed: null,
      });
      const result = await service.link(1, NOW_SEC(), {
        provider: 'EMAIL',
        email: 'kim@x.com',
        code: '123456',
      });
      expect(emailLogin.verifyLinkCode).toHaveBeenCalledWith(
        1,
        'kim@x.com',
        '123456',
      );
      expect(result.account.label).toBe('ki***@x.com');
    });
  });

  describe('start', () => {
    it('최근 로그인, 같은 제공자 없음, 설정 확인 뒤 표식', async () => {
      accounts.hasProvider.mockResolvedValue(false);
      expect(await service.start(1, NOW_SEC(), 'KAKAO')).toEqual({
        intent: 'INTENT',
        expiresIn: 600,
      });
      await expect(
        service.start(1, NOW_SEC() - 700, 'KAKAO'),
      ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
      accounts.hasProvider.mockResolvedValue(true);
      await expect(service.start(1, NOW_SEC(), 'APPLE')).rejects.toMatchObject({
        code: 'PROVIDER_ALREADY_LINKED',
      });
      accounts.hasProvider.mockResolvedValue(false);
      kakao.isLoginConfigured.mockReturnValueOnce(false);
      await expect(service.start(1, NOW_SEC(), 'KAKAO')).rejects.toMatchObject({
        code: 'KAKAO_NOT_CONFIGURED',
      });
    });
  });

  describe('unlink', () => {
    it('없으면 404, 마지막 하나면 409 이고 제공자를 부르지 않는다', async () => {
      accounts.findOwned.mockResolvedValueOnce(null);
      await expect(service.unlink(1, 3)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      accounts.findOwned.mockResolvedValueOnce(row());
      accounts.countByUser.mockResolvedValueOnce(1);
      await expect(service.unlink(1, 3)).rejects.toMatchObject({
        code: 'LAST_AUTH_ACCOUNT',
      });
      expect(unlink).not.toHaveBeenCalled();
    });

    it('제공자 unlink 실패면 502 그대로, DB 는 건드리지 않는다', async () => {
      accounts.findOwned.mockResolvedValue(row());
      accounts.countByUser.mockResolvedValue(2);
      unlink.mockRejectedValueOnce(new ApiException('KAKAO_ERROR'));
      await expect(service.unlink(1, 3)).rejects.toMatchObject({
        code: 'KAKAO_ERROR',
      });
      expect(accounts.unlinkTx).not.toHaveBeenCalled();
    });

    it('성공, 그리고 트랜잭션 안에서 마지막이 됐으면 409', async () => {
      accounts.findOwned.mockResolvedValue(row());
      accounts.countByUser.mockResolvedValue(2);
      accounts.unlinkTx.mockResolvedValueOnce('DELETED');
      expect(await service.unlink(1, 3)).toEqual({ ok: true });
      accounts.unlinkTx.mockResolvedValueOnce('LAST');
      await expect(service.unlink(1, 3)).rejects.toMatchObject({
        code: 'LAST_AUTH_ACCOUNT',
      });
      accounts.unlinkTx.mockResolvedValueOnce('NOT_FOUND');
      await expect(service.unlink(1, 3)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
