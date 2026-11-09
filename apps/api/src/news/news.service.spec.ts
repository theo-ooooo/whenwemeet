import { MembershipService } from '../groups/membership.service.js';
import { asPrisma, createPrismaMock, membershipRow, PrismaMock } from '../testing/prisma-mock.js';
import { NewsService } from './news.service.js';

const config = { getOrThrow: () => 'http://web' } as never;

describe('NewsService', () => {
  let prisma: PrismaMock;
  let service: NewsService;
  const now = new Date('2026-11-09T00:00:00.000Z');

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new NewsService(asPrisma(prisma), new MembershipService(asPrisma(prisma), config));
  });

  it('멤버가 아니면 FORBIDDEN', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(service.list('u9', 'g1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.markSeen('u9', 'g1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('list: 내 변경 제외 + 30일 + 50건 + isNew 계산', async () => {
    prisma.membership.findUnique.mockResolvedValue(membershipRow({ lastSeenAt: new Date('2026-11-05T00:00:00.000Z') }));
    prisma.membership.findMany.mockResolvedValue([membershipRow(), membershipRow({ id: 'm2', userId: 'u2', displayName: '밥' })]);
    prisma.eventLog.findMany.mockResolvedValue([
      { id: 'l1', action: 'UPDATED', eventId: 'e1', actorId: 'u2', title: 't', startsAt: now, endsAt: now, allDay: false, createdAt: new Date('2026-11-06T00:00:00.000Z'), actor: { nickname: '밥', profileImageUrl: null } },
      { id: 'l2', action: 'DELETED', eventId: null, actorId: null, title: 't2', startsAt: now, endsAt: now, allDay: true, createdAt: new Date('2026-11-04T00:00:00.000Z'), actor: null },
    ]);
    const result = await service.list('u1', 'g1', now);
    expect(prisma.eventLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { groupId: 'g1', createdAt: { gte: new Date('2026-10-10T00:00:00.000Z') }, OR: [{ actorId: null }, { actorId: { not: 'u1' } }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }));
    expect(result.lastSeenAt).toEqual(new Date('2026-11-05T00:00:00.000Z'));
    expect(result.items[0]).toMatchObject({ id: 'l1', isNew: true, actor: { userId: 'u2', displayName: '밥' } });
    expect(result.items[1]).toMatchObject({ id: 'l2', isNew: false, eventId: null, actor: { userId: null, displayName: '탈퇴한 멤버' } });
  });

  it('markSeen: 내 멤버십의 lastSeenAt 을 now 로', async () => {
    prisma.membership.findUnique.mockResolvedValue(membershipRow());
    prisma.membership.update.mockResolvedValue({ lastSeenAt: now });
    expect(await service.markSeen('u1', 'g1', now)).toEqual({ lastSeenAt: now });
    expect(prisma.membership.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { lastSeenAt: now }, select: { lastSeenAt: true } });
  });
});
