import { EventsRepository } from '../events/events.repository.js';
import { GroupsRepository } from '../groups/groups.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { EventSharesRepository } from './event-shares.repository.js';
import { EventSharesService } from './event-shares.service.js';

const kst = (value: string) => new Date(`${value}+09:00`);
const TOKEN = 'Ab3_-Ab3_-Ab3_-Ab3_-AB';
const config = { getOrThrow: () => 'http://web' } as never;

const EVENT = {
  id: 7,
  groupId: 10,
  title: '저녁',
  startsAt: kst('2099-01-09T19:00:00'),
  endsAt: kst('2099-01-09T21:00:00'),
  allDay: false,
  memo: '메모',
  repeat: null,
  repeatUntil: null,
  repeatAnchor: null,
} as never;

const SHARE = {
  id: 1,
  token: TOKEN,
  groupId: 10,
  eventId: 7,
  occurrence: null,
  createdById: 2,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 86_400_000),
  revokedAt: null,
  joinCount: 0,
  group: { name: '팀', type: 'TEAM' as const },
};

describe('EventSharesService (#274)', () => {
  let shares: RepositoryMock<EventSharesRepository>;
  let events: RepositoryMock<EventsRepository>;
  let groupsRepo: RepositoryMock<GroupsRepository>;
  let groups: { joinGroup: ReturnType<typeof vi.fn> };
  let memberships: { assertMember: ReturnType<typeof vi.fn>; listMembers: ReturnType<typeof vi.fn> };
  let service: EventSharesService;

  beforeEach(() => {
    shares = mockRepository(EventSharesRepository);
    events = mockRepository(EventsRepository);
    groupsRepo = mockRepository(GroupsRepository);
    groups = { joinGroup: vi.fn().mockResolvedValue({ id: 10 }) };
    memberships = { assertMember: vi.fn().mockResolvedValue(membershipRow()), listMembers: vi.fn() };
    service = new EventSharesService(shares as never, events as never, groupsRepo as never, groups as never, memberships as never, config);
    groupsRepo.findType.mockResolvedValue({ type: 'TEAM' });
    events.findInGroup.mockResolvedValue(EVENT);
    events.listExceptions.mockResolvedValue([]);
  });

  it('createLink: 멤버 확인 → 팀 종류 → 일정 → 만료 계산 후 만들거나 기존 반환', async () => {
    shares.findOrCreateLiveTx.mockImplementation(async (input) => ({ share: { ...SHARE, token: input.token, expiresAt: input.expiresAt }, created: true }));
    const result = await service.createLink(2, 10, 7, undefined);
    expect(memberships.assertMember).toHaveBeenCalledWith(2, 10);
    expect(result.created).toBe(true);
    expect(result.link.url).toBe(`http://web/join/e/${result.link.token}`);
    expect(result.link.expiresAt).toEqual(new Date(Math.min(kst('2099-01-10T21:00:00').getTime(), result.link.expiresAt.getTime())));
    expect(shares.findOrCreateLiveTx.mock.calls[0][0]).toMatchObject({ groupId: 10, eventId: 7, occurrence: null, createdById: 2 });
  });

  it('createLink 거부: 개인 팀, 팀 없음, 일정 없음, 지난 일정', async () => {
    groupsRepo.findType.mockResolvedValueOnce({ type: 'PERSONAL' });
    await expect(service.createLink(2, 10, 7, undefined)).rejects.toMatchObject({ code: 'GROUP_NOT_INVITABLE' });
    groupsRepo.findType.mockResolvedValueOnce(null);
    await expect(service.createLink(2, 10, 7, undefined)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    events.findInGroup.mockResolvedValueOnce(null);
    await expect(service.createLink(2, 10, 7, undefined)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    events.findInGroup.mockResolvedValueOnce({ ...(EVENT as object), startsAt: kst('2020-01-01T10:00:00'), endsAt: kst('2020-01-01T11:00:00') } as never);
    await expect(service.createLink(2, 10, 7, undefined)).rejects.toMatchObject({ code: 'EVENT_SHARE_ENDED' });
    expect(shares.findOrCreateLiveTx).not.toHaveBeenCalled();
  });

  it('getLink, revokeLink: 반복이면 occurrence 필수', async () => {
    shares.findLive.mockResolvedValueOnce(null);
    expect(await service.getLink(2, 10, 7, undefined)).toBeNull();
    events.findInGroup.mockResolvedValue({ ...(EVENT as object), repeat: 'WEEKLY' } as never);
    await expect(service.revokeLink(2, 10, 7, undefined)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await service.revokeLink(2, 10, 7, '2099-01-16')).toEqual({ ok: true });
    expect(shares.revokeLive).toHaveBeenCalledWith(7, '2099-01-16', expect.any(Date));
  });

  it('preview: 토큰 모양이 틀리면 DB 를 읽지 않고 404, 끊김/만료/대소문자 다름/개인 팀도 404', async () => {
    await expect(service.preview('bad', null)).rejects.toMatchObject({ code: 'EVENT_SHARE_NOT_FOUND' });
    expect(shares.findByToken).not.toHaveBeenCalled();
    for (const share of [
      null,
      { ...SHARE, revokedAt: new Date() },
      { ...SHARE, expiresAt: new Date(Date.now() - 1) },
      { ...SHARE, token: TOKEN.toLowerCase() },
      { ...SHARE, group: { name: '나', type: 'PERSONAL' as const } },
    ]) {
      shares.findByToken.mockResolvedValueOnce(share);
      await expect(service.preview(TOKEN, null)).rejects.toMatchObject({ code: 'EVENT_SHARE_NOT_FOUND' });
    }
  });

  it('preview: 보낸 사람 표시 이름, 비멤버는 id 없음, 멤버는 착지 정보', async () => {
    shares.findByToken.mockResolvedValue(SHARE);
    memberships.listMembers.mockResolvedValue([membershipRow({ userId: 2, displayName: '민지' }), membershipRow({ userId: 3, displayName: null })]);
    const anon = await service.preview(TOKEN, null);
    expect(anon).toMatchObject({ groupName: '팀', memberCount: 2, sharer: { displayName: '민지' }, viewer: { member: false } });
    expect(anon.event).toEqual({ title: '저녁', startsAt: kst('2099-01-09T19:00:00'), endsAt: kst('2099-01-09T21:00:00'), allDay: false, repeat: null, occurrence: null });
    expect((await service.preview(TOKEN, 3)).viewer).toEqual({ member: true, groupId: 10, eventId: 7, occurrence: null, date: '2099-01-09' });
    shares.findByToken.mockResolvedValueOnce({ ...SHARE, createdById: 99 });
    expect((await service.preview(TOKEN, 99)).sharer).toBeNull();
  });

  it('preview: 일정이 지워졌으면 404', async () => {
    shares.findByToken.mockResolvedValue(SHARE);
    events.findInGroup.mockResolvedValueOnce(null);
    await expect(service.preview(TOKEN, null)).rejects.toMatchObject({ code: 'EVENT_SHARE_NOT_FOUND' });
  });

  it('join: 합류 함수에 링크 id 를 넘기고 착지 정보를 돌려준다', async () => {
    shares.findByToken.mockResolvedValue(SHARE);
    expect(await service.join(5, TOKEN)).toEqual({ group: { id: 10 }, eventId: 7, occurrence: null, date: '2099-01-09' });
    expect(groups.joinGroup).toHaveBeenCalledWith(5, 10, { eventShareId: 1 });
  });
});
