import { AuthProviders } from '../auth/providers/auth-providers.js';
import { DevProvider } from '../auth/providers/dev.provider.js';
import { ApiException } from '../common/errors.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import { MeService } from './me.service.js';

describe('MeService.deleteAccount', () => {
  let users: RepositoryMock<UsersRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let service: MeService;
  const kakao = { provider: 'KAKAO' as const, exchangeCode: vi.fn(), unlink: vi.fn() };
  const dev = new DevProvider();
  const devUnlink = vi.spyOn(dev, 'unlink');

  beforeEach(() => {
    users = mockRepository(UsersRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    kakao.unlink.mockReset();
    devUnlink.mockClear();
    service = new MeService(users as never, membershipsRepo as never, new AuthProviders(kakao as never, dev));
    membershipsRepo.listByUserWithGroupType.mockResolvedValue([
      { id: 501, groupId: 21, groupType: 'PERSONAL' },
      { id: 502, groupId: 31, groupType: 'TEAM' },
      { id: 503, groupId: 32, groupType: 'TEAM' },
    ]);
    users.deleteAccountTx.mockResolvedValue(undefined);
  });

  it('unlink 실패 시 DB 는 건드리지 않는다', async () => {
    users.listAuthAccounts.mockResolvedValue([{ provider: 'KAKAO', providerUserId: '123' }]);
    kakao.unlink.mockRejectedValue(new ApiException('KAKAO_ERROR'));
    await expect(service.deleteAccount(1)).rejects.toMatchObject({ code: 'KAKAO_ERROR' });
    expect(membershipsRepo.listByUserWithGroupType).not.toHaveBeenCalled();
    expect(users.deleteAccountTx).not.toHaveBeenCalled();
  });

  it('연결 계정마다 제공자별 unlink → 개인 팀은 삭제, 팀 멤버십은 나가기로 나눠 한 트랜잭션에 넘긴다', async () => {
    users.listAuthAccounts.mockResolvedValue([
      { provider: 'KAKAO', providerUserId: '123' },
      { provider: 'DEV', providerUserId: '개발' },
    ]);
    kakao.unlink.mockResolvedValue(undefined);
    expect(await service.deleteAccount(1)).toEqual({ ok: true });
    expect(users.listAuthAccounts).toHaveBeenCalledWith(1);
    expect(kakao.unlink).toHaveBeenCalledWith('123');
    expect(devUnlink).toHaveBeenCalledWith('개발');
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
    users.listAuthAccounts.mockResolvedValue([{ provider: 'DEV', providerUserId: '개발' }]);
    expect(await service.deleteAccount(1)).toEqual({ ok: true });
    expect(kakao.unlink).not.toHaveBeenCalled();
    expect(users.deleteAccountTx).toHaveBeenCalled();
  });

  it('아직 붙이지 않은 제공자 계정이면 오류 (DB 는 그대로)', async () => {
    users.listAuthAccounts.mockResolvedValue([{ provider: 'APPLE', providerUserId: 'a' }]);
    await expect(service.deleteAccount(1)).rejects.toThrow('지원하지 않는 로그인 제공자: APPLE');
    expect(users.deleteAccountTx).not.toHaveBeenCalled();
  });
});
