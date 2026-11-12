import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { EventExceptionRow, EventRow, EventsRepository, SeriesRow } from './events.repository.js';
import { assertRepeatRule, EventsService, inheritedUntil } from './events.service.js';
import { expand, kstDate, type Repeat } from './recurrence.js';

/** 반복 일정 (#187, 설계 4장) 서비스 단위 테스트. Repository 는 목 */

const kst = (value: string) => new Date(`${value}+09:00`);
const config = { getOrThrow: () => 'http://web' } as never;

/** 2026-11-11(수) 19:00~21:00 KST 매주 */
const SERIES: EventRow = {
  id: 200,
  groupId: 10,
  publicCode: 'srescode',
  title: '저녁',
  startsAt: kst('2026-11-11T19:00:00'),
  endsAt: kst('2026-11-11T21:00:00'),
  allDay: false,
  memo: '원본 메모',
  creatorId: 2,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  repeat: 'WEEKLY',
  repeatUntil: null,
  repeatAnchor: null,
  reminder: 'NONE',
  reminderSetAt: new Date('2026-11-01T00:00:00.000Z'),
  creator: { nickname: '밥', profileImageUrl: null },
  allMembers: true,
  participantIds: [] as number[],
};
const ONCE: EventRow = { ...SERIES, id: 100, title: '한 번', memo: null, repeat: null, startsAt: kst('2026-11-18T19:00:00'), endsAt: kst('2026-11-18T20:00:00') };

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

