import {
  isLunarDate,
  lunarOccurrence,
  lunarToSolar,
  solarToLunar,
} from './lunar.js';

describe('음력 변환 (#562, D-297)', () => {
  it('한국천문연구원 기준 명절: 2026 설날 양력 2월 17일, 추석 9월 25일', () => {
    expect(lunarToSolar({ year: 2026, month: 1, day: 1, leap: false })).toBe(
      '2026-02-17',
    );
    expect(lunarToSolar({ year: 2026, month: 8, day: 15, leap: false })).toBe(
      '2026-09-25',
    );
    expect(solarToLunar('2026-02-17')).toEqual({
      year: 2026,
      month: 1,
      day: 1,
      leap: false,
    });
    expect(solarToLunar('2026-11-26')).toEqual({
      year: 2026,
      month: 10,
      day: 18,
      leap: false,
    });
  });

  it('윤달: 2023 윤2월 1일 = 양력 3월 22일, 거꾸로도 윤달로 읽는다', () => {
    expect(lunarToSolar({ year: 2023, month: 2, day: 1, leap: true })).toBe(
      '2023-03-22',
    );
    expect(solarToLunar('2023-03-22')).toEqual({
      year: 2023,
      month: 2,
      day: 1,
      leap: true,
    });
    // 2024 에는 윤2월이 없다
    expect(
      lunarToSolar({ year: 2024, month: 2, day: 1, leap: true }),
    ).toBeNull();
    expect(isLunarDate({ year: 2025, month: 6, day: 15, leap: true })).toBe(
      true,
    );
  });

  it('없는 날짜와 범위 밖은 null', () => {
    // 2026 음력 2월은 29일까지
    expect(
      lunarToSolar({ year: 2026, month: 2, day: 30, leap: false }),
    ).toBeNull();
    expect(lunarToSolar({ year: 2050, month: 11, day: 18, leap: false })).toBe(
      '2050-12-31',
    );
    expect(
      lunarToSolar({ year: 2050, month: 12, day: 1, leap: false }),
    ).toBeNull();
    expect(solarToLunar('2051-01-01')).toBeNull();
    expect(solarToLunar('2026/01/01')).toBeNull();
  });

  describe('lunarOccurrence: 해마다 돌아오는 음력 월일', () => {
    it('음력 12월은 다음 양력 해 1월에 온다', () => {
      expect(lunarOccurrence(2026, 12, 15, false)).toBe('2027-01-22');
    });

    it('30일인데 그해 그 달이 29일이면 그 달 마지막 날 (29일)', () => {
      expect(lunarOccurrence(2026, 1, 30, false)).toBe('2026-03-18');
      expect(lunarOccurrence(2027, 1, 30, false)).toBe(
        lunarToSolar({ year: 2027, month: 1, day: 29, leap: false }),
      );
      expect(lunarOccurrence(2027, 1, 30, false)).toBe('2027-03-07');
    });

    it('윤달로 넣었는데 그해에 그 윤달이 없으면 평달, 있으면 윤달', () => {
      expect(lunarOccurrence(2025, 6, 15, true)).toBe('2025-08-08');
      expect(lunarOccurrence(2026, 6, 15, true)).toBe('2026-07-28');
      expect(lunarOccurrence(2026, 6, 15, true)).toBe(
        lunarOccurrence(2026, 6, 15, false),
      );
      // 윤6월은 29일까지라 윤6월 30일은 윤6월 29일
      expect(lunarOccurrence(2025, 6, 30, true)).toBe(
        lunarToSolar({ year: 2025, month: 6, day: 29, leap: true }),
      );
    });

    it('범위 밖 해는 null', () => {
      expect(lunarOccurrence(2051, 1, 1, false)).toBeNull();
      expect(lunarOccurrence(999, 1, 1, false)).toBeNull();
      expect(lunarOccurrence(2050, 12, 1, false)).toBeNull();
    });
  });
});
