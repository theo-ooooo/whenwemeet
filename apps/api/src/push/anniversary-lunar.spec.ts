import { birthdayAnniversary, birthdayOf, isBirthday, isBirthdayOn, type BirthdayValue } from '../anniversaries/birthdays.js';
import { anniversaryEvents, birthdayEvents } from '../calendar-feed/feed-items.js';
import { anniversaryItemsOn, anniversaryOrigin, anniversaryYearDate, type AnniversaryLike } from './anniversary-items.js';
import { planAnniversaries, planBirthdays } from './anniversary-planner.js';
import type { AnniversaryPlanRow, BirthdayPlanRow } from './push-planning.repository.js';
import { weekAnniversary } from './weekly-planner.js';

/** (#562, D-297) 음력 기념일, 생일이 해마다 양력 날짜로 바뀌어 알림, 주간 요약, 피드에 같은 날로 나오는지 */
const lunar = (date: string, kind: AnniversaryLike['kind'], isLeapMonth = false): AnniversaryLike => ({ date, kind, calendar: 'LUNAR', isLeapMonth });
const first = (a: AnniversaryLike, day: string) => anniversaryItemsOn(a, day)[0];
const lunarBirthday = (date: string, isLeapMonth = false): BirthdayValue => ({ date, calendar: 'LUNAR', isLeapMonth });

describe('음력 기념일 항목 (#562)', () => {
  it('원래 날짜는 음력 연월일의 양력 (음력 2000-03-15 = 양력 2000-04-19)', () => {
    expect(anniversaryOrigin(lunar('2000-03-15', 'YEARLY'))).toBe('2000-04-19');
    expect(anniversaryOrigin({ date: '2000-03-15', kind: 'YEARLY' })).toBe('2000-03-15');
    expect(first(lunar('2000-03-15', 'YEARLY'), '2000-04-19')).toMatchObject({ type: 'ORIGINAL' });
    expect(anniversaryItemsOn(lunar('2000-03-15', 'YEARLY'), '2000-03-15')).toEqual([]);
  });

  it('YEARLY: 해마다 음력 3월 15일의 양력 (2026-05-01, 2027-04-21), 양력 같은 월일은 아님', () => {
    const a = lunar('2000-03-15', 'YEARLY');
    expect(first(a, '2026-05-01')).toMatchObject({ type: 'YEARLY', label: null });
    expect(first(a, '2027-04-21')).toMatchObject({ type: 'YEARLY' });
    expect(anniversaryItemsOn(a, '2026-03-15')).toEqual([]);
    expect(anniversaryYearDate(a, 26)).toBe('2026-05-01');
  });

  it('COUNT_UP: N일은 원래 날짜의 양력부터, N주년은 음력 해로 센다', () => {
    const a = lunar('2025-03-15', 'COUNT_UP');
    expect(anniversaryOrigin(a)).toBe('2025-04-12');
    expect(first(a, '2025-07-20')).toMatchObject({ type: 'DAYS', label: '100일' });
    expect(first(a, '2026-05-01')).toMatchObject({ type: 'YEARS', label: '1주년' });
    expect(anniversaryItemsOn(a, '2026-04-12')).toEqual([]);
  });

  it('음력 12월 기념일은 다음 양력 해 1월에 (음력 해로 센다)', () => {
    const a = lunar('2025-12-15', 'YEARLY');
    expect(anniversaryOrigin(a)).toBe('2026-02-02');
    expect(first(a, '2027-01-22')).toMatchObject({ type: 'YEARLY' });
    expect(anniversaryItemsOn(a, '2026-02-02').map((item) => item.type)).toEqual(['ORIGINAL']);
  });

  it('윤달은 그 윤달이 있는 해만 윤달, 없는 해는 평달 (윤6월 15일: 2025-08-08 → 2026-07-28)', () => {
    const a = lunar('2025-06-15', 'YEARLY', true);
    expect(anniversaryOrigin(a)).toBe('2025-08-08');
    expect(first(a, '2026-07-28')).toMatchObject({ type: 'YEARLY' });
    expect(first(a, '2028-08-05')).toMatchObject({ type: 'YEARLY' });
  });

  it('30일은 그 달이 29일인 해에 29일 (음력 1월 30일: 2026-03-18, 2027-03-07)', () => {
    const a = lunar('2026-01-30', 'YEARLY');
    expect(anniversaryOrigin(a)).toBe('2026-03-18');
    expect(first(a, '2027-03-07')).toMatchObject({ type: 'YEARLY' });
  });

  it('변환 범위(음력 2050년) 뒤는 항목이 없다', () => {
    expect(anniversaryItemsOn(lunar('2000-03-15', 'YEARLY'), '2051-04-20')).toEqual([]);
    expect(anniversaryOrigin(lunar('2051-01-01', 'YEARLY'))).toBeNull();
    expect(anniversaryItemsOn(lunar('2051-01-01', 'YEARLY'), '2051-02-11')).toEqual([]);
  });
});

