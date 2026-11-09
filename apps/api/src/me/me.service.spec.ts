import { ApiException } from '../common/errors.js';
import { GroupsService } from '../groups/groups.service.js';
import { MembershipService } from '../groups/membership.service.js';
import { asPrisma, createPrismaMock, PrismaMock } from '../testing/prisma-mock.js';
import { MeService } from './me.service.js';

const config = { getOrThrow: () => 'http://web' } as never;

describe('MeService.deleteAccount', () => {
  let prisma: PrismaMock;
  let service: MeService;
  const kakao = { unlink: vi.fn() };

  beforeEach(() => {
    prisma = createPrismaMock();
    kakao.unlink.mockReset();
    const groups = new GroupsService(asPrisma(prisma), new MembershipService(asPrisma(prisma), config));
    service = new MeService(asPrisma(prisma), kakao as never, groups);
    prisma.membership.findMany.mockResolvedValue([
      { id: 'mp', groupId: 'p1', group: { type: 'PERSONAL' } },
      { id: 'mt1', groupId: 't1', group: { type: 'TEAM' } },
      { id: 'mt2', groupId: 't2', group: { type: 'TEAM' } },
    ]);
    prisma.membership.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
  });

  it('사용자가 없으면 UNAUTHORIZED', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.deleteAccount('u1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('unlink 실패 시 DB 는 건드리지 않는다', async () => {
    prisma.user.findUnique.mockResolvedValue({ kakaoId: 123n });
    kakao.unlink.mockRejectedValue(new ApiException('KAKAO_ERROR'));
    await expect(service.deleteAccount('u1')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('unlink 성공 → 개인 팀 삭제, 팀 멤버십마다 나가기(마지막이면 팀 삭제), 사용자 삭제', async () => {
    prisma.user.findUnique.mockResolvedValue({ kakaoId: 123n });
    kakao.unlink.mockResolvedValue(undefined);
    expect(await service.deleteAccount('u1')).toEqual({ ok: true });
    expect(kakao.unlink).toHaveBeenCalledWith(123n);
    expect(prisma.group.delete.mock.calls.map((c) => c[0])).toEqual([{ where: { id: 'p1' } }, { where: { id: 't2' } }]);
    expect(prisma.membership.delete.mock.calls.map((c) => c[0])).toEqual([{ where: { id: 'mt1' } }, { where: { id: 'mt2' } }]);
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('개발 사용자(kakaoId 음수) 는 unlink 를 건너뛴다', async () => {
    prisma.user.findUnique.mockResolvedValue({ kakaoId: -5n });
    expect(await service.deleteAccount('u1')).toEqual({ ok: true });
    expect(kakao.unlink).not.toHaveBeenCalled();
    expect(prisma.user.delete).toHaveBeenCalled();
  });
});
