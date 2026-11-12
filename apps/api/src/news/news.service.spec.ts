import { EventLogsRepository } from '../event-logs/event-logs.repository.js';
import { GroupActivitiesRepository } from '../group-activities/group-activities.repository.js';
import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { type ActivityNewsItem, type EventNewsItem, mergeNews, type MergedNewsItem, NewsService, newsSince, unseenAfter } from './news.service.js';

const config = { getOrThrow: () => 'http://web' } as never;

describe('NewsService', () => {
  let eventLogs: RepositoryMock<EventLogsRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let activities: RepositoryMock<GroupActivitiesRepository>;
  let service: NewsService;
  const now = new Date('2026-11-09T00:00:00.000Z');

  beforeEach(() => {
    eventLogs = mockRepository(EventLogsRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    activities = mockRepository(GroupActivitiesRepository);
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, config);
    service = new NewsService(eventLogs as never, membershipsRepo as never, memberships, activities as never);
  });

  it('멤버가 아니면 FORBIDDEN', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    await expect(service.list(9, 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.markSeen(9, 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(eventLogs.listRecentByOthers).not.toHaveBeenCalled();
    expect(membershipsRepo.markSeen).not.toHaveBeenCalled();
  });

  it('list: 내 변경 제외 + 30일 + 50건 + isNew 계산', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow({ lastSeenAt: new Date('2026-11-05T00:00:00.000Z'), joinedAt: new Date('2026-09-01T00:00:00.000Z') }));
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow(), membershipRow({ id: 1002, userId: 2, displayName: '밥' })]);
    eventLogs.listRecentByOthers.mockResolvedValue([
      { id: 301, action: 'UPDATED', eventId: 100, actorId: 2, title: 't', startsAt: now, endsAt: now, allDay: false, createdAt: new Date('2026-11-06T00:00:00.000Z'), repeat: null, scope: null, occurrence: null, actor: { nickname: '밥', profileImageUrl: null } },
      { id: 302, action: 'DELETED', eventId: null, actorId: null, title: 't2', startsAt: now, endsAt: now, allDay: true, createdAt: new Date('2026-11-04T00:00:00.000Z'), repeat: null, scope: null, occurrence: null, actor: null },
    ]);
    const result = await service.list(1, 10, now);
    expect(eventLogs.listRecentByOthers).toHaveBeenCalledWith(10, 1, new Date('2026-10-10T00:00:00.000Z'), 50);
    expect(result.lastSeenAt).toEqual(new Date('2026-11-05T00:00:00.000Z'));
    expect(result.items[0]).toMatchObject({ id: 301, isNew: true, actor: { userId: 2, displayName: '밥' } });
    expect(result.items[1]).toMatchObject({ id: 302, isNew: false, eventId: null, actor: { userId: null, displayName: '탈퇴한 멤버' } });
  });

  it('(#297) list: 30일 안이어도 내가 들어오기 전 기록은 읽지 않는다. 두 소스 모두 joinedAt 부터 (D-180)', async () => {
    const joinedAt = new Date('2026-11-05T12:00:00.000Z');
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow({ joinedAt, lastSeenAt: joinedAt }));
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
    eventLogs.listRecentByOthers.mockResolvedValue([]);
    activities.listRecentByOthers.mockResolvedValue([]);
    await service.list(1, 10, now, 2);
    expect(eventLogs.listRecentByOthers).toHaveBeenCalledWith(10, 1, joinedAt, 50);
    expect(activities.listRecentByOthers).toHaveBeenCalledWith(10, 1, joinedAt, 50);
  });

  it('(#297) newsSince 는 30일 전과 joinedAt 중 늦은 쪽, unseenAfter 는 lastSeenAt 과 joinedAt 중 늦은 쪽', () => {
    const old = new Date('2026-01-01T00:00:00.000Z');
    const recent = new Date('2026-11-08T00:00:00.000Z');
    expect(newsSince(now, old)).toEqual(new Date('2026-10-10T00:00:00.000Z'));
    expect(newsSince(now, recent)).toEqual(recent);
    expect(unseenAfter(old, recent)).toEqual(recent);
    expect(unseenAfter(recent, old)).toEqual(recent);
  });

  it('list: 반복 일정 로그는 repeat, scope, occurrence 를 그대로 싣는다 (#187, 설계 4-3)', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
    eventLogs.listRecentByOthers.mockResolvedValue([
      { id: 303, action: 'UPDATED', eventId: 200, actorId: null, title: 't', startsAt: now, endsAt: now, allDay: false, createdAt: now, repeat: 'WEEKLY', scope: 'FOLLOWING', occurrence: '2026-11-18', actor: null },
      { id: 304, action: 'CREATED', eventId: 201, actorId: null, title: 't', startsAt: now, endsAt: now, allDay: false, createdAt: now, repeat: 'MONTHLY', scope: null, occurrence: null, actor: null },
    ]);
    const { items } = await service.list(1, 10, now);
    expect(items[0]).toMatchObject({ repeat: 'WEEKLY', scope: 'FOLLOWING', occurrence: '2026-11-18' });
    expect(items[1]).toMatchObject({ repeat: 'MONTHLY', scope: null, occurrence: null });
  });

  it('list: v 가 없으면 예전 응답 그대로 (kind 없음, 활동 기록 안 읽음, #191 D-155)', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
    eventLogs.listRecentByOthers.mockResolvedValue([eventLog(301, '2026-11-06T00:00:00.000Z')]);
    const { items } = await service.list(1, 10, now);
    expect(Object.keys(items[0]).sort()).toEqual(['action', 'actor', 'allDay', 'createdAt', 'endsAt', 'eventId', 'id', 'isNew', 'occurrence', 'repeat', 'scope', 'startsAt', 'title']);
    expect(activities.listRecentByOthers).not.toHaveBeenCalled();
  });

  it('list v2: 두 소스를 시각 내림차순으로 섞고 같은 시각은 일정 먼저, 사람은 스냅샷 규칙 (#191)', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow({ lastSeenAt: new Date('2026-11-05T00:00:00.000Z'), joinedAt: new Date('2026-09-01T00:00:00.000Z') }));
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow(), membershipRow({ id: 1002, userId: 2, displayName: '밥' })]);
    eventLogs.listRecentByOthers.mockResolvedValue([eventLog(301, '2026-11-07T00:00:00.000Z'), eventLog(302, '2026-11-04T00:00:00.000Z')]);
    activities.listRecentByOthers.mockResolvedValue([
      activity(9, 'MEMBER_DELETED', '2026-11-08T00:00:00.000Z', { actorId: null, actorName: '민지' }),
      activity(8, 'ANNIVERSARY_UPDATED', '2026-11-07T00:00:00.000Z', { actorId: null, actorName: '민지', payload: { name: '처음 만난 날', date: '2024-03-15', kind: 'COUNT_UP', changed: ['date'], before: { date: '2024-03-14' } } }),
      activity(7, 'MEMBER_LEFT', '2026-11-06T00:00:00.000Z', { actorId: 3, actorName: '떠난 별명', actor: { nickname: '셋', profileImageUrl: 'http://img/3' } }),
      activity(6, 'MEMBER_JOINED', '2026-11-03T00:00:00.000Z', { actorId: 2, actorName: '밥닉' }),
    ]);
    const items = (await service.list(1, 10, now, 2)).items as MergedNewsItem[];
    expect(activities.listRecentByOthers).toHaveBeenCalledWith(10, 1, new Date('2026-10-10T00:00:00.000Z'), 50);
    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual(['ACTIVITY:9', 'EVENT:301', 'ACTIVITY:8', 'ACTIVITY:7', 'EVENT:302', 'ACTIVITY:6']);
    expect(items[0]).toMatchObject({ type: 'MEMBER_DELETED', actor: { userId: null, displayName: '민지', color: '#9CA3AF' }, payload: {}, isNew: true });
    expect(items[2]).toMatchObject({ type: 'ANNIVERSARY_UPDATED', actor: { userId: null, displayName: '탈퇴한 멤버' }, payload: { changed: ['date'] } });
    expect(items[3]).toMatchObject({ actor: { userId: 3, displayName: '떠난 별명', color: '#9CA3AF', profileImageUrl: 'http://img/3' } });
    expect(items[5]).toMatchObject({ actor: { userId: 2, displayName: '밥' }, isNew: false });
    expect(items[1]).toMatchObject({ kind: 'EVENT', action: 'UPDATED', title: 't' });
  });

  it('mergeNews: 합친 뒤 50건 상한, 같은 시각 같은 종류는 id 내림차순', () => {
    const at = (iso: string) => new Date(iso);
    const events = Array.from({ length: 30 }, (_, i) => ({ kind: 'EVENT', id: i + 1, createdAt: at(`2026-11-0${(i % 9) + 1}T00:00:00.000Z`) }) as EventNewsItem);
    const acts = Array.from({ length: 30 }, (_, i) => ({ kind: 'ACTIVITY', id: i + 1, createdAt: at(`2026-11-0${(i % 9) + 1}T00:00:00.000Z`) }) as ActivityNewsItem);
    const merged = mergeNews(events, acts);
    expect(merged).toHaveLength(50);
    for (let i = 1; i < merged.length; i += 1) {
      const [a, b] = [merged[i - 1], merged[i]];
      expect(a.createdAt.getTime()).toBeGreaterThanOrEqual(b.createdAt.getTime());
      if (a.createdAt.getTime() === b.createdAt.getTime()) {
        if (a.kind === b.kind) expect(a.id).toBeGreaterThan(b.id);
        else expect(a.kind).toBe('EVENT');
      }
    }
    expect(merged.slice(0, 4).map((item) => `${item.kind}:${item.id}`)).toEqual(['EVENT:27', 'EVENT:18', 'EVENT:9', 'ACTIVITY:27']);
  });

  it('markSeen: 내 멤버십의 lastSeenAt 을 now 로', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.markSeen.mockResolvedValue({ lastSeenAt: now });
    expect(await service.markSeen(1, 10, now)).toEqual({ lastSeenAt: now });
    expect(membershipsRepo.markSeen).toHaveBeenCalledWith(1001, now);
  });
});

function eventLog(id: number, createdAt: string) {
  const at = new Date('2026-11-09T00:00:00.000Z');
  return { id, action: 'UPDATED' as const, eventId: 100, actorId: 2, title: 't', startsAt: at, endsAt: at, allDay: false, createdAt: new Date(createdAt), repeat: null, scope: null, occurrence: null, actor: { nickname: '밥', profileImageUrl: null } };
}

function activity(id: number, type: ActivityNewsItem['type'], createdAt: string, overrides: Partial<{ actorId: number | null; actorName: string; payload: unknown; actor: { nickname: string; profileImageUrl: string | null } | null }> = {}) {
  return { id, type, actorId: 2, actorName: '밥', anniversaryId: null, payload: null, createdAt: new Date(createdAt), actor: null, ...overrides };
}
