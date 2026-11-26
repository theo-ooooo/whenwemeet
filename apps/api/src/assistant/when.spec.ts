import {
  isPastThisWeekday,
  monthRange,
  NO_WHEN,
  resolvePeriod,
  resolveWhen,
  type ResolveOptions,
  type WhenArg,
  weekendRange,
  weekRange,
} from './when.js';

/** (#458) 날짜 표현 → KST 날짜 (D-276) */

const MON = '2026-11-16'; // 운영 재현 날 (월)
const SUN = '2026-11-15';
const SAT = '2026-11-21';

const w = (fields: Partial<WhenArg>): WhenArg => ({ ...NO_WHEN, ...fields });
const weekday = (
  day: WhenArg['weekday'],
  which: WhenArg['which'] = 'nearest',
) => w({ kind: 'weekday', weekday: day, which });
const at = (
  when: WhenArg,
  today: string,
  options: Partial<ResolveOptions> = {},
) => resolveWhen(when, { today, ...options });
const HHMM = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

describe('운영 재현 (2026-11-16 월)', () => {
  it('"다음 주 금요일" = 다음 주(11-22~28) 금요일 11-27, "이번 주 금요일" = 11-20', () => {
    expect(at(weekday('금', 'next'), MON)).toBe('2026-11-27');
    expect(at(weekday('금', 'this'), MON)).toBe('2026-11-20');
  });

  it('"11월 27일 금요일" = 11-27 (요일이 어긋나도 날짜를 믿는다)', () => {
    expect(
      at(w({ kind: 'monthDay', month: 11, day: 27, weekday: '금' }), MON),
    ).toBe('2026-11-27');
    expect(
      at(w({ kind: 'monthDay', month: 11, day: 26, weekday: '금' }), MON),
    ).toBe('2026-11-26');
    expect(
      at(w({ kind: 'date', date: '2026-11-27', weekday: '수' }), MON),
    ).toBe('2026-11-27');
  });
});