describe('EventsService 반복 일정', () => {
  let events: RepositoryMock<EventsRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let service: EventsService;

  beforeEach(() => {
    events = mockRepository(EventsRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, config);
    service = new EventsService(events as never, memberships);
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow(), membershipRow({ id: 1002, userId: 2, displayName: '밥' })]);
    events.listInRange.mockResolvedValue([]);
    events.listSeriesForRange.mockResolvedValue([]);
    events.listExceptions.mockResolvedValue([]);
    events.findInGroup.mockResolvedValue(SERIES);
  });

  describe('create', () => {
    const input = { title: '저녁', startsAt: '2026-11-11T19:00:00+09:00', endsAt: '2026-11-11T21:00:00+09:00', allDay: false };

    it('repeat, repeatUntil 을 저장하고 첫 회차를 돌려준다', async () => {
      events.createWithLogTx.mockResolvedValue({ ...SERIES, creatorId: 1, repeatUntil: '2026-12-31' });
      const view = await service.create(1, 10, { ...input, repeat: 'WEEKLY', repeatUntil: '2026-12-31' });
      expect(events.createWithLogTx).toHaveBeenCalledWith(
        { groupId: 10, title: '저녁', startsAt: SERIES.startsAt, endsAt: SERIES.endsAt, allDay: false, memo: null, creatorId: 1, repeat: 'WEEKLY', repeatUntil: '2026-12-31', reminder: 'NONE', remindAt: null, reminderSetAt: expect.any(Date), participants: { allMembers: false, ids: [1] } },
        1,
      );
      expect(view).toMatchObject({ repeat: 'WEEKLY', repeatUntil: '2026-12-31', occurrence: '2026-11-11', seriesStartsAt: SERIES.startsAt });
    });

    it('repeat 생략/null 은 한 번짜리 (repeat 키를 넘기지 않는다), 응답의 반복 필드는 null', async () => {
      events.createWithLogTx.mockResolvedValue({ ...ONCE });
      const view = await service.create(1, 10, { ...input, repeat: null });
      expect(events.createWithLogTx.mock.calls[0][0]).not.toHaveProperty('repeat');
      expect(view).toMatchObject({ repeat: null, repeatUntil: null, occurrence: null, seriesStartsAt: null });
    });

    it('검증 4-1: 길이 >= 주기, 종료일 < 첫 회차 날짜, repeatUntil 만 있음', async () => {
      await expect(service.create(1, 10, { ...input, endsAt: '2026-11-19T00:00:00+09:00', repeat: 'WEEKLY' })).rejects.toMatchObject({
        code: 'EVENT_RANGE_INVALID',
        message: '반복 간격보다 긴 일정은 반복할 수 없어요',
      });
      await expect(service.create(1, 10, { ...input, repeat: 'WEEKLY', repeatUntil: '2026-11-10' })).rejects.toMatchObject({
        code: 'EVENT_RANGE_INVALID',
        message: '종료 날짜는 시작 날짜 뒤여야 해요',
      });
      await expect(service.create(1, 10, { ...input, repeatUntil: '2026-12-31' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field: 'repeatUntil' }],
      });
      // 기존 규칙(종료 > 시작) 이 먼저
      await expect(service.create(1, 10, { ...input, endsAt: input.startsAt, repeat: 'WEEKLY' })).rejects.toMatchObject({ message: '종료 시각은 시작 시각보다 뒤여야 해요' });
      expect(events.createWithLogTx).not.toHaveBeenCalled();
    });

    it('종료일 = 첫 회차 날짜는 허용 (KST 날짜 기준)', async () => {
      events.createWithLogTx.mockResolvedValue(SERIES);
      await service.create(1, 10, { ...input, startsAt: '2026-11-11T00:30:00+09:00', endsAt: '2026-11-11T01:00:00+09:00', repeat: 'MONTHLY', repeatUntil: '2026-11-11' });
      expect(events.createWithLogTx).toHaveBeenCalled();
    });
  });

  describe('assertRepeatRule', () => {
    it('주기별 상한: 매월 28일, 매년 365일 (일정 30일 상한과 별개)', () => {
      const start = kst('2026-11-01T00:00:00');
      const days = (n: number) => new Date(start.getTime() + n * 86_400_000);
      expect(() => assertRepeatRule('MONTHLY', null, start, days(28))).toThrow('반복 간격보다');
      expect(() => assertRepeatRule('MONTHLY', null, start, days(27))).not.toThrow();
      expect(() => assertRepeatRule('BIWEEKLY', null, start, days(14))).toThrow('반복 간격보다');
      expect(() => assertRepeatRule('YEARLY', null, start, days(30))).not.toThrow();
      expect(() => assertRepeatRule(null, null, start, days(30))).not.toThrow();
    });
  });

  describe('list', () => {
    it('반복 원본을 기간 안 회차로 펼쳐 한 번짜리와 합친다. startsAt, id 순', async () => {
      const series: SeriesRow = {
        ...SERIES,
        repeat: 'WEEKLY',
        exceptions: [exception({ occurrence: '2026-11-25', title: '바뀐 제목', memo: '' }), exception({ occurrence: '2026-12-02', cancelled: true })],
      };
      const sameTime: EventRow = { ...ONCE, id: 50, startsAt: kst('2026-11-18T19:00:00') };
      events.listInRange.mockResolvedValue([ONCE, sameTime]);
      events.listSeriesForRange.mockResolvedValue([series]);
      const from = kst('2026-11-15T00:00:00');
      const to = kst('2026-12-10T00:00:00');
      const list = await service.list(1, 10, from.toISOString(), to.toISOString());

      expect(events.listSeriesForRange).toHaveBeenCalledWith(10, from, to);
      expect(list.map((v) => [v.id, v.occurrence, v.startsAt.toISOString()])).toEqual([
        [50, null, kst('2026-11-18T19:00:00').toISOString()],
        [100, null, kst('2026-11-18T19:00:00').toISOString()],
        [200, '2026-11-18', kst('2026-11-18T19:00:00').toISOString()],
        [200, '2026-11-25', kst('2026-11-25T19:00:00').toISOString()],
        [200, '2026-12-09', kst('2026-12-09T19:00:00').toISOString()],
      ]);
      expect(list[2]).toMatchObject({ title: '저녁', memo: '원본 메모', repeat: 'WEEKLY', seriesStartsAt: SERIES.startsAt, creator: { userId: 2, displayName: '밥' } });
      expect(list[3]).toMatchObject({ title: '바뀐 제목', memo: '' });
      expect(list[0]).not.toHaveProperty('hasLaterExceptions');
    });
  });

  describe('get', () => {
    it('occurrence 회차 + hasLaterExceptions (그 회차보다 뒤 예외가 있으면 true)', async () => {
      events.listExceptions.mockResolvedValue([exception({ occurrence: '2026-11-25', startsAt: kst('2026-11-25T20:00:00'), endsAt: kst('2026-11-25T22:00:00') })]);
      const view = await service.get(1, 10, 200, '2026-11-18');
      expect(view).toMatchObject({ id: 200, occurrence: '2026-11-18', startsAt: kst('2026-11-18T19:00:00'), hasLaterExceptions: true, seriesStartsAt: SERIES.startsAt });
      const moved = await service.get(1, 10, 200, '2026-11-25');
      expect(moved).toMatchObject({ occurrence: '2026-11-25', startsAt: kst('2026-11-25T20:00:00'), hasLaterExceptions: false });
      expect(events.listExceptions).toHaveBeenCalledWith(200);
    });

    it('occurrence 가 없거나 빈 값이면 첫 회차', async () => {
      expect(await service.get(1, 10, 200)).toMatchObject({ occurrence: '2026-11-11', startsAt: SERIES.startsAt, hasLaterExceptions: false });
      expect(await service.get(1, 10, 200, '')).toMatchObject({ occurrence: '2026-11-11' });
    });

    it('형식 오류는 400, 규칙에 없는 날짜, repeatUntil 뒤, 취소된 회차는 404', async () => {
      await expect(service.get(1, 10, 200, '2026-02-30')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ field: 'occurrence' }] });
      await expect(service.get(1, 10, 200, ['2026-11-18'])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(service.get(1, 10, 200, '2026-11-19')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(service.get(1, 10, 200, '2026-11-04')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      events.findInGroup.mockResolvedValue({ ...SERIES, repeatUntil: '2026-11-24' });
      await expect(service.get(1, 10, 200, '2026-11-25')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      events.findInGroup.mockResolvedValue(SERIES);
      events.listExceptions.mockResolvedValue([exception({ occurrence: '2026-11-18', cancelled: true })]);
      await expect(service.get(1, 10, 200, '2026-11-18')).rejects.toMatchObject({ code: 'NOT_FOUND', message: '일정을 찾을 수 없어요' });
    });

    it('한 번짜리는 occurrence 를 무시한다 (형식이 틀려도)', async () => {
      events.findInGroup.mockResolvedValue(ONCE);
      expect(await service.get(1, 10, 100, 'garbage')).toMatchObject({ id: 100, occurrence: null, repeat: null, hasLaterExceptions: false });
      expect(events.listExceptions).not.toHaveBeenCalled();
    });
  });

  describe('update 공통', () => {
    it('반복 일정에 scope 가 없거나 틀리면 400 (field scope), occurrence 가 없으면 400 (field occurrence)', async () => {
      await expect(service.update(1, 10, 200, { title: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ field: 'scope' }] });
      await expect(service.update(1, 10, 200, { title: 'x' }, { occurrence: '2026-11-18', scope: 'all' })).rejects.toMatchObject({ details: [{ field: 'scope' }] });
      await expect(service.update(1, 10, 200, { title: 'x' }, { scope: 'this' })).rejects.toMatchObject({ details: [{ field: 'occurrence' }] });
      await expect(service.update(1, 10, 200, { title: 'x' }, { scope: 'this', occurrence: '2026-11-19' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(events.saveExceptionWithLogTx).not.toHaveBeenCalled();
    });

    it('한 번짜리는 occurrence, scope 를 무시하고 지금과 같다', async () => {
      events.findInGroup.mockResolvedValue(ONCE);
      events.updateWithLogTx.mockResolvedValue({ ...ONCE, title: '변경' });
      await service.update(1, 10, 100, { title: '변경' }, { scope: 'bogus', occurrence: 'x' });
      expect(events.updateWithLogTx).toHaveBeenCalledWith(expect.objectContaining({ id: 100 }), { title: '변경', startsAt: ONCE.startsAt, endsAt: ONCE.endsAt, allDay: false, memo: null, reminder: 'NONE', remindAt: null }, 1);
    });

    it('한 번짜리에 반복을 켜면 그 일정이 첫 회차가 된다', async () => {
      events.findInGroup.mockResolvedValue(ONCE);
      events.updateWithLogTx.mockResolvedValue({ ...ONCE, repeat: 'MONTHLY', repeatUntil: '2027-03-01' });
      const view = await service.update(1, 10, 100, { repeat: 'MONTHLY', repeatUntil: '2027-03-01' });
      expect(events.updateWithLogTx).toHaveBeenCalledWith(expect.objectContaining({ id: 100 }), expect.objectContaining({ repeat: 'MONTHLY', repeatUntil: '2027-03-01' }), 1);
      expect(view).toMatchObject({ repeat: 'MONTHLY', occurrence: '2026-11-18', seriesStartsAt: ONCE.startsAt });
    });

    it('한 번짜리: repeatUntil 만 있으면 400, repeat null 은 그대로 (no-op), 주기보다 길면 거부', async () => {
      events.findInGroup.mockResolvedValue(ONCE);
      await expect(service.update(1, 10, 100, { repeatUntil: '2027-01-01' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ field: 'repeatUntil' }] });
      const view = await service.update(1, 10, 100, { repeat: null });
      expect(view.updatedAt).toEqual(ONCE.updatedAt);
      await expect(service.update(1, 10, 100, { endsAt: '2026-11-26T19:00:00+09:00', repeat: 'WEEKLY' })).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
      expect(events.updateWithLogTx).not.toHaveBeenCalled();
    });
  });

  describe('PATCH scope=this', () => {
    const q = { scope: 'this', occurrence: '2026-11-25' };

    it('원래 회차와 다른 필드만 예외로 upsert, UPDATED THIS 로그 스냅샷은 그 회차 값', async () => {
      const view = await service.update(1, 10, 200, { startsAt: '2026-11-25T20:00:00+09:00', endsAt: '2026-11-25T22:00:00+09:00' }, q);
      expect(events.saveExceptionWithLogTx).toHaveBeenCalledWith(
        SERIES,
        '2026-11-25',
        { title: null, startsAt: kst('2026-11-25T20:00:00'), endsAt: kst('2026-11-25T22:00:00'), allDay: null, memo: null, reminder: null },
        { actorId: 1, scope: 'THIS', occurrence: '2026-11-25' },
        { title: '저녁', startsAt: kst('2026-11-25T20:00:00'), endsAt: kst('2026-11-25T22:00:00'), allDay: false, memo: '원본 메모', reminder: 'NONE', repeat: 'WEEKLY', participants: { allMembers: true, ids: [] } },
        // (#188) 회차 시각이 바뀌었으니 기준 시각 (D-86)
        expect.any(Date),
      );
      expect(view).toMatchObject({ id: 200, occurrence: '2026-11-25', startsAt: kst('2026-11-25T20:00:00'), title: '저녁', memo: '원본 메모' });
    });

    it('제목, 메모 지움 (null 이든 빈 문자열이든 예외에는 빈 문자열)', async () => {
      await service.update(1, 10, 200, { title: '이번만', memo: null as never }, q);
      expect(events.saveExceptionWithLogTx.mock.calls[0][2]).toEqual({ title: '이번만', startsAt: null, endsAt: null, allDay: null, memo: '', reminder: null });
      // (#188) 제목, 메모만 바꾸면 기준 시각은 그대로
      expect(events.saveExceptionWithLogTx.mock.calls[0][5]).toBeNull();
      const view = await service.update(1, 10, 200, { memo: '' }, q);
      expect(events.saveExceptionWithLogTx.mock.calls[1][2]).toMatchObject({ memo: '' });
      expect(view.memo).toBe('');
    });

    it('기존 예외에 덮어 쓴다 (현재 값 = 예외 반영 값)', async () => {
      events.listExceptions.mockResolvedValue([exception({ occurrence: '2026-11-25', title: '이번만' })]);
      await service.update(1, 10, 200, { memo: '새 메모' }, q);
      expect(events.saveExceptionWithLogTx.mock.calls[0][2]).toEqual({ title: '이번만', startsAt: null, endsAt: null, allDay: null, memo: '새 메모', reminder: null });
    });

    it('예외가 원본과 같은 값이 되면 예외 행을 지운다 (fields = null)', async () => {
      events.listExceptions.mockResolvedValue([exception({ occurrence: '2026-11-25', title: '이번만', memo: '' })]);
      const view = await service.update(1, 10, 200, { title: '저녁', memo: '원본 메모' }, q);
      expect(events.saveExceptionWithLogTx).toHaveBeenCalledWith(SERIES, '2026-11-25', null, expect.objectContaining({ scope: 'THIS' }), expect.anything(), null);
      expect(view).toMatchObject({ title: '저녁', memo: '원본 메모' });
    });

    it('회차의 현재 값과 같으면 저장도 로그도 없다 (#62)', async () => {
      events.listExceptions.mockResolvedValue([exception({ occurrence: '2026-11-25', memo: '' })]);
      for (const dto of [{}, { title: '저녁' }, { memo: null as never }, { memo: '' }, { startsAt: '2026-11-25T10:00:00Z' }]) {
        await service.update(1, 10, 200, dto, q);
      }
      expect(events.saveExceptionWithLogTx).not.toHaveBeenCalled();
    });

    it('본문에 repeat/repeatUntil 이 있으면 400', async () => {
      await expect(service.update(1, 10, 200, { repeat: 'WEEKLY' }, q)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ field: 'repeat' }] });
      await expect(service.update(1, 10, 200, { repeatUntil: null }, q)).rejects.toMatchObject({ details: [{ field: 'repeatUntil' }] });
    });

    it('원래 회차 날짜 앞뒤 30일 밖으로 옮기면 EVENT_RANGE_INVALID, 기존 범위 규칙도 그대로', async () => {
      await expect(service.update(1, 10, 200, { startsAt: '2026-12-26T10:00:00+09:00', endsAt: '2026-12-26T11:00:00+09:00' }, q)).rejects.toMatchObject({
        code: 'EVENT_RANGE_INVALID',
        message: '이 회차는 앞뒤 30일 안으로만 옮길 수 있어요',
      });
      await expect(service.update(1, 10, 200, { startsAt: '2026-10-25T10:00:00+09:00', endsAt: '2026-10-25T11:00:00+09:00' }, q)).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
      await expect(service.update(1, 10, 200, { endsAt: '2026-11-25T18:00:00+09:00' }, q)).rejects.toMatchObject({ message: '종료 시각은 시작 시각보다 뒤여야 해요' });
      // 30일 안은 된다 (주기보다 길어도 회차 하나는 허용)
      await service.update(1, 10, 200, { startsAt: '2026-12-24T10:00:00+09:00', endsAt: '2026-12-25T00:00:00+09:00' }, q);
      expect(events.saveExceptionWithLogTx).toHaveBeenCalledTimes(1);
    });
  });

  describe('PATCH scope=following', () => {
    it('첫 회차: 원본을 그대로 수정 + 예외 전부 삭제 (updateSeriesFromStartTx)', async () => {
      events.updateSeriesFromStartTx.mockResolvedValue({ ...SERIES, title: '바뀜', repeat: 'BIWEEKLY' });
      const view = await service.update(1, 10, 200, { title: '바뀜', repeat: 'BIWEEKLY' }, { scope: 'following', occurrence: '2026-11-11' });
      expect(events.updateSeriesFromStartTx).toHaveBeenCalledWith(
        expect.objectContaining({ id: 200 }),
        {
          title: '바뀜',
          startsAt: SERIES.startsAt,
          endsAt: SERIES.endsAt,
          allDay: false,
          memo: '원본 메모',
          repeat: 'BIWEEKLY',
          repeatUntil: null,
          repeatAnchor: null,
          reminder: 'NONE',
          remindAt: null,
          // (#188) 반복 규칙이 바뀌었으니 기준 시각 (D-86)
          reminderSetAt: expect.any(Date),
        },
        { actorId: 1, scope: 'FOLLOWING', occurrence: '2026-11-11' },
      );
      expect(view).toMatchObject({ title: '바뀜', repeat: 'BIWEEKLY', occurrence: '2026-11-11' });
      expect(events.splitSeriesTx).not.toHaveBeenCalled();
    });

    it('첫 회차: 바뀐 게 없고 예외도 없으면 no-op, 예외가 있으면 지우러 저장한다', async () => {
      await service.update(1, 10, 200, { title: '저녁', repeat: 'WEEKLY' }, { scope: 'following', occurrence: '2026-11-11' });
      expect(events.updateSeriesFromStartTx).not.toHaveBeenCalled();
      events.listExceptions.mockResolvedValue([exception({ occurrence: '2026-12-02', cancelled: true })]);
      events.updateSeriesFromStartTx.mockResolvedValue(SERIES);
      await service.update(1, 10, 200, {}, { scope: 'following', occurrence: '2026-11-11' });
      expect(events.updateSeriesFromStartTx).toHaveBeenCalledTimes(1);
    });

    it('첫 회차: repeat null 이면 한 번짜리가 되고 repeatUntil 도 null', async () => {
      events.findInGroup.mockResolvedValue({ ...SERIES, repeatUntil: '2027-01-01' });
      events.updateSeriesFromStartTx.mockResolvedValue({ ...SERIES, repeat: null });
      const view = await service.update(1, 10, 200, { repeat: null }, { scope: 'following', occurrence: '2026-11-11' });
      expect(events.updateSeriesFromStartTx.mock.calls[0][1]).toMatchObject({ repeat: null, repeatUntil: null });
      expect(view).toMatchObject({ repeat: null, occurrence: null, seriesStartsAt: null });
    });

    it('그 뒤 회차: 원본을 전날에서 끊고 새 원본(원본 등록자, 그 회차 시각 기준) 을 만든다', async () => {
      events.findInGroup.mockResolvedValue({ ...SERIES, repeatUntil: '2027-06-30' });
      const created: EventRow = { ...SERIES, id: 201, title: '바뀜', startsAt: kst('2026-11-25T19:00:00'), endsAt: kst('2026-11-25T21:00:00'), repeatUntil: '2027-06-30' };
      events.splitSeriesTx.mockResolvedValue(created);
      const view = await service.update(1, 10, 200, { title: '바뀜' }, { scope: 'following', occurrence: '2026-11-25' });
      expect(events.splitSeriesTx).toHaveBeenCalledWith(
        expect.objectContaining({ id: 200 }),
        '2026-11-25',
        { actorId: 1, scope: 'FOLLOWING', occurrence: '2026-11-25' },
        {
          groupId: 10,
          title: '바뀜',
          startsAt: kst('2026-11-25T19:00:00'),
          endsAt: kst('2026-11-25T21:00:00'),
          allDay: false,
          memo: '원본 메모',
          creatorId: 2,
          repeat: 'WEEKLY',
          repeatUntil: '2027-06-30',
          repeatAnchor: null,
          reminder: 'NONE',
          remindAt: null,
          reminderSetAt: expect.any(Date),
          participants: { allMembers: true, ids: [] },
        },
      );
      expect(view).toMatchObject({ id: 201, occurrence: '2026-11-25', seriesStartsAt: created.startsAt });
      expect(events.updateSeriesFromStartTx).not.toHaveBeenCalled();
    });

    it('그 뒤 회차: 탈퇴한 등록자(null) 는 그대로 null, 날짜를 바꾸면 새 원본의 요일 기준도 바뀐다', async () => {
      events.findInGroup.mockResolvedValue({ ...SERIES, creatorId: null, creator: null });
      events.splitSeriesTx.mockResolvedValue({ ...SERIES, id: 201 });
      await service.update(1, 10, 200, { startsAt: '2026-11-27T10:00:00+09:00', endsAt: '2026-11-27T11:00:00+09:00' }, { scope: 'following', occurrence: '2026-11-25' });
      expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ creatorId: null, startsAt: kst('2026-11-27T10:00:00') });
    });

    it('그 뒤 회차: 기준 값은 그 회차의 규칙 자리 (예외 적용 전, QA3-M3)', async () => {
      events.listExceptions.mockResolvedValue([exception({ occurrence: '2026-11-25', startsAt: kst('2026-11-25T20:00:00'), endsAt: kst('2026-11-25T22:00:00'), title: '이번만' })]);
      events.splitSeriesTx.mockResolvedValue({ ...SERIES, id: 201 });
      await service.update(1, 10, 200, { memo: '새 메모' }, { scope: 'following', occurrence: '2026-11-25' });
      expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ title: '저녁', startsAt: kst('2026-11-25T19:00:00'), endsAt: kst('2026-11-25T21:00:00'), memo: '새 메모' });
    });

    it('"이 일정만" 은 여전히 그 회차의 현재 값 (예외 반영) 이 기준', async () => {
      events.listExceptions.mockResolvedValue([exception({ occurrence: '2026-11-25', startsAt: kst('2026-11-25T20:00:00'), endsAt: kst('2026-11-25T22:00:00'), title: '이번만' })]);
      await service.update(1, 10, 200, { memo: '새 메모' }, { scope: 'this', occurrence: '2026-11-25' });
      expect(events.saveExceptionWithLogTx.mock.calls[0][4]).toMatchObject({ title: '이번만', startsAt: kst('2026-11-25T20:00:00'), memo: '새 메모' });
    });

    it('그 뒤 회차: 원래 회차 값 그대로이고 이 회차부터 예외가 없으면 no-op (#62)', async () => {
      events.listExceptions.mockResolvedValue([exception({ occurrence: '2026-11-18', title: '앞 회차' })]);
      const view = await service.update(1, 10, 200, { title: '저녁', repeat: 'WEEKLY' }, { scope: 'following', occurrence: '2026-11-25' });
      expect(view).toMatchObject({ id: 200, occurrence: '2026-11-25' });
      expect(events.splitSeriesTx).not.toHaveBeenCalled();
      // 뒤에 예외가 있으면 지워야 하므로 저장한다
      events.listExceptions.mockResolvedValue([exception({ occurrence: '2026-12-02', title: '뒤 회차' })]);
      events.splitSeriesTx.mockResolvedValue({ ...SERIES, id: 201 });
      await service.update(1, 10, 200, {}, { scope: 'following', occurrence: '2026-11-25' });
      expect(events.splitSeriesTx).toHaveBeenCalledTimes(1);
    });

    it('그 뒤 회차: repeat null 이면 그 회차는 한 번짜리, repeatUntil 이 새 시작보다 앞이면 거부', async () => {
      events.splitSeriesTx.mockResolvedValue({ ...SERIES, id: 201, repeat: null });
      await service.update(1, 10, 200, { repeat: null }, { scope: 'following', occurrence: '2026-11-25' });
      expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ repeat: null, repeatUntil: null });
      await expect(
        service.update(1, 10, 200, { repeatUntil: '2026-11-24' }, { scope: 'following', occurrence: '2026-11-25' }),
      ).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID', message: '종료 날짜는 시작 날짜 뒤여야 해요' });
      await expect(
        service.update(1, 10, 200, { repeat: null, repeatUntil: '2027-01-01' }, { scope: 'following', occurrence: '2026-11-25' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ field: 'repeatUntil' }] });
      await expect(
        service.update(1, 10, 200, { endsAt: '2026-12-03T00:00:00+09:00' }, { scope: 'following', occurrence: '2026-11-25' }),
      ).rejects.toMatchObject({ message: '반복 간격보다 긴 일정은 반복할 수 없어요' });
      expect(events.splitSeriesTx).toHaveBeenCalledTimes(1);
    });

    it('QA3-L1: repeatUntil 을 안 보냈는데 종료 날짜 뒤로 옮기면 종료를 새 시작 날짜로 늘린다', async () => {
      // 종료 11-25 인 매주 반복의 마지막 회차(11-25) 를 11-27 로
      events.findInGroup.mockResolvedValue({ ...SERIES, repeatUntil: '2026-11-25' });
      events.splitSeriesTx.mockResolvedValue({ ...SERIES, id: 201 });
      await service.update(
        1,
        10,
        200,
        { startsAt: '2026-11-27T19:00:00+09:00', endsAt: '2026-11-27T21:00:00+09:00' },
        { scope: 'following', occurrence: '2026-11-25' },
      );
      expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ startsAt: kst('2026-11-27T19:00:00'), repeat: 'WEEKLY', repeatUntil: '2026-11-27' });
    });

    it('QA3-L1: 첫 회차를 옮겨도 같다, 종료 안쪽이면 그대로 이어받는다', async () => {
      events.findInGroup.mockResolvedValue({ ...SERIES, repeatUntil: '2026-11-11' });
      events.updateSeriesFromStartTx.mockResolvedValue(SERIES);
      await service.update(1, 10, 200, { startsAt: '2026-11-13T19:00:00+09:00', endsAt: '2026-11-13T21:00:00+09:00' }, { scope: 'following', occurrence: '2026-11-11' });
      expect(events.updateSeriesFromStartTx.mock.calls[0][1]).toMatchObject({ repeatUntil: '2026-11-13' });

      events.findInGroup.mockResolvedValue({ ...SERIES, repeatUntil: '2026-12-31' });
      events.splitSeriesTx.mockResolvedValue({ ...SERIES, id: 201 });
      await service.update(1, 10, 200, { startsAt: '2026-11-27T19:00:00+09:00', endsAt: '2026-11-27T21:00:00+09:00' }, { scope: 'following', occurrence: '2026-11-25' });
      expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ repeatUntil: '2026-12-31' });
    });

    it('QA3-L1: repeatUntil 을 보냈으면 늘리지 않고 검증한다', async () => {
      events.findInGroup.mockResolvedValue({ ...SERIES, repeatUntil: '2026-11-25' });
      await expect(
        service.update(
          1,
          10,
          200,
          { startsAt: '2026-11-27T19:00:00+09:00', endsAt: '2026-11-27T21:00:00+09:00', repeatUntil: '2026-11-25' },
          { scope: 'following', occurrence: '2026-11-25' },
        ),
      ).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID', message: '종료 날짜는 시작 날짜 뒤여야 해요' });
      expect(events.splitSeriesTx).not.toHaveBeenCalled();
    });
  });

  describe('inheritedUntil', () => {
    it('계속(null) 은 null, 새 시작이 종료 뒤면 새 시작 날짜(KST), 아니면 그대로', () => {
      expect(inheritedUntil(null, kst('2026-11-27T19:00:00'))).toBeNull();
      expect(inheritedUntil('2026-11-25', kst('2026-11-27T19:00:00'))).toBe('2026-11-27');
      expect(inheritedUntil('2026-11-27', kst('2026-11-27T19:00:00'))).toBe('2026-11-27');
      expect(inheritedUntil('2026-12-31', kst('2026-11-27T19:00:00'))).toBe('2026-12-31');
      // KST 00:30 은 UTC 로 전날이지만 KST 날짜로 본다
      expect(inheritedUntil('2026-11-26', kst('2026-11-27T00:30:00'))).toBe('2026-11-27');
    });
  });

  describe('DELETE', () => {
    const snapshotOf = (date: string, hour = '19') => ({
      title: '저녁',
      reminder: 'NONE',
      startsAt: kst(`${date}T${hour}:00:00`),
      endsAt: kst(`${date}T21:00:00`),
      allDay: false,
      memo: '원본 메모',
      repeat: 'WEEKLY',
    });

    it('this: 예외 cancelled upsert + DELETED THIS (스냅샷은 그 회차)', async () => {
      expect(await service.remove(1, 10, 200, { scope: 'this', occurrence: '2026-11-25' })).toEqual({ ok: true });
      expect(events.cancelOccurrenceWithLogTx).toHaveBeenCalledWith(SERIES, '2026-11-25', { actorId: 1, scope: 'THIS', occurrence: '2026-11-25' }, snapshotOf('2026-11-25'));
    });

    it('following 첫 회차: 원본 삭제', async () => {
      await service.remove(1, 10, 200, { scope: 'following', occurrence: '2026-11-11' });
      expect(events.deleteSeriesWithLogTx).toHaveBeenCalledWith(SERIES, { actorId: 1, scope: 'FOLLOWING', occurrence: '2026-11-11' }, snapshotOf('2026-11-11'));
      expect(events.splitSeriesTx).not.toHaveBeenCalled();
    });

    it('following 그 뒤 회차: 원본을 전날에서 끊는다 (새 원본 없음)', async () => {
      await service.remove(1, 10, 200, { scope: 'following', occurrence: '2026-12-02' });
      expect(events.splitSeriesTx).toHaveBeenCalledWith(SERIES, '2026-12-02', { actorId: 1, scope: 'FOLLOWING', occurrence: '2026-12-02' }, null, snapshotOf('2026-12-02'));
      expect(events.deleteSeriesWithLogTx).not.toHaveBeenCalled();
    });

    it('scope/occurrence 없으면 400, 취소된 회차는 404, 한 번짜리는 쿼리를 무시', async () => {
      await expect(service.remove(1, 10, 200)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ field: 'scope' }] });
      events.listExceptions.mockResolvedValue([exception({ occurrence: '2026-11-18', cancelled: true })]);
      await expect(service.remove(1, 10, 200, { scope: 'this', occurrence: '2026-11-18' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      events.findInGroup.mockResolvedValue(ONCE);
      await service.remove(1, 10, 100, { scope: 'x' });
      expect(events.deleteWithLogTx).toHaveBeenCalledWith(ONCE, 1);
      expect(events.cancelOccurrenceWithLogTx).not.toHaveBeenCalled();
    });
  });

  describe('반복 기준 날짜 repeatAnchor (QA3-M3, D-71)', () => {
    /** 2026-10-31(토) 09:00~10:00 KST 매월 */
    const MONTHLY31: EventRow = { ...SERIES, id: 300, title: '31일 회비', memo: null, startsAt: kst('2026-10-31T09:00:00'), endsAt: kst('2026-10-31T10:00:00'), repeat: 'MONTHLY' };
    /** 2024-02-29(목) 09:00~10:00 KST 매년 */
    const LEAP: EventRow = { ...SERIES, id: 400, title: '윤일', memo: null, startsAt: kst('2024-02-29T09:00:00'), endsAt: kst('2024-02-29T10:00:00'), repeat: 'YEARLY' };
    const following = (occurrence: string) => ({ scope: 'following', occurrence });
    /** splitSeriesTx 에 넘긴 새 원본을 펼친 회차 날짜들 */
    const createdDates = (from: string, to: string): string[] => {
      const created = events.splitSeriesTx.mock.calls[0][3] as { startsAt: Date; endsAt: Date; allDay: boolean; repeat: Repeat; repeatUntil: string | null; repeatAnchor: string | null };
      return expand(created, [], kst(`${from}T00:00:00`), kst(`${to}T00:00:00`)).map((o) => kstDate(o.startsAt));
    };

    beforeEach(() => {
      events.splitSeriesTx.mockResolvedValue({ ...MONTHLY31, id: 301 });
    });

    it('매월 31일을 2/28 회차에서 "이후 모두" 로 제목만 바꿔도 3-31, 4-30, 5-31 (웹이 그 회차 시각을 보내도 같다)', async () => {
      events.findInGroup.mockResolvedValue(MONTHLY31);
      await service.update(
        1, 10, 300,
        { title: '31일 회비 (인상)', startsAt: '2027-02-28T09:00:00+09:00', endsAt: '2027-02-28T10:00:00+09:00', repeat: 'MONTHLY', repeatUntil: null },
        following('2027-02-28'),
      );
      expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ title: '31일 회비 (인상)', startsAt: kst('2027-02-28T09:00:00'), repeat: 'MONTHLY', repeatAnchor: '2026-10-31' });
      expect(createdDates('2027-02-01', '2027-06-01')).toEqual(['2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
    });

    it('본문에 시각이 없어도 같은 규칙 자리에서 잇는다. 시각만 바꾸면 기준 유지', async () => {
      events.findInGroup.mockResolvedValue(MONTHLY31);
      await service.update(1, 10, 300, { title: '바뀜' }, following('2027-02-28'));
      expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ startsAt: kst('2027-02-28T09:00:00'), repeatAnchor: '2026-10-31' });
      events.splitSeriesTx.mockClear();
      await service.update(1, 10, 300, { startsAt: '2027-02-28T19:00:00+09:00', endsAt: '2027-02-28T20:00:00+09:00' }, following('2027-02-28'));
      expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ startsAt: kst('2027-02-28T19:00:00'), repeatAnchor: '2026-10-31' });
      expect(createdDates('2027-03-01', '2027-05-01')).toEqual(['2027-03-31', '2027-04-30']);
    });

    it('매년 2/29 를 2027-02-28 회차에서 "이후 모두" 로 제목만 바꿔도 2028-02-29', async () => {
      events.findInGroup.mockResolvedValue(LEAP);
      await service.update(1, 10, 400, { title: '윤일 (바뀜)' }, following('2027-02-28'));
      expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ startsAt: kst('2027-02-28T09:00:00'), repeatAnchor: '2024-02-29' });
      expect(createdDates('2028-02-01', '2028-03-15')).toEqual(['2028-02-29']);
    });

    it('매주: "이 일정만" 으로 금요일로 옮긴 회차에서 "이후 모두" 로 제목만 바꾸면 원래 수요일에서 잇는다', async () => {
      events.listExceptions.mockResolvedValue([exception({ occurrence: '2026-11-18', startsAt: kst('2026-11-20T19:00:00'), endsAt: kst('2026-11-20T21:00:00') })]);
      events.splitSeriesTx.mockResolvedValue({ ...SERIES, id: 201 });
      await service.update(1, 10, 200, { title: '저녁 (바뀜)' }, following('2026-11-18'));
      expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ startsAt: kst('2026-11-18T19:00:00'), repeat: 'WEEKLY', repeatAnchor: null });
      expect(createdDates('2026-11-18', '2026-12-03')).toEqual(['2026-11-18', '2026-11-25', '2026-12-02']);
    });

    it('날짜를 바꾸거나 주기를 바꾸면 기준은 null (새 시작이 기준)', async () => {
      events.findInGroup.mockResolvedValue(MONTHLY31);
      await service.update(1, 10, 300, { startsAt: '2027-02-27T09:00:00+09:00', endsAt: '2027-02-27T10:00:00+09:00' }, following('2027-02-28'));
      expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ startsAt: kst('2027-02-27T09:00:00'), repeatAnchor: null });
      await service.update(1, 10, 300, { repeat: 'YEARLY' }, following('2027-02-28'));
      expect(events.splitSeriesTx.mock.calls[1][3]).toMatchObject({ repeat: 'YEARLY', repeatAnchor: null });
      await service.update(1, 10, 300, { repeat: null }, following('2027-02-28'));
      expect(events.splitSeriesTx.mock.calls[2][3]).toMatchObject({ repeat: null, repeatAnchor: null });
    });

    it('이미 기준이 있는 원본에서 다시 나누면 그 기준을 잇는다', async () => {
      const split: EventRow = { ...MONTHLY31, id: 301, startsAt: kst('2027-02-28T09:00:00'), endsAt: kst('2027-02-28T10:00:00'), repeatAnchor: '2026-10-31' };
      events.findInGroup.mockResolvedValue(split);
      await service.update(1, 10, 301, { title: '또 바뀜' }, following('2027-04-30'));
      expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ startsAt: kst('2027-04-30T09:00:00'), repeatAnchor: '2026-10-31' });
      expect(createdDates('2027-04-01', '2027-07-01')).toEqual(['2027-04-30', '2027-05-31', '2027-06-30']);
    });

    it('첫 회차 "이후 모두" 는 기준을 그대로 두고, 날짜를 바꾸면 null', async () => {
      const split: EventRow = { ...MONTHLY31, id: 301, startsAt: kst('2027-02-28T09:00:00'), endsAt: kst('2027-02-28T10:00:00'), repeatAnchor: '2026-10-31' };
      events.findInGroup.mockResolvedValue(split);
      events.updateSeriesFromStartTx.mockResolvedValue(split);
      await service.update(1, 10, 301, { title: '바뀜' }, following('2027-02-28'));
      expect(events.updateSeriesFromStartTx.mock.calls[0][1]).toMatchObject({ title: '바뀜', repeatAnchor: '2026-10-31' });
      await service.update(1, 10, 301, { startsAt: '2027-03-01T09:00:00+09:00', endsAt: '2027-03-01T10:00:00+09:00' }, following('2027-02-28'));
      expect(events.updateSeriesFromStartTx.mock.calls[1][1]).toMatchObject({ startsAt: kst('2027-03-01T09:00:00'), repeatAnchor: null });
      // 기준이 없는 원본은 첫 회차에서 고쳐도 null 그대로 (지금 동작)
      events.findInGroup.mockResolvedValue(MONTHLY31);
      events.updateSeriesFromStartTx.mockResolvedValue(MONTHLY31);
      await service.update(1, 10, 300, { title: '바뀜' }, following('2026-10-31'));
      expect(events.updateSeriesFromStartTx.mock.calls[2][1]).toMatchObject({ repeatAnchor: null });
    });

    it('기준을 이어받는 나누기도 바뀐 게 없으면 no-op (#62)', async () => {
      events.findInGroup.mockResolvedValue(MONTHLY31);
      const view = await service.update(1, 10, 300, { title: '31일 회비', repeat: 'MONTHLY' }, following('2027-02-28'));
      expect(events.splitSeriesTx).not.toHaveBeenCalled();
      expect(view).toMatchObject({ id: 300, occurrence: '2027-02-28', repeatAnchor: null });
    });

    it('응답에 repeatAnchor. 한 번짜리는 null, 기준이 있는 원본은 그 값으로 펼친다', async () => {
      const split: EventRow = { ...MONTHLY31, id: 301, startsAt: kst('2027-02-28T09:00:00'), endsAt: kst('2027-02-28T10:00:00'), repeatAnchor: '2026-10-31' };
      events.listSeriesForRange.mockResolvedValue([{ ...split, repeat: 'MONTHLY', exceptions: [] } as SeriesRow]);
      const list = await service.list(1, 10, kst('2027-03-01T00:00:00').toISOString(), kst('2027-04-01T00:00:00').toISOString());
      expect(list.map((v) => [v.occurrence, v.repeatAnchor])).toEqual([['2027-03-31', '2026-10-31']]);
      events.findInGroup.mockResolvedValue(split);
      expect(await service.get(1, 10, 301, '2027-04-30')).toMatchObject({ occurrence: '2027-04-30', repeatAnchor: '2026-10-31' });
      await expect(service.get(1, 10, 301, '2027-04-28')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      events.findInGroup.mockResolvedValue(ONCE);
      expect(await service.get(1, 10, 100)).toMatchObject({ repeatAnchor: null });
    });
  });
});

