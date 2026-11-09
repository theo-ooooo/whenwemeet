import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { AnniversariesRepository } from './anniversaries.repository.js';
import { AnniversariesService, dateStringToDb, dbToDateString } from './anniversaries.service.js';

const config = { getOrThrow: () => 'http://web' } as never;
const ROW = {
  id: 200,
  groupId: 10,
  name: '기념일',
  date: new Date('2024-03-15T00:00:00.000Z'),
  creatorId: null,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  creator: null,
};

describe('date 변환', () => {
  it('YYYY-MM-DD ↔ UTC 자정 Date', () => {
    expect(dateStringToDb('2024-03-15').toISOString()).toBe('2024-03-15T00:00:00.000Z');
    expect(dbToDateString(new Date('2024-03-15T00:00:00.000Z'))).toBe('2024-03-15');
  });
});

describe('AnniversariesService', () => {
  let anniversaries: RepositoryMock<AnniversariesRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let service: AnniversariesService;

  beforeEach(() => {
    anniversaries = mockRepository(AnniversariesRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, config);
    service = new AnniversariesService(anniversaries as never, memberships);
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
  });

  it('멤버가 아니면 FORBIDDEN', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    await expect(service.list(9, 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.create(9, 10, { name: 'x', date: '2024-01-01' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.update(9, 10, 200, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.remove(9, 10, 200)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(anniversaries.listByGroup).not.toHaveBeenCalled();
    expect(anniversaries.findIdInGroup).not.toHaveBeenCalled();
  });

  it('list: 팀 기념일을 날짜 문자열로, 탈퇴자는 "탈퇴한 멤버"', async () => {
    anniversaries.listByGroup.mockResolvedValue([ROW]);
    const list = await service.list(1, 10);
    expect(anniversaries.listByGroup).toHaveBeenCalledWith(10);
    expect(list[0]).toMatchObject({ id: 200, date: '2024-03-15', creator: { userId: null, displayName: '탈퇴한 멤버' } });
  });

  it('create: 문자열 날짜를 UTC 자정으로 저장', async () => {
    anniversaries.create.mockResolvedValue({ ...ROW, creatorId: 1, creator: { nickname: '앨리스', profileImageUrl: null } });
    const created = await service.create(1, 10, { name: '기념일', date: '2024-03-15' });
    expect(anniversaries.create).toHaveBeenCalledWith({ groupId: 10, name: '기념일', date: new Date('2024-03-15T00:00:00.000Z'), creatorId: 1 });
    expect(created.creator.displayName).toBe('앨리스');
  });

  it('update / remove: 다른 팀 ID 는 NOT_FOUND, 부분 변경만 전달', async () => {
    anniversaries.findIdInGroup.mockResolvedValueOnce(null);
    await expect(service.update(1, 10, 999, { name: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(anniversaries.update).not.toHaveBeenCalled();

    anniversaries.findIdInGroup.mockResolvedValue({ id: 200 });
    anniversaries.update.mockResolvedValue({ ...ROW, date: new Date('2024-03-16T00:00:00.000Z') });
    const updated = await service.update(1, 10, 200, { date: '2024-03-16' });
    expect(anniversaries.update).toHaveBeenCalledWith(200, { date: new Date('2024-03-16T00:00:00.000Z') });
    expect(updated.date).toBe('2024-03-16');

    await service.update(1, 10, 200, { name: '새' });
    expect(anniversaries.update).toHaveBeenLastCalledWith(200, { name: '새' });

    anniversaries.delete.mockResolvedValue(undefined);
    expect(await service.remove(1, 10, 200)).toEqual({ ok: true });
    expect(anniversaries.delete).toHaveBeenCalledWith(200);

    anniversaries.findIdInGroup.mockResolvedValueOnce(null);
    await expect(service.remove(1, 10, 999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(anniversaries.delete).toHaveBeenCalledTimes(1);
  });
});
