import { EventLogsRepository } from '../event-logs/event-logs.repository.js';
import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { NewsService } from './news.service.js';

const config = { getOrThrow: () => 'http://web' } as never;

describe('NewsService', () => {
  let eventLogs: RepositoryMock<EventLogsRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let service: NewsService;
  const now = new Date('2026-11-09T00:00:00.000Z');

  beforeEach(() => {
    eventLogs = mockRepository(EventLogsRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, config);
    service = new NewsService(eventLogs as never, membershipsRepo as never, memberships);
  });

  it('멤버가 아니면 FORBIDDEN', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    await expect(service.list('u9', 'g1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.markSeen('u9', 'g1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(eventLogs.listRecentByOthers).not.toHaveBeenCalled();
    expect(membershipsRepo.markSeen).not.toHaveBeenCalled();
  });

  it('list: 내 변경 제외 + 30일 + 50건 + isNew 계산', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow({ lastSeenAt: new Date('2026-11-05T00:00:00.000Z') }));
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow(), membershipRow({ id: 'm2', userId: 'u2', displayName: '밥' })]);
    eventLogs.listRecentByOthers.mockResolvedValue([
      { id: 'l1', action: 'UPDATED', eventId: 'e1', actorId: 'u2', title: 't', startsAt: now, endsAt: now, allDay: false, createdAt: new Date('2026-11-06T00:00:00.000Z'), actor: { nickname: '밥', profileImageUrl: null } },
      { id: 'l2', action: 'DELETED', eventId: null, actorId: null, title: 't2', startsAt: now, endsAt: now, allDay: true, createdAt: new Date('2026-11-04T00:00:00.000Z'), actor: null },
    ]);
    const result = await service.list('u1', 'g1', now);
    expect(eventLogs.listRecentByOthers).toHaveBeenCalledWith('g1', 'u1', new Date('2026-10-10T00:00:00.000Z'), 50);
    expect(result.lastSeenAt).toEqual(new Date('2026-11-05T00:00:00.000Z'));
    expect(result.items[0]).toMatchObject({ id: 'l1', isNew: true, actor: { userId: 'u2', displayName: '밥' } });
    expect(result.items[1]).toMatchObject({ id: 'l2', isNew: false, eventId: null, actor: { userId: null, displayName: '탈퇴한 멤버' } });
  });

  it('markSeen: 내 멤버십의 lastSeenAt 을 now 로', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.markSeen.mockResolvedValue({ lastSeenAt: now });
    expect(await service.markSeen('u1', 'g1', now)).toEqual({ lastSeenAt: now });
    expect(membershipsRepo.markSeen).toHaveBeenCalledWith('m1', now);
  });
});