/** (#248) 반복 일정의 참여자 (설계 3-3, D-135). 참여자는 원본에만 붙는다 */
describe('EventsService 반복 일정 참여자', () => {
  let events: RepositoryMock<EventsRepository>;
  let service: EventsService;
  const PICKED: EventRow = { ...SERIES, allMembers: false, participantIds: [2] };

  beforeEach(() => {
    events = mockRepository(EventsRepository);
    const membershipsRepo = mockRepository(MembershipsRepository);
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, config);
    service = new EventsService(events as never, memberships);
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow(), membershipRow({ id: 1002, userId: 2, displayName: '밥' })]);
    events.listExceptions.mockResolvedValue([]);
    events.findInGroup.mockResolvedValue(PICKED);
  });

  it('scope=this 에 participants 가 오면 400, 같은 값이어도', async () => {
    for (const participants of [[1], [2], 'ALL'] as const) {
      await expect(service.update(1, 10, 200, { participants: participants as never }, { scope: 'this', occurrence: '2026-11-25' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field: 'participants', message: '이 일정만 수정할 때는 참여자를 바꿀 수 없어요' }],
      });
    }
    expect(events.saveExceptionWithLogTx).not.toHaveBeenCalled();
  });

  it('scope=this 의 로그 스냅샷은 원본 참여자', async () => {
    await service.update(1, 10, 200, { title: '이번만' }, { scope: 'this', occurrence: '2026-11-25' });
    expect(events.saveExceptionWithLogTx.mock.calls[0][4]).toMatchObject({ participants: { allMembers: false, ids: [2] } });
  });

  it('following 첫 회차: 원본의 참여자를 바꾼다 (참여자만 바꿔도 저장)', async () => {
    events.updateSeriesFromStartTx.mockResolvedValue({ ...PICKED, allMembers: true, participantIds: [] });
    const view = await service.update(1, 10, 200, { participants: 'ALL' }, { scope: 'following', occurrence: '2026-11-11' });
    expect(events.updateSeriesFromStartTx).toHaveBeenCalledWith(PICKED, expect.objectContaining({ participants: { allMembers: true, ids: [] } }), expect.anything());
    expect(view.participants.all).toBe(true);
  });

  it('following 첫 회차: 생략하거나 같은 값이면 참여자를 넘기지 않고, 다른 것도 같으면 저장 안 함', async () => {
    await service.update(1, 10, 200, { participants: [2] }, { scope: 'following', occurrence: '2026-11-11' });
    expect(events.updateSeriesFromStartTx).not.toHaveBeenCalled();
    events.updateSeriesFromStartTx.mockResolvedValue(PICKED);
    await service.update(1, 10, 200, { title: '바뀜' }, { scope: 'following', occurrence: '2026-11-11' });
    expect(events.updateSeriesFromStartTx.mock.calls[0][1]).not.toHaveProperty('participants');
  });

  it('following 그 뒤 회차: 본문이 없으면 새 원본에 원본 참여자를 복사, 끊긴 원본은 그대로', async () => {
    events.splitSeriesTx.mockResolvedValue({ ...PICKED, id: 201 });
    await service.update(1, 10, 200, { title: '바뀜' }, { scope: 'following', occurrence: '2026-11-25' });
    expect(events.splitSeriesTx.mock.calls[0][0]).toBe(PICKED);
    expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ participants: { allMembers: false, ids: [2] } });
  });

  it('following 그 뒤 회차: 본문 값이 있으면 새 원본에 그 값, 참여자만 바꿔도 나눈다', async () => {
    events.splitSeriesTx.mockResolvedValue({ ...PICKED, id: 201 });
    await service.update(1, 10, 200, { participants: [1, 2] }, { scope: 'following', occurrence: '2026-11-25' });
    expect(events.splitSeriesTx.mock.calls[0][3]).toMatchObject({ participants: { allMembers: false, ids: [1, 2] } });
  });

  it('following 그 뒤 회차: 같은 참여자, 같은 값이면 나누지 않는다', async () => {
    await service.update(1, 10, 200, { participants: [2] }, { scope: 'following', occurrence: '2026-11-25' });
    expect(events.splitSeriesTx).not.toHaveBeenCalled();
  });

  it('목록의 반복 회차는 원본 참여자', async () => {
    events.listInRange.mockResolvedValue([]);
    events.listSeriesForRange.mockResolvedValue([{ ...PICKED, repeat: 'WEEKLY', exceptions: [] }]);
    const list = await service.list(1, 10, '2026-11-11T00:00:00+09:00', '2026-11-26T00:00:00+09:00');
    expect(list).toHaveLength(3);
    expect(list.every((view) => view.participants.all === false && view.participants.members.map((m) => m.userId).join() === '2')).toBe(true);
  });
});
