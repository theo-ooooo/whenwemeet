import { ApiException } from '../common/errors.js';
import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { EventsRepository } from './events.repository.js';
import { assertEventRange, EventsService, parseRange } from './events.service.js';

const config = { getOrThrow: () => 'http://web' } as never;
const ROW = {
  id: 'e1',
  groupId: 'g1',
  title: '회의',
  startsAt: new Date('2026-12-01T10:00:00.000Z'),
  endsAt: new Date('2026-12-01T12:00:00.000Z'),
  allDay: false,
  memo: null,
  creatorId: 'u1',
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  creator: { nickname: '앨리스', profileImageUrl: null },
};

describe('assertEventRange / parseRange', () => {
  it('endsAt <= startsAt, 30일 초과 → EVENT_RANGE_INVALID', () => {
    expect(() => assertEventRange(new Date(10), new Date(10))).toThrow(ApiException);
    expect(() => assertEventRange(new Date(10), new Date(5))).toThrow(/뒤여야/);
    expect(() => assertEventRange(new Date(0), new Date(30 * 86_400_000 + 1))).toThrow(/30일/);
    expect(() => assertEventRange(new Date(0), new Date(30 * 86_400_000))).not.toThrow();
  });

  it('parseRange: 형식 오류는 VALIDATION_FAILED, 범위 오류는 EVENT_RANGE_INVALID', () => {
    expect(() => parseRange('x', '2026-01-02T00:00:00Z', 62)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(() => parseRange('2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', 62)).toThrow(expect.objectContaining({ code: 'EVENT_RANGE_INVALID' }));
    expect(() => parseRange('2026-01-01T00:00:00Z', '2026-03-05T00:00:00Z', 62)).toThrow(expect.objectContaining({ code: 'EVENT_RANGE_INVALID' }));
    const { from, to } = parseRange('2026-01-01T00:00:00Z', '2026-03-04T00:00:00Z', 62);
    expect(to.getTime() - from.getTime()).toBe(62 * 86_400_000);
  });
});

describe('EventsService', () => {
  let events: RepositoryMock<EventsRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let service: EventsService;

  beforeEach(() => {
    events = mockRepository(EventsRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, config);
    service = new EventsService(events as never, memberships);
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
  });

  it('멤버가 아니면 모든 메서드가 FORBIDDEN', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    const input = { title: 't', startsAt: '2026-12-01T10:00:00Z', endsAt: '2026-12-01T11:00:00Z', allDay: false };
    await expect(service.list('u9', 'g1', '2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.get('u9', 'g1', 'e1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.create('u9', 'g1', input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.update('u9', 'g1', 'e1', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.remove('u9', 'g1', 'e1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(events.listInRange).not.toHaveBeenCalled();
    expect(events.findInGroup).not.toHaveBeenCalled();
  });

  it('list: 구간을 Date 로 넘기고 creator 를 Member 로', async () => {
    events.listInRange.mockResolvedValue([ROW]);
    const list = await service.list('u1', 'g1', '2026-12-01T00:00:00.000Z', '2026-12-02T00:00:00.000Z');
    expect(events.listInRange).toHaveBeenCalledWith('g1', new Date('2026-12-01T00:00:00.000Z'), new Date('2026-12-02T00:00:00.000Z'));
    expect(list[0]).toMatchObject({ id: 'e1', creator: { userId: 'u1', displayName: '앨리스', color: '#F26D6D' } });
    expect(list[0]).not.toHaveProperty('creatorId');
  });

  it('get: 다른 팀 ID 는 NOT_FOUND', async () => {
    events.findInGroup.mockResolvedValueOnce(null);
    await expect(service.get('u1', 'g1', 'e-other')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(events.findInGroup).toHaveBeenCalledWith('g1', 'e-other');
    events.findInGroup.mockResolvedValueOnce(ROW);
    expect((await service.get('u1', 'g1', 'e1')).id).toBe('e1');
  });

  it('create: 범위 검증 후 일정 + CREATED 로그 트랜잭션', async () => {
    await expect(
      service.create('u1', 'g1', { title: 't', startsAt: '2026-12-01T12:00:00Z', endsAt: '2026-12-01T10:00:00Z', allDay: false }),
    ).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
    expect(events.createWithLogTx).not.toHaveBeenCalled();

    events.createWithLogTx.mockResolvedValue(ROW);
    const created = await service.create('u1', 'g1', { title: '회의', startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-01T12:00:00.000Z', allDay: false });
    expect(created.id).toBe('e1');
    expect(events.createWithLogTx).toHaveBeenCalledWith(
      { groupId: 'g1', title: '회의', startsAt: ROW.startsAt, endsAt: ROW.endsAt, allDay: false, memo: null, creatorId: 'u1' },
      'u1',
    );
  });

  it('update: 부분 변경은 현재 값과 합쳐 검증, UPDATED 로그 트랜잭션', async () => {
    events.findInGroup.mockResolvedValue(ROW);
    await expect(service.update('u1', 'g1', 'e1', { endsAt: '2026-12-01T09:00:00Z' })).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
    expect(events.updateWithLogTx).not.toHaveBeenCalled();

    events.updateWithLogTx.mockResolvedValue({ ...ROW, title: '변경', memo: '메모' });
    const updated = await service.update('u1', 'g1', 'e1', { title: '변경', memo: '메모' });
    expect(updated.title).toBe('변경');
    expect(events.updateWithLogTx).toHaveBeenCalledWith(
      'e1',
      { title: '변경', startsAt: ROW.startsAt, endsAt: ROW.endsAt, allDay: false, memo: '메모' },
      'u1',
    );

    events.findInGroup.mockResolvedValueOnce(null);
    await expect(service.update('u1', 'g1', 'nope', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('update: startsAt 만 바꾸면 나머지는 현재 값을 그대로 넘긴다', async () => {
    const current = { ...ROW, memo: '원래 메모', allDay: true };
    events.findInGroup.mockResolvedValue(current);
    events.updateWithLogTx.mockResolvedValue({ ...current, startsAt: new Date('2026-12-01T11:00:00.000Z') });
    const updated = await service.update('u1', 'g1', 'e1', { startsAt: '2026-12-01T11:00:00.000Z' });
    expect(updated.startsAt).toEqual(new Date('2026-12-01T11:00:00.000Z'));
    expect(events.updateWithLogTx).toHaveBeenCalledWith(
      'e1',
      { title: '회의', startsAt: new Date('2026-12-01T11:00:00.000Z'), endsAt: ROW.endsAt, allDay: true, memo: '원래 메모' },
      'u1',
    );
  });

  it('remove: 현재 행을 스냅샷으로 넘겨 DELETED 로그 + 삭제', async () => {
    events.findInGroup.mockResolvedValueOnce(ROW);
    events.deleteWithLogTx.mockResolvedValue(undefined);
    expect(await service.remove('u1', 'g1', 'e1')).toEqual({ ok: true });
    expect(events.deleteWithLogTx).toHaveBeenCalledWith(ROW, 'u1');

    events.findInGroup.mockResolvedValueOnce(null);
    await expect(service.remove('u1', 'g1', 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(events.deleteWithLogTx).toHaveBeenCalledTimes(1);
  });
});