describe('요일', () => {
  it('요일만(nearest): 오늘 이후 가장 가까운 그 요일, which 가 없어도 nearest', () => {
    expect(at(weekday('금'), MON)).toBe('2026-11-20');
    expect(at(weekday('일'), MON)).toBe('2026-11-22');
    expect(at(w({ kind: 'weekday', weekday: '화' }), MON)).toBe('2026-11-17');
  });

  it('오늘이 그 요일이면 시작 시각이 지금(14:05)보다 늦을 때만 오늘, 아니면 다음 주. 시각이 없으면(기간, 종일) 오늘', () => {
    const now = HHMM('14:05');
    expect(
      at(weekday('월'), MON, { nowMinutes: now, startMinutes: HHMM('19:00') }),
    ).toBe('2026-11-16');
    expect(
      at(weekday('월'), MON, { nowMinutes: now, startMinutes: HHMM('09:00') }),
    ).toBe('2026-11-23');
    expect(
      at(weekday('월'), MON, { nowMinutes: now, startMinutes: HHMM('14:05') }),
    ).toBe('2026-11-23');
    expect(
      at(weekday('월'), MON, { nowMinutes: now, startMinutes: null }),
    ).toBe('2026-11-16');
    expect(at(weekday('월'), MON)).toBe('2026-11-16');
  });

  it('"다음 주 월요일" = 11-23, "다다음 주 금요일" = 12-04, "이번 주 일요일" = 11-15 (지난 날, 초안은 되묻는다)', () => {
    expect(at(weekday('월', 'next'), MON)).toBe('2026-11-23');
    expect(at(weekday('금', 'after_next'), MON)).toBe('2026-12-04');
    const sunday = weekday('일', 'this');
    expect(at(sunday, MON)).toBe('2026-11-15');
    expect(isPastThisWeekday(sunday, '2026-11-15', MON)).toBe(true);
    expect(isPastThisWeekday(weekday('금', 'this'), '2026-11-20', MON)).toBe(
      false,
    );
    expect(isPastThisWeekday(weekday('일'), '2026-11-15', MON)).toBe(false);
  });

  it('오늘이 일요일: 이번 주 = 오늘부터 토요일, 다음 주 = 11-22~28', () => {
    expect(at(weekday('금', 'this'), SUN)).toBe('2026-11-20');
    expect(at(weekday('금', 'next'), SUN)).toBe('2026-11-27');
    expect(at(weekday('일', 'this'), SUN)).toBe('2026-11-15');
    expect(isPastThisWeekday(weekday('일', 'this'), '2026-11-15', SUN)).toBe(
      false,
    );
    expect(at(weekday('일', 'next'), SUN)).toBe('2026-11-22');
    expect(at(weekday('일'), SUN)).toBe('2026-11-15');
    expect(at(weekday('월'), SUN)).toBe('2026-11-16');
  });

  it('오늘이 토요일: "이번 주 금요일" 은 어제(지난 날), "금요일" 은 다음 금요일, "다음 주 금요일" 은 11-27', () => {
    expect(at(weekday('금', 'this'), SAT)).toBe('2026-11-20');
    expect(isPastThisWeekday(weekday('금', 'this'), '2026-11-20', SAT)).toBe(
      true,
    );
    expect(at(weekday('금'), SAT)).toBe('2026-11-27');
    expect(at(weekday('금', 'next'), SAT)).toBe('2026-11-27');
    expect(at(weekday('토', 'this'), SAT)).toBe('2026-11-21');
    expect(at(weekday('일', 'this'), SAT)).toBe('2026-11-15');
  });

  it('달, 해 경계: 2026-12-30(수) 다음 주 금요일 = 2027-01-08, 이번 주 토요일 = 2027-01-02', () => {
    expect(at(weekday('금', 'next'), '2026-12-30')).toBe('2027-01-08');
    expect(at(weekday('토', 'this'), '2026-12-30')).toBe('2027-01-02');
    expect(at(weekday('월'), '2026-11-30')).toBe('2026-11-30');
    expect(at(weekday('화'), '2026-11-30')).toBe('2026-12-01');
  });
});

describe('주말, 주, 달', () => {
  it('주말: 월요일엔 11-21~22, 토요일엔 오늘~내일, 일요일엔 오늘 하루. 다음 주말은 7일 뒤', () => {
    expect(weekendRange(MON, 'nearest')).toEqual(['2026-11-21', '2026-11-22']);
    expect(weekendRange(MON, 'next')).toEqual(['2026-11-28', '2026-11-29']);
    expect(weekendRange(SAT, 'this')).toEqual(['2026-11-21', '2026-11-22']);
    expect(weekendRange(SAT, 'next')).toEqual(['2026-11-28', '2026-11-29']);
    expect(weekendRange(SUN, 'this')).toEqual(['2026-11-15', '2026-11-15']);
    expect(weekendRange(SUN, 'next')).toEqual(['2026-11-21', '2026-11-22']);
    // 하루 일정을 "주말" 로만 말하면 첫날(토요일, 일요일이면 오늘)
    expect(at(w({ kind: 'weekend', which: 'this' }), MON)).toBe('2026-11-21');
    expect(
      at(w({ kind: 'weekend', which: 'this' }), MON, { edge: 'end' }),
    ).toBe('2026-11-22');
    expect(at(w({ kind: 'weekend' }), SUN)).toBe('2026-11-15');
  });

  it('주(일요일 시작, D-261): 이번 주 11-15~21, 다음 주 11-22~28, 일요일엔 오늘부터', () => {
    expect(weekRange(MON, 'this')).toEqual(['2026-11-15', '2026-11-21']);
    expect(weekRange(MON, 'next')).toEqual(['2026-11-22', '2026-11-28']);
    expect(weekRange(SUN, 'this')).toEqual(['2026-11-15', '2026-11-21']);
    expect(weekRange(SAT, 'next')).toEqual(['2026-11-22', '2026-11-28']);
  });

  it('달: 이번 달, 다음 달(12월 → 1월), "12월", 지난 달 숫자는 내년', () => {
    expect(monthRange(MON, 'this', null)).toEqual(['2026-11-01', '2026-11-30']);
    expect(monthRange(MON, 'next', null)).toEqual(['2026-12-01', '2026-12-31']);
    expect(monthRange('2026-12-30', 'next', null)).toEqual([
      '2027-01-01',
      '2027-01-31',
    ]);
    expect(monthRange('2026-12-30', 'after_next', null)).toEqual([
      '2027-02-01',
      '2027-02-28',
    ]);
    expect(monthRange(MON, 'nearest', 12)).toEqual([
      '2026-12-01',
      '2026-12-31',
    ]);
    expect(monthRange(MON, 'nearest', 11)).toEqual([
      '2026-11-01',
      '2026-11-30',
    ]);
    expect(monthRange(MON, 'nearest', 2)).toEqual(['2027-02-01', '2027-02-28']);
    expect(monthRange(MON, 'nearest', 13)).toBeNull();
  });
});

