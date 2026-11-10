import { AuthProviders } from '../auth/providers/auth-providers.js';
import { DevProvider } from '../auth/providers/dev.provider.js';
import { ApiException } from '../common/errors.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import { MeService } from './me.service.js';

describe('MeService', () => {
  let users: RepositoryMock<UsersRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let service: MeService;
  const kakao = { provider: 'KAKAO' as const, exchangeCode: vi.fn(), unlink: vi.fn() };
  const apple = { provider: 'APPLE' as const, unlink: vi.fn() };
  const dev = new DevProvider();
  const devUnlink = vi.spyOn(dev, 'unlink');
  const avatars = { purgeObjects: vi.fn() };

  beforeEach(() => {
    users = mockRepository(UsersRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    kakao.unlink.mockReset();
    apple.unlink.mockReset().mockResolvedValue(undefined);
    devUnlink.mockClear();
    avatars.purgeObjects.mockReset().mockResolvedValue(undefined);
    service = new MeService(users as never, membershipsRepo as never, new AuthProviders(kakao as never, dev, apple as never), avatars as never);
    membershipsRepo.listByUserWithGroupType.mockResolvedValue([
      { id: 501, groupId: 21, groupType: 'PERSONAL' },
      { id: 502, groupId: 31, groupType: 'TEAM' },
      { id: 503, groupId: 32, groupType: 'TEAM' },
    ]);
    users.deleteAccountTx.mockResolvedValue(undefined);
  });

  it('unlink 실패 시 DB 는 건드리지 않는다', async () => {
    users.listAuthAccounts.mockResolvedValue([{ provider: 'KAKAO', providerUserId: '123', providerClientId: null, refreshToken: null }]);
    kakao.unlink.mockRejectedValue(new ApiException('KAKAO_ERROR'));
    await expect(service.deleteAccount(1)).rejects.toMatchObject({ code: 'KAKAO_ERROR' });
    expect(membershipsRepo.listByUserWithGroupType).not.toHaveBeenCalled();
    expect(avatars.purgeObjects).not.toHaveBeenCalled();
    expect(users.deleteAccountTx).not.toHaveBeenCalled();
  });

  it('연결 계정마다 제공자별 unlink → 개인 팀은 삭제, 팀 멤버십은 나가기로 나눠 한 트랜잭션에 넘긴다', async () => {
    users.listAuthAccounts.mockResolvedValue([
      { provider: 'KAKAO', providerUserId: '123', providerClientId: null, refreshToken: null },
      { provider: 'DEV', providerUserId: '개발', providerClientId: null, refreshToken: null },
    ]);
    kakao.unlink.mockResolvedValue(undefined);
    expect(await service.deleteAccount(1)).toEqual({ ok: true });
    expect(users.listAuthAccounts).toHaveBeenCalledWith(1);
    expect(kakao.unlink).toHaveBeenCalledWith({ provider: 'KAKAO', providerUserId: '123', providerClientId: null, refreshToken: null });
    expect(devUnlink).toHaveBeenCalledWith({ provider: 'DEV', providerUserId: '개발', providerClientId: null, refreshToken: null });
    expect(avatars.purgeObjects).toHaveBeenCalledWith(1);
    expect(avatars.purgeObjects.mock.invocationCallOrder[0]).toBeLessThan(users.deleteAccountTx.mock.invocationCallOrder[0]);
    expect(users.deleteAccountTx).toHaveBeenCalledTimes(1);
    expect(users.deleteAccountTx).toHaveBeenCalledWith(1, {
      deleteGroupIds: [21],
      leave: [
        { membershipId: 502, groupId: 31 },
        { membershipId: 503, groupId: 32 },
      ],
    });
  });

  it('개발 사용자(DEV 계정만) 는 카카오를 부르지 않는다', async () => {
    users.listAuthAccounts.mockResolvedValue([{ provider: 'DEV', providerUserId: '개발', providerClientId: null, refreshToken: null }]);
    expect(await service.deleteAccount(1)).toEqual({ ok: true });
    expect(kakao.unlink).not.toHaveBeenCalled();
    expect(users.deleteAccountTx).toHaveBeenCalled();
  });

  it('아직 붙이지 않은 제공자 계정이면 오류 (DB 는 그대로)', async () => {
    users.listAuthAccounts.mockResolvedValue([{ provider: 'NAVER', providerUserId: 'a', providerClientId: null, refreshToken: null }]);
    await expect(service.deleteAccount(1)).rejects.toThrow('지원하지 않는 로그인 제공자: NAVER');
    expect(users.deleteAccountTx).not.toHaveBeenCalled();
  });

  it('애플 계정은 폐기용 client_id 와 refresh token 을 함께 넘기고, 폐기 실패면 DB 그대로 (앱.md 3.5)', async () => {
    const account = { provider: 'APPLE' as const, providerUserId: 'sub-1', providerClientId: 'day.whenwemeet.app', refreshToken: 'rt' };
    users.listAuthAccounts.mockResolvedValue([account]);
    expect(await service.deleteAccount(1)).toEqual({ ok: true });
    expect(apple.unlink).toHaveBeenCalledWith(account);

    users.deleteAccountTx.mockClear();
    apple.unlink.mockRejectedValue(new ApiException('APPLE_ERROR'));
    await expect(service.deleteAccount(1)).rejects.toMatchObject({ code: 'APPLE_ERROR' });
    expect(users.deleteAccountTx).not.toHaveBeenCalled();
  });

  it('updateNickname 은 Repository 에 그대로 넘긴다', async () => {
    const user = { id: 1, nickname: '새닉', profileImageUrl: null, createdAt: new Date() };
    users.updateNickname.mockResolvedValue(user);
    expect(await service.updateNickname(1, '새닉')).toBe(user);
    expect(users.updateNickname).toHaveBeenCalledWith(1, '새닉');
  });
});
