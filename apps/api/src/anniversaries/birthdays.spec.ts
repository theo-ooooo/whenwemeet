import { birthdayEvents } from '../calendar-feed/feed-items.js';
import { birthdayDedupeKey, birthdayTargetOf, planBirthdays } from '../push/anniversary-planner.js';
import type { BirthdayPlanRow } from '../push/push.repository.js';
import { birthdayAnniversary, birthdayColumns, birthdayFlags, birthdayTitle, isBirthday, isBirthdayOn } from './birthdays.js';

describe('멤버 생일 (#305)', () => {
  it('isBirthday: MM-DD 이고 실제 월일만. 2월 29일은 받는다', () => {
    for (const ok of ['01-01', '02-29', '04-30', '12-31']) expect(isBirthday(ok)).toBe(true);
    for (const bad of ['02-30', '04-31', '13-01', '00-10', '01-00', '1-01', '2026-01-01', '', null, 101]) expect(isBirthday(bad)).toBe(false);
  });

  it('매년 그날, 2월 29일은 평년에 2월 28일 (기념일 매년 규칙, D-62)', () => {
    expect(birthdayAnniversary('03-05')).toEqual({ date: '2000-03-05', kind: 'YEARLY' });
    expect(isBirthdayOn('03-05', '2026-03-05')).toBe(true);
    expect(isBirthdayOn('03-05', '2026-03-06')).toBe(false);
    expect(isBirthdayOn('02-29', '2027-02-28')).toBe(true);
    expect(isBirthdayOn('02-29', '2028-02-29')).toBe(true);
    expect(isBirthdayOn('02-29', '2028-02-28')).toBe(false);
    expect(isBirthdayOn('02-28', '2028-02-28')).toBe(true);
  });

  it('이름과 알림 칸 변환', () => {
    expect(birthdayTitle('민지')).toBe('민지 생일');
    const columns = { birthdayRemindDayOf: false, birthdayRemindDayBefore: true, birthdayRemindWeekBefore: true };
    expect(birthdayFlags(columns)).toEqual({ remindDayOf: false, remindDayBefore: true, remindWeekBefore: true });
    expect(birthdayColumns(birthdayFlags(columns))).toEqual(columns);
  });

  describe('푸시 예약 planBirthdays (D-232)', () => {
    const row = (overrides: Partial<BirthdayPlanRow> = {}): BirthdayPlanRow => ({
      userId: 7,
      groupId: 10,
      groupName: '우리',
      groupCode: 'teamcode',
      name: '민지',
      birthday: '11-20',
      remindDayOf: true,
      remindDayBefore: false,
      remindWeekBefore: false,
      ...overrides,
    });

    it('당일만 (기본): 그날 09:00 KST 에 "오늘은 민지 생일이에요", 생일인 사람은 actorId', () => {
      expect(planBirthdays([row()], '2026-11-19')).toEqual([]);
      const [planned, ...rest] = planBirthdays([row()], '2026-11-20');
      expect(rest).toEqual([]);
      expect(planned).toMatchObject({
        kind: 'ANNIVERSARY',
        dedupeKey: 'B:7:10:2026-11-20',
        groupId: 10,
        actorId: 7,
        scheduledAt: new Date('2026-11-20T00:00:00.000Z'),
        payload: { title: '민지 생일', subtitle: '우리', body: '오늘은 민지 생일이에요', url: '/anniversaries?team=teamcode' },
      });
      expect(planned.anniversaryId).toBeUndefined();
    });

    it('하루 전, 일주일 전은 그날을 키에 담고 :D1, :D7', () => {
      const rows = [row({ remindDayOf: false, remindDayBefore: true, remindWeekBefore: true })];
      expect(planBirthdays(rows, '2026-11-19').map((p) => [p.dedupeKey, p.payload.body])).toEqual([['B:7:10:2026-11-20:D1', '내일은 민지 생일이에요']]);
      expect(planBirthdays(rows, '2026-11-13').map((p) => [p.dedupeKey, p.payload.body])).toEqual([['B:7:10:2026-11-20:D7', '민지 생일이 일주일 남았어요']]);
      expect(planBirthdays(rows, '2026-11-20')).toEqual([]);
    });

    it('2월 29일 생일은 평년 2월 28일에 보낸다', () => {
      expect(planBirthdays([row({ birthday: '02-29' })], '2027-02-28').map((p) => p.dedupeKey)).toEqual(['B:7:10:2027-02-28']);
      expect(planBirthdays([row({ birthday: '02-29' })], '2028-02-28')).toEqual([]);
      expect(planBirthdays([row({ birthday: '02-29' })], '2028-02-29').map((p) => p.dedupeKey)).toEqual(['B:7:10:2028-02-29']);
    });

    it('키에서 그날을 다시 읽는다. 생일 키가 아니면 null', () => {
      expect(birthdayTargetOf(birthdayDedupeKey(7, 10, '2026-11-20', ':D7'))).toBe('2026-11-20');
      expect(birthdayTargetOf('A:3:2026-11-20')).toBeNull();
    });
  });

  describe('구독 피드 birthdayEvents (D-233)', () => {
    const input = { userId: 7, name: '민지', birthday: '02-29', updatedAt: new Date('2026-10-01T00:00:00Z') };

    it('창 안의 해마다 종일 VEVENT 하나, 평년은 2월 28일', () => {
      const items = birthdayEvents(input, { firstDay: '2026-09-14', lastDay: '2028-03-01' });
      expect(items.map((e) => [e.uid, e.start, e.end, e.summary, e.transparent])).toEqual([
        ['b7-20270228@whenwemeet.day', { allDay: true, date: '2027-02-28' }, { allDay: true, date: '2027-03-01' }, '민지 생일', true],
        ['b7-20280229@whenwemeet.day', { allDay: true, date: '2028-02-29' }, { allDay: true, date: '2028-03-01' }, '민지 생일', true],
      ]);
    });

    it('창 밖은 넣지 않는다', () => {
      expect(birthdayEvents({ ...input, birthday: '09-01' }, { firstDay: '2026-09-14', lastDay: '2027-08-31' })).toEqual([]);
    });
  });
});
