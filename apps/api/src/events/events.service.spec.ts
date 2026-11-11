import { ApiException } from '../common/errors.js';
import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { EventsRepository } from './events.repository.js';
import { assertEventRange, EventsService, isUnchanged, parseRange } from './events.service.js';

const config = { getOrThrow: () => 'http://web' } as never;
const ROW = {
  id: 100,
  groupId: 10,
  title: '회의',
  startsAt: new Date('2026-12-01T10:00:00.000Z'),
  endsAt: new Date('2026-12-01T12:00:00.000Z'),
  allDay: false,
  memo: null,
  creatorId: 1,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  repeat: null,
  repeatUntil: null,
  repeatAnchor: null,
  reminder: 'NONE' as const,
  reminderSetAt: new Date('2026-11-01T00:00:00.000Z'),
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
    events.listSeriesForRange.mockResolvedValue([]);
    events.listExceptions.mockResolvedValue([]);
  });

  it('멤버가 아니면 모든 메서드가 FORBIDDEN', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    const input = { title: 't', startsAt: '2026-12-01T10:00:00Z', endsAt: '2026-12-01T11:00:00Z', allDay: false };
    await expect(service.list(9, 10, '2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.get(9, 10, 100)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.create(9, 10, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.update(9, 10, 100, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.remove(9, 10, 100)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(events.listInRange).not.toHaveBeenCalled();
    expect(events.findInGroup).not.toHaveBeenCalled();
  });

  it('list: 구간을 Date 로 넘기고 creator 를 Member 로', async () => {
    events.listInRange.mockResolvedValue([ROW]);
    const list = await service.list(1, 10, '2026-12-01T00:00:00.000Z', '2026-12-02T00:00:00.000Z');
    expect(events.listInRange).toHaveBeenCalledWith(10, new Date('2026-12-01T00:00:00.000Z'), new Date('2026-12-02T00:00:00.000Z'));
    expect(list[0]).toMatchObject({ id: 100, creator: { userId: 1, displayName: '앨리스', color: '#F26D6D' } });
    expect(list[0]).not.toHaveProperty('creatorId');
  });

  it('get: 다른 팀 ID 는 NOT_FOUND', async () => {
    events.findInGroup.mockResolvedValueOnce(null);
    await expect(service.get(1, 10, 199)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(events.findInGroup).toHaveBeenCalledWith(10, 199);
    events.findInGroup.mockResolvedValueOnce(ROW);
    expect((await service.get(1, 10, 100)).id).toBe(100);
  });

  it('create: 범위 검증 후 일정 + CREATED 로그 트랜잭션', async () => {
    await expect(
      service.create(1, 10, { title: 't', startsAt: '2026-12-01T12:00:00Z', endsAt: '2026-12-01T10:00:00Z', allDay: false }),
    ).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
    expect(events.createWithLogTx).not.toHaveBeenCalled();

    events.createWithLogTx.mockResolvedValue(ROW);
    const created = await service.create(1, 10, { title: '회의', startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-01T12:00:00.000Z', allDay: false });
    expect(created.id).toBe(100);
    expect(events.createWithLogTx).toHaveBeenCalledWith(
      { groupId: 10, title: '회의', startsAt: ROW.startsAt, endsAt: ROW.endsAt, allDay: false, memo: null, creatorId: 1, reminder: 'NONE', remindAt: null, reminderSetAt: expect.any(Date) },
      1,
    );
  });

  it('update: 부분 변경은 현재 값과 합쳐 검증, UPDATED 로그 트랜잭션', async () => {
    events.findInGroup.mockResolvedValue(ROW);
    await expect(service.update(1, 10, 100, { endsAt: '2026-12-01T09:00:00Z' })).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
    expect(events.updateWithLogTx).not.toHaveBeenCalled();

    events.updateWithLogTx.mockResolvedValue({ ...ROW, title: '변경', memo: '메모' });
    const updated = await service.update(1, 10, 100, { title: '변경', memo: '메모' });
    expect(updated.title).toBe('변경');
    expect(events.updateWithLogTx).toHaveBeenCalledWith(
      100,
      { title: '변경', startsAt: ROW.startsAt, endsAt: ROW.endsAt, allDay: false, memo: '메모', reminder: 'NONE', remindAt: null },
      1,
    );

    events.findInGroup.mockResolvedValueOnce(null);
    await expect(service.update(1, 10, 999, {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('update: 빈 메모(\'\')를 보내면 메모를 지운다 (null 로 저장)', async () => {
    events.findInGroup.mockResolvedValue({ ...ROW, memo: '원래 메모' });
    events.updateWithLogTx.mockResolvedValue({ ...ROW, memo: null });
    await service.update(1, 10, 100, { memo: '' });
    expect(events.updateWithLogTx).toHaveBeenCalledWith(
      100,
      { title: ROW.title, startsAt: ROW.startsAt, endsAt: ROW.endsAt, allDay: false, memo: null, reminder: 'NONE', remindAt: null },
      1,
    );
  });

  it('update: 메모가 이미 없을 때 빈 메모를 보내면 저장하지 않는다 (#62)', async () => {
    events.findInGroup.mockResolvedValue(ROW);
    await service.update(1, 10, 100, { memo: '' });
    expect(events.updateWithLogTx).not.toHaveBeenCalled();
  });

  it('update: 바뀐 필드가 없으면 저장도 UPDATED 로그도 없이 현재 값을 돌려준다 (#62)', async () => {
    events.findInGroup.mockResolvedValue(ROW);
    for (const dto of [{}, { title: '회의', allDay: false, memo: null }, { startsAt: '2026-12-01T19:00:00+09:00', endsAt: '2026-12-01T12:00:00.000Z' }]) {
      const result = await service.update(1, 10, 100, dto as never);
      expect(result.updatedAt).toEqual(ROW.updatedAt);
      expect(result.title).toBe('회의');
    }
    expect(events.updateWithLogTx).not.toHaveBeenCalled();
  });

  it('isUnchanged: 필드 하나라도 다르면 false (알림 포함, #188)', () => {
    const base = { title: 't', startsAt: new Date(0), endsAt: new Date(1000), allDay: false, memo: null, reminder: 'NONE' as const };
    expect(isUnchanged(base, { ...base, startsAt: new Date(0) })).toBe(true);
    expect(isUnchanged(base, { ...base, title: 'u' })).toBe(false);
    expect(isUnchanged(base, { ...base, startsAt: new Date(1) })).toBe(false);
    expect(isUnchanged(base, { ...base, endsAt: new Date(999) })).toBe(false);
    expect(isUnchanged(base, { ...base, allDay: true })).toBe(false);
    expect(isUnchanged(base, { ...base, memo: '' })).toBe(false);
    expect(isUnchanged(base, { ...base, reminder: 'HOUR_1' })).toBe(false);
  });

  it('update: startsAt 만 바꾸면 나머지는 현재 값을 그대로 넘긴다', async () => {
    const current = { ...ROW, memo: '원래 메모', allDay: true };
    events.findInGroup.mockResolvedValue(current);
    events.updateWithLogTx.mockResolvedValue({ ...current, startsAt: new Date('2026-12-01T11:00:00.000Z') });
    const updated = await service.update(1, 10, 100, { startsAt: '2026-12-01T11:00:00.000Z' });
    expect(updated.startsAt).toEqual(new Date('2026-12-01T11:00:00.000Z'));
    expect(events.updateWithLogTx).toHaveBeenCalledWith(
      100,
      { title: '회의', startsAt: new Date('2026-12-01T11:00:00.000Z'), endsAt: ROW.endsAt, allDay: true, memo: '원래 메모', reminder: 'NONE', remindAt: null, reminderSetAt: expect.any(Date) },
      1,
    );
  });

  it('remove: 현재 행을 스냅샷으로 넘겨 DELETED 로그 + 삭제', async () => {
    events.findInGroup.mockResolvedValueOnce(ROW);
    events.deleteWithLogTx.mockResolvedValue(undefined);
    expect(await service.remove(1, 10, 100)).toEqual({ ok: true });
    expect(events.deleteWithLogTx).toHaveBeenCalledWith(ROW, 1);

    events.findInGroup.mockResolvedValueOnce(null);
    await expect(service.remove(1, 10, 999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(events.deleteWithLogTx).toHaveBeenCalledTimes(1);
  });
});
