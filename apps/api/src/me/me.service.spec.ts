import { ApiException } from '../common/errors.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import { MeService } from './me.service.js';

describe('MeService.deleteAccount', () => {
  let users: RepositoryMock<UsersRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let service: MeService;
  const kakao = { unlink: vi.fn() };

  beforeEach(() => {
    users = mockRepository(UsersRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    kakao.unlink.mockReset();
    service = new MeService(users as never, membershipsRepo as never, kakao as never);
    membershipsRepo.listByUserWithGroupType.mockResolvedValue([
      { id: 'mp', groupId: 'p1', groupType: 'PERSONAL' },
      { id: 'mt1', groupId: 't1', groupType: 'TEAM' },
      { id: 'mt2', groupId: 't2', groupType: 'TEAM' },
    ]);
    users.deleteAccountTx.mockResolvedValue(undefined);
  });

  it('사용자가 없으면 UNAUTHORIZED', async () => {
    users.findKakaoId.mockResolvedValue(null);
    await expect(service.deleteAccount('u1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(kakao.unlink).not.toHaveBeenCalled();
    expect(users.deleteAccountTx).not.toHaveBeenCalled();
  });

  it('unlink 실패 시 DB 는 건드리지 않는다', async () => {
    users.findKakaoId.mockResolvedValue({ kakaoId: 123n });
    kakao.unlink.mockRejectedValue(new ApiException('KAKAO_ERROR'));
    await expect(service.deleteAccount('u1')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });
    expect(membershipsRepo.listByUserWithGroupType).not.toHaveBeenCalled();
    expect(users.deleteAccountTx).not.toHaveBeenCalled();
  });

  it('unlink 성공 → 개인 팀은 삭제, 팀 멤버십은 나가기로 나눠 한 트랜잭션에 넘긴다', async () => {
    users.findKakaoId.mockResolvedValue({ kakaoId: 123n });
    kakao.unlink.mockResolvedValue(undefined);
    expect(await service.deleteAccount('u1')).toEqual({ ok: true });
    expect(kakao.unlink).toHaveBeenCalledWith(123n);
    expect(users.deleteAccountTx).toHaveBeenCalledTimes(1);
    expect(users.deleteAccountTx).toHaveBeenCalledWith('u1', {
      deleteGroupIds: ['p1'],
      leave: [
        { membershipId: 'mt1', groupId: 't1' },
        { membershipId: 'mt2', groupId: 't2' },
      ],
    });
  });

  it('개발 사용자(kakaoId 음수) 는 unlink 를 건너뛴다', async () => {
    users.findKakaoId.mockResolvedValue({ kakaoId: -5n });
    expect(await service.deleteAccount('u1')).toEqual({ ok: true });
    expect(kakao.unlink).not.toHaveBeenCalled();
    expect(users.deleteAccountTx).toHaveBeenCalled();
  });
});
