import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { BirthdaysRepository } from './birthdays.repository.js';
import { BirthdaysService } from './birthdays.service.js';

describe('BirthdaysService (#305)', () => {
  let birthdays: RepositoryMock<BirthdaysRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let service: BirthdaysService;

  beforeEach(() => {
    birthdays = mockRepository(BirthdaysRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, { getOrThrow: () => 'http://web' } as never);
    service = new BirthdaysService(birthdays as never, memberships);
  });

  it('멤버가 아니면 FORBIDDEN, 생일을 읽지 않는다', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    await expect(service.list(1, 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(birthdays.listShownByGroup).not.toHaveBeenCalled();
  });

  it('팀 표시 이름 ?? 닉네임과 색, MM-DD. joinedAt 은 싣지 않는다', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    birthdays.listShownByGroup.mockResolvedValue([
      { ...membershipRow(), birthday: '02-29' },
      { ...membershipRow({ userId: 2, displayName: '별명', color: '#F2994A' }), birthday: '12-24' },
    ]);
    expect(await service.list(1, 10)).toEqual([
      { member: { userId: 1, displayName: '앨리스', color: '#F26D6D', profileImageUrl: null }, date: '02-29' },
      { member: { userId: 2, displayName: '별명', color: '#F2994A', profileImageUrl: null }, date: '12-24' },
    ]);
    expect(birthdays.listShownByGroup).toHaveBeenCalledWith(10);
  });
});
