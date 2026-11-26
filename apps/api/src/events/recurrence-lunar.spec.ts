import { anchorMatchesStart, expand, fitsInPeriod, isOccurrenceDate, type SeriesRule } from './recurrence.js';

/** (#562, D-297) 매년(음력) 반복: 해마다 기준 날짜의 음력 월일을 양력으로 */
const kst = (value: string) => new Date(`${value}+09:00`);
const lunarSeries = (start: string, end: string, overrides: Partial<SeriesRule> = {}): SeriesRule => ({
  startsAt: kst(start),
  endsAt: kst(end),
  allDay: false,
  repeat: 'YEARLY_LUNAR',
  repeatUntil: null,
  ...overrides,
});
const dates = (list: { occurrence: string }[]) => list.map((o) => o.occurrence);

describe('expand YEARLY_LUNAR (#562)', () => {
  it('추석 저녁(음력 8월 15일) 19:00 → 2027-09-15, 2028-10-03 같은 시각', () => {
    const s = lunarSeries('2026-09-25T19:00:00', '2026-09-25T21:00:00');
    const list = expand(s, [], kst('2027-01-01T00:00:00'), kst('2029-01-01T00:00:00'));
    expect(dates(list)).toEqual(['2027-09-15', '2028-10-03']);
    expect(list[0].startsAt.toISOString()).toBe(kst('2027-09-15T19:00:00').toISOString());
    expect(list[0].endsAt.toISOString()).toBe(kst('2027-09-15T21:00:00').toISOString());
  });

  it('종일 제사(음력 3월 15일, 2026-05-01) → 2027-04-21 하루', () => {
    const s = lunarSeries('2026-05-01T00:00:00', '2026-05-02T00:00:00', { allDay: true });
    const list = expand(s, [], kst('2027-04-01T00:00:00'), kst('2027-06-01T00:00:00'));
    expect(dates(list)).toEqual(['2027-04-21']);
    expect(list[0].allDay).toBe(true);
    // 양력 같은 날(5월 1일)은 회차가 아니다
    expect(isOccurrenceDate(s, '2027-05-01')).toBe(false);
    expect(isOccurrenceDate(s, '2027-04-21')).toBe(true);
  });

  it('음력 12월 회차는 다음 양력 해 1월 (음력 2025-12-15 = 2026-02-02 → 2027-01-22)', () => {
    const s = lunarSeries('2026-02-02T10:00:00', '2026-02-02T11:00:00');
    expect(dates(expand(s, [], kst('2026-12-01T00:00:00'), kst('2027-03-01T00:00:00')))).toEqual(['2027-01-22']);
  });

  it('윤달 기준(2025 윤6월 15일)은 윤6월이 없는 해에 평달 6월 15일', () => {
    const s = lunarSeries('2025-08-08T12:00:00', '2025-08-08T13:00:00');
    expect(dates(expand(s, [], kst('2026-01-01T00:00:00'), kst('2027-01-01T00:00:00')))).toEqual(['2026-07-28']);
  });

  it('30일 기준은 그 달이 29일인 해에 29일, 기준 날짜(repeatAnchor)를 이어 30일이 있는 해엔 다시 30일', () => {
    // 음력 2026-01-30 (양력 3-18). 2027 음력 1월은 29일까지 → 3-07
    const s = lunarSeries('2026-03-18T09:00:00', '2026-03-18T10:00:00');
    expect(dates(expand(s, [], kst('2027-01-01T00:00:00'), kst('2027-12-31T00:00:00')))).toEqual(['2027-03-07']);
    // "이후 모두" 로 2027 회차에서 새 원본을 만들면 기준 날짜(2026-03-18)를 잇는다. 2029 음력 1월은 30일까지 → 3-14
    expect(anchorMatchesStart('YEARLY_LUNAR', kst('2027-03-07T09:00:00'), '2026-03-18')).toBe(true);
    const split = lunarSeries('2027-03-07T09:00:00', '2027-03-07T10:00:00', { repeatAnchor: '2026-03-18' });
    expect(dates(expand(split, [], kst('2028-01-01T00:00:00'), kst('2030-01-01T00:00:00')))).toEqual(['2028-02-24', '2029-03-14']);
    // 기준과 맞지 않는 시작
    expect(anchorMatchesStart('YEARLY_LUNAR', kst('2027-03-08T09:00:00'), '2026-03-18')).toBe(false);
  });

  it('repeatUntil 과 "이 일정만" 예외는 다른 주기와 같다', () => {
    const s = lunarSeries('2026-09-25T19:00:00', '2026-09-25T21:00:00', { repeatUntil: '2027-12-31' });
    expect(dates(expand(s, [], kst('2026-09-01T00:00:00'), kst('2029-01-01T00:00:00')))).toEqual(['2026-09-25', '2027-09-15']);
    const moved = expand(s, [{ occurrence: '2027-09-15', cancelled: false, startsAt: kst('2027-09-16T19:00:00'), endsAt: kst('2027-09-16T21:00:00') }], kst('2027-09-16T00:00:00'), kst('2027-09-17T00:00:00'));
    expect(moved.map((o) => [o.occurrence, o.exception])).toEqual([['2027-09-15', true]]);
  });

  it('변환 범위(음력 2050년) 뒤는 회차가 없다 (오류 없이)', () => {
    const s = lunarSeries('2050-01-01T09:00:00', '2050-01-01T10:00:00');
    expect(expand(s, [], kst('2050-12-01T00:00:00'), kst('2051-02-01T00:00:00'))).toEqual([]);
    expect(isOccurrenceDate(s, '2051-01-01')).toBe(false);
  });

  it('일정 길이는 300일보다 짧아야 한다 (일정 길이 상한 30일이 먼저 막는다)', () => {
    expect(fitsInPeriod('YEARLY_LUNAR', kst('2026-01-01T00:00:00'), kst('2026-01-31T00:00:00'))).toBe(true);
    expect(fitsInPeriod('YEARLY_LUNAR', kst('2026-01-01T00:00:00'), kst('2026-11-01T00:00:00'))).toBe(false);
  });
});
