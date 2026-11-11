import { remindAt, reminderFits } from './remind-at.js';

const kst = (value: string) => new Date(`${value}+09:00`);

describe('remindAt (설계 4-1 표)', () => {
  const start = kst('2026-11-12T18:00:00');

  it.each([
    ['NONE', false, null],
    ['AT_START', false, kst('2026-11-12T18:00:00')],
    ['MIN_10', false, kst('2026-11-12T17:50:00')],
    ['HOUR_1', false, kst('2026-11-12T17:00:00')],
    ['DAY_1', false, kst('2026-11-11T18:00:00')],
  ] as const)('시간 일정 %s → %s', (reminder, allDay, expected) => {
    expect(remindAt(start, allDay, reminder)).toEqual(expected);
  });

  it('종일: 당일 오전 9시 = s + 9시간, 전날 오전 9시 = s - 15시간', () => {
    const day = kst('2026-11-12T00:00:00');
    expect(remindAt(day, true, 'DAY_OF_0900')).toEqual(kst('2026-11-12T09:00:00'));
    expect(remindAt(day, true, 'DAY_BEFORE_0900')).toEqual(kst('2026-11-11T09:00:00'));
    expect(remindAt(day, true, 'NONE')).toBeNull();
  });

  it('종일 startsAt 이 KST 자정이 아니어도 그 KST 날짜 규칙', () => {
    expect(remindAt(kst('2026-11-12T13:30:00'), true, 'DAY_OF_0900')).toEqual(kst('2026-11-12T09:00:00'));
    expect(remindAt(kst('2026-11-12T23:59:00'), true, 'DAY_BEFORE_0900')).toEqual(kst('2026-11-11T09:00:00'));
  });

  it('1일 전이 날짜(월, 해)를 넘는다', () => {
    expect(remindAt(kst('2027-01-01T00:30:00'), false, 'DAY_1')).toEqual(kst('2026-12-31T00:30:00'));
    expect(remindAt(kst('2027-01-01T00:00:00'), true, 'DAY_BEFORE_0900')).toEqual(kst('2026-12-31T09:00:00'));
  });

  it('종일 여부와 안 맞는 값은 null, reminderFits 는 false', () => {
    expect(remindAt(start, false, 'DAY_OF_0900')).toBeNull();
    expect(remindAt(start, true, 'HOUR_1')).toBeNull();
    expect(reminderFits(false, 'DAY_BEFORE_0900')).toBe(false);
    expect(reminderFits(true, 'AT_START')).toBe(false);
    expect(reminderFits(true, 'NONE')).toBe(true);
    expect(reminderFits(false, 'NONE')).toBe(true);
  });
});