describe('오늘/내일, 월일, 날짜', () => {
  it('relativeDays: 오늘 0, 내일 1, 모레 2, 글피 3, 어제 -1, 해 경계', () => {
    const rel = (days: number) => w({ kind: 'relativeDays', days });
    expect([0, 1, 2, 3, -1].map((days) => at(rel(days), MON))).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-15',
    ]);
    expect(at(rel(2), '2026-12-30')).toBe('2027-01-01');
    expect(at(rel(1000), MON)).toBeNull();
    expect(at(rel(1.5), MON)).toBeNull();
    expect(at(w({ kind: 'relativeDays' }), MON)).toBeNull();
  });

  it('월일: 31일보다 더 지난 날이면 내년, 최근 31일 안이면 올해. 해 경계 양쪽', () => {
    const md = (month: number | null, day: number) =>
      w({ kind: 'monthDay', month, day });
    expect(at(md(11, 10), MON)).toBe('2026-11-10');
    expect(at(md(1, 5), MON)).toBe('2027-01-05');
    expect(at(md(12, 25), '2026-12-30')).toBe('2026-12-25');
    expect(at(md(1, 3), '2026-12-30')).toBe('2027-01-03');
    expect(at(md(12, 30), '2027-01-02')).toBe('2026-12-30');
    expect(at(md(2, 29), MON)).toBe('2028-02-29');
    expect(at(md(2, 30), MON)).toBeNull();
    expect(at(md(13, 1), MON)).toBeNull();
  });

  it('월 없이 며칠: 오늘 이후 그 날이 있는 가장 가까운 달 (31일 → 12-31, 3일 → 다음 달)', () => {
    const day = (d: number) => w({ kind: 'monthDay', day: d });
    expect(at(day(20), MON)).toBe('2026-11-20');
    expect(at(day(16), MON)).toBe('2026-11-16');
    expect(at(day(3), MON)).toBe('2026-12-03');
    expect(at(day(31), MON)).toBe('2026-12-31');
    expect(at(day(3), '2026-12-30')).toBe('2027-01-03');
    expect(at(day(32), MON)).toBeNull();
  });

  it('date: 있는 날짜만, 말하지 않음(kind null)과 빠진 값은 null', () => {
    expect(at(w({ kind: 'date', date: '2027-03-01' }), MON)).toBe('2027-03-01');
    expect(at(w({ kind: 'date', date: '2026-02-30' }), MON)).toBeNull();
    expect(at(w({ kind: 'date' }), MON)).toBeNull();
    expect(at(NO_WHEN, MON)).toBeNull();
    expect(at(w({ kind: 'weekday' }), MON)).toBeNull();
    expect(at(w({ kind: 'monthDay', month: 11 }), MON)).toBeNull();
  });
});