describe('음력 생일 (#562)', () => {
  it('isBirthday: 음력은 1~30일 (2월 30일도 받는다), 양력은 그대로', () => {
    expect(isBirthday('02-30', 'LUNAR')).toBe(true);
    expect(isBirthday('04-31', 'LUNAR')).toBe(false);
    expect(isBirthday('02-30')).toBe(false);
  });

  it('해마다 음력 월일의 양력: 음력 12월 15일은 2026-02-02 와 2027-01-22', () => {
    expect(birthdayAnniversary(lunarBirthday('12-15'))).toEqual({ date: '2000-12-15', kind: 'YEARLY', calendar: 'LUNAR', isLeapMonth: false });
    expect(isBirthdayOn(lunarBirthday('12-15'), '2026-02-02')).toBe(true);
    expect(isBirthdayOn(lunarBirthday('12-15'), '2027-01-22')).toBe(true);
    expect(isBirthdayOn(lunarBirthday('12-15'), '2026-12-15')).toBe(false);
  });

  it('DB 칸 → 생일 값', () => {
    expect(birthdayOf({ birthday: '03-15', birthdayCalendar: 'LUNAR', birthdayLeapMonth: true })).toEqual(lunarBirthday('03-15', true));
    expect(birthdayOf({ birthday: null, birthdayCalendar: 'SOLAR', birthdayLeapMonth: false })).toBeNull();
  });
});

describe('음력 알림 예약은 그해 양력 날짜에 (#562)', () => {
  const row = (overrides: Partial<AnniversaryPlanRow> = {}): AnniversaryPlanRow => ({
    id: 5,
    groupId: 10,
    groupName: '우리',
    groupCode: 'teamcode',
    name: '할머니 제사',
    date: '2000-03-15',
    kind: 'YEARLY',
    calendar: 'LUNAR',
    isLeapMonth: false,
    remindDayOf: true,
    remindDayBefore: true,
    remindWeekBefore: false,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  it('당일 2026-05-01 09:00, 하루 전 4-30. 양력 3월 15일에는 보내지 않는다', () => {
    expect(planAnniversaries([row()], '2026-05-01').map((p) => [p.dedupeKey, p.payload.body])).toEqual([['A:5:2026-05-01', '오늘은 할머니 제사예요']]);
    expect(planAnniversaries([row()], '2026-04-30').map((p) => p.dedupeKey)).toEqual(['A:5:2026-05-01:D1']);
    expect(planAnniversaries([row()], '2026-03-15')).toEqual([]);
  });

  it('음력 생일 알림도 그해 양력 날짜에', () => {
    const birthday: BirthdayPlanRow = {
      userId: 7,
      groupId: 10,
      groupName: '우리',
      groupCode: 'teamcode',
      name: '민지',
      birthday: lunarBirthday('10-15'),
      remindDayOf: true,
      remindDayBefore: false,
      remindWeekBefore: false,
    };
    expect(planBirthdays([birthday], '2026-11-23').map((p) => p.dedupeKey)).toEqual(['B:7:10:2026-11-23']);
    expect(planBirthdays([birthday], '2026-10-15')).toEqual([]);
  });

  it('주간 요약의 이번 주 기념일도 음력을 양력으로 (2026-04-26 주 → 5월 1일)', () => {
    expect(weekAnniversary([{ ...row(), name: '할머니 제사' }], '2026-04-27')).toEqual({ date: '2026-05-01', title: '할머니 제사' });
  });
});

describe('구독 피드의 음력 기념일, 생일 (#562)', () => {
  const window = { firstDay: '2026-01-01', lastDay: '2027-12-31' };

  it('음력 기념일은 해마다 그해 양력 날짜에 종일 VEVENT', () => {
    const items = anniversaryEvents({ id: 3, name: '제사', date: '2000-03-15', kind: 'YEARLY', calendar: 'LUNAR', isLeapMonth: false, updatedAt: new Date('2026-01-01T00:00:00Z') }, window);
    expect(items.map((e) => [e.uid, e.start, e.summary])).toEqual([
      ['a3-20260501@whenwemeet.day', { allDay: true, date: '2026-05-01' }, '제사'],
      ['a3-20270421@whenwemeet.day', { allDay: true, date: '2027-04-21' }, '제사'],
    ]);
  });

  it('음력 생일: 같은 양력 해에 두 번 올 수도 있다 (음력 12월 15일)', () => {
    const items = birthdayEvents({ userId: 7, name: '민지', birthday: '12-15', birthdayCalendar: 'LUNAR', birthdayLeapMonth: false, updatedAt: new Date('2026-01-01T00:00:00Z') }, window);
    expect(items.map((e) => e.start)).toEqual([
      { allDay: true, date: '2026-02-02' },
      { allDay: true, date: '2027-01-22' },
    ]);
  });
});
