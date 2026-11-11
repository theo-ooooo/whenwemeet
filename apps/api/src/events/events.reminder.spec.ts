import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { EventExceptionRow, EventRow, EventsRepository } from './events.repository.js';
import { EventsService, resolveReminder } from './events.service.js';

/** (#188) 일정 알림 입력, 검증, remindAt, reminderSetAt (설계 4장, 7-2) */
const kst = (value: string) => new Date(`${value}+09:00`);
const config = { getOrThrow: () => 'http://web' } as never;
const SET_AT = new Date('2026-11-01T00:00:00.000Z');

const ONCE: EventRow = {
  id: 100,
  groupId: 10,
  title: '저녁',
  startsAt: kst('2026-12-01T18:00:00'),
  endsAt: kst('2026-12-01T20:00:00'),
  allDay: false,
  memo: null,
  creatorId: 1,
  createdAt: SET_AT,
  updatedAt: SET_AT,
  repeat: null,
  repeatUntil: null,
  repeatAnchor: null,
  reminder: 'HOUR_1',
  reminderSetAt: SET_AT,
  creator: { nickname: '앨리스', profileImageUrl: null },
  allMembers: true,
  participantIds: [] as number[],
};
/** 2026-11-11(수) 19:00~21:00 KST 매주, 1시간 전 */
const SERIES: EventRow = { ...ONCE, id: 200, startsAt: kst('2026-11-11T19:00:00'), endsAt: kst('2026-11-11T21:00:00'), repeat: 'WEEKLY' };

const exception = (overrides: Partial<EventExceptionRow>): EventExceptionRow => ({
  occurrence: '2026-11-18',
  cancelled: false,
  title: null,
  startsAt: null,
  endsAt: null,
  allDay: null,
  memo: null,
  reminder: null,
  reminderSetAt: null,
  ...overrides,
});