describe('기간', () => {
  const period = (from: WhenArg, to: WhenArg = NO_WHEN, today = MON) =>
    resolvePeriod(from, to, today);

  it('from 하나로 정해지는 기간: 다음 주, 이번 주말, 이번 달, 12월, 하루', () => {
    expect(period(w({ kind: 'week', which: 'next' }))).toEqual({
      fromDate: '2026-11-22',
      toDate: '2026-11-28',
    });
    expect(period(w({ kind: 'weekend', which: 'this' }))).toEqual({
      fromDate: '2026-11-21',
      toDate: '2026-11-22',
    });
    expect(period(w({ kind: 'month', which: 'this' }))).toEqual({
      fromDate: '2026-11-01',
      toDate: '2026-11-30',
    });
    expect(period(w({ kind: 'month', month: 12 }))).toEqual({
      fromDate: '2026-12-01',
      toDate: '2026-12-31',
    });
    expect(period(w({ kind: 'relativeDays', days: 1 }))).toEqual({
      fromDate: '2026-11-17',
      toDate: '2026-11-17',
    });
    expect(period(weekday('금', 'next'))).toEqual({
      fromDate: '2026-11-27',
      toDate: '2026-11-27',
    });
  });

  it('from ~ to: 오늘부터 일주일, 11월 20일부터 30일, 다음 주말까지, 끝 요일과 끝 며칠은 시작 이후', () => {
    expect(
      period(
        w({ kind: 'relativeDays', days: 0 }),
        w({ kind: 'relativeDays', days: 6 }),
      ),
    ).toEqual({ fromDate: '2026-11-16', toDate: '2026-11-22' });
    expect(
      period(
        w({ kind: 'monthDay', month: 11, day: 20 }),
        w({ kind: 'monthDay', day: 30 }),
      ),
    ).toEqual({ fromDate: '2026-11-20', toDate: '2026-11-30' });
    expect(
      period(
        w({ kind: 'monthDay', month: 12, day: 28 }),
        w({ kind: 'monthDay', day: 3 }),
      ),
    ).toEqual({ fromDate: '2026-12-28', toDate: '2027-01-03' });
    expect(
      period(
        w({ kind: 'relativeDays', days: 0 }),
        w({ kind: 'weekend', which: 'next' }),
      ),
    ).toEqual({ fromDate: '2026-11-16', toDate: '2026-11-29' });
    // 수요일에 "월요일부터 금요일까지" → 다음 월~금
    expect(period(weekday('월'), weekday('금'), '2026-11-18')).toEqual({
      fromDate: '2026-11-23',
      toDate: '2026-11-27',
    });
  });

  it('시작이 없거나 풀 수 없으면 null', () => {
    expect(period(NO_WHEN)).toBeNull();
    expect(period(w({ kind: 'monthDay', month: 2, day: 30 }))).toBeNull();
    expect(
      period(w({ kind: 'relativeDays', days: 0 }), w({ kind: 'weekday' })),
    ).toBeNull();
  });
});

describe('(#562) 음력 월일 lunarMonthDay', () => {
  const lunar = (month: number | null, day: number | null) =>
    w({ kind: 'lunarMonthDay', month, day });

  it('"음력 10월 15일" (오늘 음력 10월 8일) = 올해 음력 → 2026-11-23', () => {
    expect(at(lunar(10, 15), MON)).toBe('2026-11-23');
  });

  it('"음력 3월 15일 제사" = 이미 지났으면 다음 음력 해 → 2027-04-21 (양력 3월 15일이 아님)', () => {
    expect(at(lunar(3, 15), MON)).toBe('2027-04-21');
  });

  it('기간 끝(notBefore) 이후로', () => {
    expect(at(lunar(10, 15), MON, { notBefore: '2026-12-01' })).toBe(
      '2027-11-12',
    );
  });

  it('월이나 일이 없거나 범위 밖이면 null', () => {
    expect(at(lunar(null, 15), MON)).toBeNull();
    expect(at(lunar(3, null), MON)).toBeNull();
    expect(at(lunar(13, 1), MON)).toBeNull();
    expect(at(lunar(3, 31), MON)).toBeNull();
  });
});
