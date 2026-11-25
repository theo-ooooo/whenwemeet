import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { GroupsRepository } from './groups.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { MembershipService } from './membership.service.js';

describe('MembershipService 팀 숨김 (#515, D-286)', () => {
  let repo: RepositoryMock<MembershipsRepository>;
  let service: MembershipService;

  beforeEach(() => {
    repo = mockRepository(MembershipsRepository);
    service = new MembershipService(repo as never, mockRepository(GroupsRepository) as never, { getOrThrow: () => 'http://web' } as never);
  });

  it('assertMember: 숨긴 팀은 403 GROUP_HIDDEN + 사유, allowHidden 이면 통과, 멤버가 아니면 FORBIDDEN', async () => {
    repo.findByUserAndGroup.mockResolvedValue({ ...membershipRow(), groupHidden: { reason: '광고' } });
    await expect(service.assertMember(1, 10)).rejects.toMatchObject({ code: 'GROUP_HIDDEN', reason: { reason: '광고' } });
    expect((await service.assertMember(1, 10, { allowHidden: true })).id).toBe(1001);
    await expect(service.isMember(1, 10)).rejects.toMatchObject({ code: 'GROUP_HIDDEN' });

    repo.findByUserAndGroup.mockResolvedValue({ ...membershipRow(), groupHidden: null });
    expect((await service.assertMember(1, 10)).id).toBe(1001);
    expect(await service.isMember(1, 10)).toBe(true);

    repo.findByUserAndGroup.mockResolvedValue(null);
    await expect(service.assertMember(1, 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await service.isMember(1, 10)).toBe(false);
  });

  it('listGroupsOf: 숨긴 팀은 검색 범위에서 뺀다', async () => {
    const group = (id: number, hiddenAt: Date | null) => ({ id, type: 'TEAM' as const, name: `팀${id}`, publicCode: `code${id}xxx`, hiddenAt, hiddenReason: null, _count: { memberships: 2 } });
    repo.listForUserWithGroup.mockResolvedValue([
      { color: '#1', displayName: null, lastSeenAt: new Date(0), joinedAt: new Date(0), user: { nickname: 'a' }, group: group(1, null) },
      { color: '#1', displayName: null, lastSeenAt: new Date(0), joinedAt: new Date(0), user: { nickname: 'a' }, group: group(2, new Date(0)) },
    ]);
    expect((await service.listGroupsOf(1)).map((g) => g.id)).toEqual([1]);
  });
});