describe('resolveReminder (설계 4-1)', () => {
  it('본문 값이 종일 여부와 안 맞으면 400 (field reminder)', () => {
    expect(() => resolveReminder('DAY_OF_0900', 'NONE', false)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED', details: [{ field: 'reminder', message: '시간 일정에는 고를 수 없는 알림이에요' }] }));
    expect(() => resolveReminder('HOUR_1', 'NONE', true)).toThrow(expect.objectContaining({ details: [{ field: 'reminder', message: '종일 일정에는 고를 수 없는 알림이에요' }] }));
  });

  it('본문에 없으면 지금 값, 종일이 바뀌어 안 맞게 되면 NONE', () => {
    expect(resolveReminder(undefined, 'HOUR_1', false)).toBe('HOUR_1');
    expect(resolveReminder(undefined, 'HOUR_1', true)).toBe('NONE');
    expect(resolveReminder(null, 'DAY_OF_0900', false)).toBe('NONE');
    expect(resolveReminder('NONE', 'HOUR_1', true)).toBe('NONE');
  });
});

describe('EventsService 일정 알림', () => {
  let events: RepositoryMock<EventsRepository>;
  let service: EventsService;

  beforeEach(() => {
    events = mockRepository(EventsRepository);
    const membershipsRepo = mockRepository(MembershipsRepository);
    service = new EventsService(events as never, new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, config));
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
    events.listExceptions.mockResolvedValue([]);
    events.createWithLogTx.mockImplementation(async (data) => ({ ...ONCE, ...data, repeatUntil: null, repeatAnchor: null, repeat: data.repeat ?? null }) as EventRow);
    events.updateWithLogTx.mockImplementation(async (_id, data) => ({ ...ONCE, ...data }) as EventRow);
    events.updateSeriesFromStartTx.mockImplementation(async (_id, data) => ({ ...SERIES, ...data }) as EventRow);
    events.saveExceptionWithLogTx.mockResolvedValue(undefined);
  });

  const input = { title: '저녁', startsAt: '2026-12-01T18:00:00+09:00', endsAt: '2026-12-01T20:00:00+09:00', allDay: false };

  describe('생성', () => {
    it('생략은 NONE, remindAt null, reminderSetAt 지금', async () => {
      const view = await service.create(1, 10, input);
      expect(events.createWithLogTx.mock.calls[0][0]).toMatchObject({ reminder: 'NONE', remindAt: null, reminderSetAt: expect.any(Date) });
      expect(view.reminder).toBe('NONE');
    });

    it('한 번짜리는 remindAt 을 저장, 반복은 null (D-85)', async () => {
      await service.create(1, 10, { ...input, reminder: 'HOUR_1' });
      expect(events.createWithLogTx.mock.calls[0][0]).toMatchObject({ reminder: 'HOUR_1', remindAt: kst('2026-12-01T17:00:00') });
      await service.create(1, 10, { ...input, reminder: 'HOUR_1', repeat: 'WEEKLY' });
      expect(events.createWithLogTx.mock.calls[1][0]).toMatchObject({ reminder: 'HOUR_1', remindAt: null });
    });

    it('종일과 안 맞으면 400, 종일 값은 KST 날짜로', async () => {
      await expect(service.create(1, 10, { ...input, reminder: 'DAY_OF_0900' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const allDay = { title: '여행', startsAt: '2026-12-01T00:00:00+09:00', endsAt: '2026-12-02T00:00:00+09:00', allDay: true };
      await expect(service.create(1, 10, { ...allDay, reminder: 'MIN_10' })).rejects.toMatchObject({ details: [{ field: 'reminder' }] });
      await service.create(1, 10, { ...allDay, reminder: 'DAY_BEFORE_0900' });
      expect(events.createWithLogTx.mock.calls[0][0]).toMatchObject({ remindAt: kst('2026-11-30T09:00:00') });
      expect(events.createWithLogTx).toHaveBeenCalledTimes(1);
    });
  });

  describe('한 번짜리 수정', () => {
    beforeEach(() => events.findInGroup.mockResolvedValue(ONCE));

    it('제목만 바꾸면 기준 시각은 그대로 (D-86)', async () => {
      await service.update(1, 10, 100, { title: '바뀜' });
      const data = events.updateWithLogTx.mock.calls[0][1];
      expect(data).toMatchObject({ reminder: 'HOUR_1', remindAt: kst('2026-12-01T17:00:00') });
      expect(data).not.toHaveProperty('reminderSetAt');
    });

    it('시각을 바꾸면 remindAt 다시 계산 + 기준 시각 지금', async () => {
      await service.update(1, 10, 100, { startsAt: '2026-12-01T19:00:00+09:00', endsAt: '2026-12-01T21:00:00+09:00' });
      expect(events.updateWithLogTx.mock.calls[0][1]).toMatchObject({ remindAt: kst('2026-12-01T18:00:00'), reminderSetAt: expect.any(Date) });
    });

    it('알림만 바꿔도 저장, 같은 값이면 저장하지 않는다 (#62)', async () => {
      await service.update(1, 10, 100, { reminder: 'HOUR_1' });
      expect(events.updateWithLogTx).not.toHaveBeenCalled();
      const view = await service.update(1, 10, 100, { reminder: 'MIN_10' });
      expect(events.updateWithLogTx.mock.calls[0][1]).toMatchObject({ reminder: 'MIN_10', remindAt: kst('2026-12-01T17:50:00'), reminderSetAt: expect.any(Date) });
      expect(view.reminder).toBe('MIN_10');
    });

    it('본문에 reminder 없이 종일로 바꾸면 NONE (remindAt null)', async () => {
      await service.update(1, 10, 100, { allDay: true, startsAt: '2026-12-01T00:00:00+09:00', endsAt: '2026-12-02T00:00:00+09:00' });
      expect(events.updateWithLogTx.mock.calls[0][1]).toMatchObject({ allDay: true, reminder: 'NONE', remindAt: null });
    });

    it('종일로 바꾸면서 맞지 않는 값을 보내면 400', async () => {
      await expect(service.update(1, 10, 100, { allDay: true, reminder: 'HOUR_1' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('반복을 켜면 remindAt null + 기준 시각 지금', async () => {
      await service.update(1, 10, 100, { repeat: 'WEEKLY' });
      expect(events.updateWithLogTx.mock.calls[0][1]).toMatchObject({ repeat: 'WEEKLY', remindAt: null, reminderSetAt: expect.any(Date) });
    });
  });

  describe('반복 "이 일정만" (EventException.reminder)', () => {
    const q = { scope: 'this', occurrence: '2026-11-18' };
    beforeEach(() => events.findInGroup.mockResolvedValue(SERIES));

    it('원본과 다른 알림은 예외에 저장 + 회차 기준 시각', async () => {
      const view = await service.update(1, 10, 200, { reminder: 'MIN_10' }, q);
      const [, , fields, , , setAt] = events.saveExceptionWithLogTx.mock.calls[0];
      expect(fields).toMatchObject({ reminder: 'MIN_10', title: null, startsAt: null });
      expect(setAt).toBeInstanceOf(Date);
      expect(view.reminder).toBe('MIN_10');
    });

    it('원래 회차 값(원본 알림)과 같아지면 null (예외 행이 빈 값이면 지운다)', async () => {
      events.listExceptions.mockResolvedValue([exception({ reminder: 'MIN_10' })]);
      await service.update(1, 10, 200, { reminder: 'HOUR_1' }, q);
      expect(events.saveExceptionWithLogTx.mock.calls[0][2]).toBeNull();
    });

    it('예외의 알림이 회차 값으로 보인다 (GET)', async () => {
      events.listExceptions.mockResolvedValue([exception({ reminder: 'NONE' })]);
      expect((await service.get(1, 10, 200, '2026-11-18')).reminder).toBe('NONE');
      expect((await service.get(1, 10, 200, '2026-11-25')).reminder).toBe('HOUR_1');
    });

    it('회차를 종일로 바꾸면 원본 알림이 안 맞아 NONE 을 예외에 저장', async () => {
      await service.update(1, 10, 200, { allDay: true, startsAt: '2026-11-18T00:00:00+09:00', endsAt: '2026-11-19T00:00:00+09:00' }, q);
      expect(events.saveExceptionWithLogTx.mock.calls[0][2]).toMatchObject({ allDay: true, reminder: 'NONE' });
    });
  });

  describe('반복 "이후 모두"', () => {
    beforeEach(() => events.findInGroup.mockResolvedValue(SERIES));

    it('첫 회차: 원본 알림을 바꾸면 기준 시각 지금, remindAt 은 null', async () => {
      await service.update(1, 10, 200, { reminder: 'MIN_10' }, { scope: 'following', occurrence: '2026-11-11' });
      expect(events.updateSeriesFromStartTx.mock.calls[0][1]).toMatchObject({ reminder: 'MIN_10', remindAt: null, reminderSetAt: expect.any(Date) });
    });

    it('첫 회차: 제목만이고 예외가 없으면 기준 시각 그대로', async () => {
      await service.update(1, 10, 200, { title: '바뀜' }, { scope: 'following', occurrence: '2026-11-11' });
      expect(events.updateSeriesFromStartTx.mock.calls[0][1]).not.toHaveProperty('reminderSetAt');
    });

    it('반복을 끄면 한 번짜리로 remindAt 계산', async () => {
      await service.update(1, 10, 200, { repeat: null }, { scope: 'following', occurrence: '2026-11-11' });
      expect(events.updateSeriesFromStartTx.mock.calls[0][1]).toMatchObject({ repeat: null, remindAt: kst('2026-11-11T18:00:00') });
    });

    it('그 뒤 회차: 새 원본은 알림을 이어받고 기준 시각 지금', async () => {
      events.splitSeriesTx.mockResolvedValue({ ...SERIES, id: 201 } as never);
      await service.update(1, 10, 200, { title: '바뀜' }, { scope: 'following', occurrence: '2026-11-25' });
      expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ reminder: 'HOUR_1', remindAt: null, reminderSetAt: expect.any(Date) });
    });
  });
});
