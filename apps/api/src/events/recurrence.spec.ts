import {
  addDays,
  applyException,
  expand,
  ExceptionRule,
  fitsInPeriod,
  isOccurrenceDate,
  kstDate,
  kstMidnight,
  originalOccurrence,
  seriesCandidateWindow,
  SeriesRule,
  withinShiftLimit,
} from './recurrence.js';

/** KST 벽시계 → Date */
const kst = (value: string) => new Date(`${value}+09:00`);
const series = (overrides: Partial<SeriesRule> = {}): SeriesRule => ({
  startsAt: kst('2026-11-11T19:00:00'),
  endsAt: kst('2026-11-11T21:00:00'),
  allDay: false,
  repeat: 'WEEKLY',
  repeatUntil: null,
  ...overrides,
});
const dates = (list: { occurrence: string }[]) => list.map((o) => o.occurrence);
const times = (list: { startsAt: Date; endsAt: Date }[]) => list.map((o) => [o.startsAt.toISOString(), o.endsAt.toISOString()]);

describe('KST 날짜 도우미', () => {
  it('kstDate / kstMidnight / addDays', () => {
    expect(kstDate(new Date('2026-11-10T15:00:00.000Z'))).toBe('2026-11-11');
    expect(kstDate(new Date('2026-11-10T14:59:59.999Z'))).toBe('2026-11-10');
    expect(kstMidnight('2026-11-11').toISOString()).toBe('2026-11-10T15:00:00.000Z');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('expand: 기획 3-7 예시', () => {
  it('1. 2026-11-11(수) 19:00~21:00 매주, 계속 → 11-18, 11-25, 12-02 ... 모두 19:00~21:00', () => {
    const list = expand(series(), [], kst('2026-11-11T00:00:00'), kst('2026-12-10T00:00:00'));
    expect(dates(list)).toEqual(['2026-11-11', '2026-11-18', '2026-11-25', '2026-12-02', '2026-12-09']);
    expect(times(list)[3]).toEqual(['2026-12-02T10:00:00.000Z', '2026-12-02T12:00:00.000Z']);
    expect(list.every((o) => !o.exception && !o.allDay)).toBe(true);
  });

  it('2. 11-25 "이 일정만" 20:00 으로 → 11-25 만 20:00, 12-02 는 19:00', () => {
    const exceptions: ExceptionRule[] = [
      { occurrence: '2026-11-25', cancelled: false, startsAt: kst('2026-11-25T20:00:00'), endsAt: kst('2026-11-25T22:00:00') },
    ];
    const list = expand(series(), exceptions, kst('2026-11-20T00:00:00'), kst('2026-12-05T00:00:00'));
    expect(dates(list)).toEqual(['2026-11-25', '2026-12-02']);
    expect(list[0]).toMatchObject({ exception: true, startsAt: kst('2026-11-25T20:00:00') });
    expect(list[1]).toMatchObject({ exception: false, startsAt: kst('2026-12-02T19:00:00') });
  });

  it('3. 12-02 에서 "이후 모두" 삭제 (repeatUntil = 12-01) → 11-11, 11-18, 11-25 만 남는다', () => {
    const list = expand(series({ repeatUntil: '2026-12-01' }), [], kst('2026-11-01T00:00:00'), kst('2026-12-31T00:00:00'));
    expect(dates(list)).toEqual(['2026-11-11', '2026-11-18', '2026-11-25']);
  });

  it('4. 2026-11-11 격주 → 11-25, 12-09, 12-23', () => {
    const list = expand(series({ repeat: 'BIWEEKLY' }), [], kst('2026-11-12T00:00:00'), kst('2026-12-31T00:00:00'));
    expect(dates(list)).toEqual(['2026-11-25', '2026-12-09', '2026-12-23']);
  });

  it('5. 2026-01-31 매월 → 2-28, 3-31, 4-30, 5-31', () => {
    const rule = series({ startsAt: kst('2026-01-31T10:00:00'), endsAt: kst('2026-01-31T11:00:00'), repeat: 'MONTHLY' });
    const first = expand(rule, [], kst('2026-02-01T00:00:00'), kst('2026-04-01T00:00:00'));
    const second = expand(rule, [], kst('2026-04-01T00:00:00'), kst('2026-06-01T00:00:00'));
    expect(dates([...first, ...second])).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('6. 2024-02-29 매년 → 2025-02-28, 2026-02-28, 2028-02-29', () => {
    const rule = series({ startsAt: kst('2024-02-29T09:00:00'), endsAt: kst('2024-02-29T10:00:00'), repeat: 'YEARLY' });
    const at = (y: number) => dates(expand(rule, [], kst(`${y}-02-01T00:00:00`), kst(`${y}-03-15T00:00:00`)));
    expect(at(2025)).toEqual(['2025-02-28']);
    expect(at(2026)).toEqual(['2026-02-28']);
    expect(at(2027)).toEqual(['2027-02-28']);
    expect(at(2028)).toEqual(['2028-02-29']);
  });

  it('7. 2026-11-14(토) 종일 2일(토~일) 매주 → 11-21~22, 11-28~29', () => {
    const rule = series({ startsAt: kst('2026-11-14T00:00:00'), endsAt: kst('2026-11-16T00:00:00'), allDay: true });
    const list = expand(rule, [], kst('2026-11-17T00:00:00'), kst('2026-11-30T00:00:00'));
    expect(dates(list)).toEqual(['2026-11-21', '2026-11-28']);
    expect(list[0]).toMatchObject({ allDay: true, startsAt: kst('2026-11-21T00:00:00'), endsAt: kst('2026-11-23T00:00:00') });
    expect(list[1]).toMatchObject({ startsAt: kst('2026-11-28T00:00:00'), endsAt: kst('2026-11-30T00:00:00') });
  });

  it('8. 매주인데 8일짜리 → 주기보다 길어 거부 대상', () => {
    expect(fitsInPeriod('WEEKLY', kst('2026-11-11T00:00:00'), kst('2026-11-19T00:00:00'))).toBe(false);
  });

  it('9. 2026-11-11 매주, 종료 2026-11-25 → 11-11, 11-18, 11-25 (종료일 포함)', () => {
    const list = expand(series({ repeatUntil: '2026-11-25' }), [], kst('2026-11-01T00:00:00'), kst('2026-12-31T00:00:00'));
    expect(dates(list)).toEqual(['2026-11-11', '2026-11-18', '2026-11-25']);
  });
});

describe('expand: 설계 3-1 추가 예시', () => {
  const moved: ExceptionRule[] = [
    { occurrence: '2026-11-18', cancelled: false, startsAt: kst('2026-11-20T19:00:00'), endsAt: kst('2026-11-20T21:00:00') },
  ];

  it('11-18 회차를 11-20 으로 옮기고 11-19~11-21 조회 → 11-20 회차 하나 (occurrence 11-18)', () => {
    const list = expand(series(), moved, kst('2026-11-19T00:00:00'), kst('2026-11-22T00:00:00'));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ occurrence: '2026-11-18', startsAt: kst('2026-11-20T19:00:00'), exception: true });
  });

  it('같은 예외로 11-17~11-19 조회 → 11-18 회차 없음', () => {
    expect(expand(series(), moved, kst('2026-11-17T00:00:00'), kst('2026-11-20T00:00:00'))).toEqual([]);
  });

  it('2026-10-31 매월, 2027-02-01~02-28 조회 → 2027-02-28', () => {
    const rule = series({ startsAt: kst('2026-10-31T19:00:00'), endsAt: kst('2026-10-31T20:00:00'), repeat: 'MONTHLY' });
    expect(dates(expand(rule, [], kst('2027-02-01T00:00:00'), kst('2027-03-01T00:00:00')))).toEqual(['2027-02-28']);
  });

  it('종일 2026-11-14 매주, 11-21 하루 조회 → 11-21 00:00 ~ 11-22 00:00 KST', () => {
    const rule = series({ startsAt: kst('2026-11-14T00:00:00'), endsAt: kst('2026-11-15T00:00:00'), allDay: true });
    const list = expand(rule, [], kst('2026-11-21T00:00:00'), kst('2026-11-22T00:00:00'));
    expect(times(list)).toEqual([[kst('2026-11-21T00:00:00').toISOString(), kst('2026-11-22T00:00:00').toISOString()]]);
  });

  it('매주, repeatUntil 2026-11-24, 11-25 이후 조회 → 없음', () => {
    expect(expand(series({ repeatUntil: '2026-11-24' }), [], kst('2026-11-25T00:00:00'), kst('2027-01-25T00:00:00'))).toEqual([]);
  });
});

describe('expand: 경계', () => {
  it('첫 회차 이전 기간은 비어 있다', () => {
    expect(expand(series(), [], kst('2026-10-01T00:00:00'), kst('2026-11-11T00:00:00'))).toEqual([]);
  });

  it('겹침은 반열린 구간: 끝 == from, 시작 == to 는 빠진다', () => {
    expect(expand(series(), [], kst('2026-11-18T21:00:00'), kst('2026-11-25T19:00:00'))).toEqual([]);
    expect(dates(expand(series(), [], kst('2026-11-18T20:59:00'), kst('2026-11-25T19:01:00')))).toEqual(['2026-11-18', '2026-11-25']);
  });

  it('자정을 넘는 일정은 앞날 회차가 다음 날 조회에도 걸린다', () => {
    const rule = series({ startsAt: kst('2026-11-11T23:00:00'), endsAt: kst('2026-11-12T01:00:00') });
    const list = expand(rule, [], kst('2026-11-19T00:00:00'), kst('2026-11-20T00:00:00'));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ occurrence: '2026-11-18', startsAt: kst('2026-11-18T23:00:00') });
  });

  it('KST 새벽(UTC 전날) 시각도 KST 날짜 기준으로 펼친다', () => {
    const rule = series({ startsAt: kst('2026-11-11T07:00:00'), endsAt: kst('2026-11-11T08:00:00') });
    const list = expand(rule, [], kst('2026-11-18T00:00:00'), kst('2026-11-19T00:00:00'));
    expect(list.map((o) => o.startsAt.toISOString())).toEqual(['2026-11-17T22:00:00.000Z']);
    expect(dates(list)).toEqual(['2026-11-18']);
  });

  it('취소된 회차는 빠지고, 제목/메모 예외는 실린다 (메모 지움은 빈 문자열)', () => {
    const exceptions: ExceptionRule[] = [
      { occurrence: '2026-11-18', cancelled: true },
      { occurrence: '2026-11-25', cancelled: false, title: '바뀐 제목', memo: '' },
    ];
    const list = expand(series(), exceptions, kst('2026-11-15T00:00:00'), kst('2026-11-30T00:00:00'));
    expect(dates(list)).toEqual(['2026-11-25']);
    expect(list[0]).toMatchObject({ title: '바뀐 제목', memo: '', startsAt: kst('2026-11-25T19:00:00'), exception: true });
  });

  it('규칙에 없는 날짜의 예외는 무시한다', () => {
    const list = expand(series(), [{ occurrence: '2026-11-19', cancelled: true }], kst('2026-11-15T00:00:00'), kst('2026-11-30T00:00:00'));
    expect(dates(list)).toEqual(['2026-11-18', '2026-11-25']);
  });

  it('31일 앞에서 옮겨 온 회차도 찾는다 (창 [from - 31일, to + 31일))', () => {
    // 10-28 회차를 30일 뒤 11-27 로 옮김
    const rule = series({ startsAt: kst('2026-10-14T19:00:00'), endsAt: kst('2026-10-14T21:00:00') });
    const exceptions: ExceptionRule[] = [
      { occurrence: '2026-10-28', cancelled: false, startsAt: kst('2026-11-27T10:00:00'), endsAt: kst('2026-11-27T11:00:00') },
    ];
    const list = expand(rule, exceptions, kst('2026-11-27T00:00:00'), kst('2026-11-28T00:00:00'));
    expect(list).toMatchObject([{ occurrence: '2026-10-28', startsAt: kst('2026-11-27T10:00:00') }]);
    // 30일 앞으로 옮긴 회차
    const back: ExceptionRule[] = [
      { occurrence: '2026-12-30', cancelled: false, startsAt: kst('2026-11-30T10:00:00'), endsAt: kst('2026-11-30T11:00:00') },
    ];
    expect(dates(expand(rule, back, kst('2026-11-30T00:00:00'), kst('2026-12-01T00:00:00')))).toEqual(['2026-12-30']);
  });

  it('결과는 최종 시작 시각 오름차순 (옮긴 회차가 앞 회차보다 먼저일 수 있다)', () => {
    const exceptions: ExceptionRule[] = [
      { occurrence: '2026-11-25', cancelled: false, startsAt: kst('2026-11-17T09:00:00'), endsAt: kst('2026-11-17T10:00:00') },
    ];
    const list = expand(series(), exceptions, kst('2026-11-15T00:00:00'), kst('2026-11-30T00:00:00'));
    expect(dates(list)).toEqual(['2026-11-25', '2026-11-18']);
  });

  it('오래된 원본도 조회 창만큼만 계산한다 (회차 수 상한: 62일 조회에 매주 최대 10개)', () => {
    const rule = series({ startsAt: kst('2000-01-05T19:00:00'), endsAt: kst('2000-01-05T21:00:00') });
    const list = expand(rule, [], kst('2026-11-01T00:00:00'), kst('2027-01-02T00:00:00'));
    expect(list.length).toBe(9);
    expect(list.every((o) => new Date(o.occurrence).getUTCDay() === 3)).toBe(true);
  });

  it('매월 31일 기준은 2월에 28일로 가도 3월에 다시 31일 (윤년 2월은 29일)', () => {
    const rule = series({ startsAt: kst('2027-12-31T19:00:00'), endsAt: kst('2027-12-31T20:00:00'), repeat: 'MONTHLY' });
    expect(dates(expand(rule, [], kst('2028-02-01T00:00:00'), kst('2028-04-01T00:00:00')))).toEqual(['2028-02-29', '2028-03-31']);
  });

  it('매년 연말 회차는 해를 넘는 조회에서도 찾는다', () => {
    const rule = series({ startsAt: kst('2026-12-31T19:00:00'), endsAt: kst('2027-01-01T01:00:00'), repeat: 'YEARLY' });
    expect(dates(expand(rule, [], kst('2028-01-01T00:00:00'), kst('2028-01-02T00:00:00')))).toEqual(['2027-12-31']);
  });
});

describe('회차 날짜 판정, 원래 시각, 예외 적용', () => {
  it('isOccurrenceDate: 주기, 시작 이전, repeatUntil 이후', () => {
    expect(isOccurrenceDate(series(), '2026-11-11')).toBe(true);
    expect(isOccurrenceDate(series(), '2026-11-18')).toBe(true);
    expect(isOccurrenceDate(series(), '2026-11-19')).toBe(false);
    expect(isOccurrenceDate(series(), '2026-11-04')).toBe(false);
    expect(isOccurrenceDate(series({ repeatUntil: '2026-11-24' }), '2026-11-25')).toBe(false);
    expect(isOccurrenceDate(series({ repeat: 'BIWEEKLY' }), '2026-11-18')).toBe(false);
    expect(isOccurrenceDate(series({ repeat: 'BIWEEKLY' }), '2026-11-25')).toBe(true);
    const monthly = series({ startsAt: kst('2026-01-31T10:00:00'), endsAt: kst('2026-01-31T11:00:00'), repeat: 'MONTHLY' });
    expect(isOccurrenceDate(monthly, '2026-02-28')).toBe(true);
    expect(isOccurrenceDate(monthly, '2026-02-27')).toBe(false);
    expect(isOccurrenceDate(monthly, '2026-03-31')).toBe(true);
    expect(isOccurrenceDate(monthly, '2026-03-30')).toBe(false);
    const yearly = series({ startsAt: kst('2024-02-29T10:00:00'), endsAt: kst('2024-02-29T11:00:00'), repeat: 'YEARLY' });
    expect(isOccurrenceDate(yearly, '2025-02-28')).toBe(true);
    expect(isOccurrenceDate(yearly, '2028-02-29')).toBe(true);
    expect(isOccurrenceDate(yearly, '2028-02-28')).toBe(false);
    expect(isOccurrenceDate(yearly, '2025-03-01')).toBe(false);
  });

  it('originalOccurrence: 그 날짜 + 원본 벽시계 시각, 길이 유지', () => {
    expect(originalOccurrence(series(), '2026-12-02')).toEqual({
      occurrence: '2026-12-02',
      startsAt: kst('2026-12-02T19:00:00'),
      endsAt: kst('2026-12-02T21:00:00'),
      allDay: false,
      exception: false,
    });
  });

  it('applyException: 없으면 원래 값, cancelled 면 null, null 필드는 원래 값', () => {
    const original = originalOccurrence(series(), '2026-11-18');
    expect(applyException(original, undefined)).toBe(original);
    expect(applyException(original, { occurrence: '2026-11-18', cancelled: true })).toBeNull();
    expect(applyException(original, { occurrence: '2026-11-18', cancelled: false, title: null, allDay: true })).toEqual({ ...original, allDay: true, exception: true });
  });
});

describe('검증 도우미', () => {
  it('fitsInPeriod: 길이 < 주기 (매주 7일, 격주 14일, 매월 28일, 매년 365일)', () => {
    const start = kst('2026-11-11T00:00:00');
    const after = (days: number, ms = 0) => new Date(start.getTime() + days * 86_400_000 + ms);
    expect(fitsInPeriod('WEEKLY', start, after(7, -1))).toBe(true);
    expect(fitsInPeriod('WEEKLY', start, after(7))).toBe(false);
    expect(fitsInPeriod('BIWEEKLY', start, after(13))).toBe(true);
    expect(fitsInPeriod('BIWEEKLY', start, after(14))).toBe(false);
    expect(fitsInPeriod('MONTHLY', start, after(27))).toBe(true);
    expect(fitsInPeriod('MONTHLY', start, after(28))).toBe(false);
    expect(fitsInPeriod('YEARLY', start, after(30))).toBe(true);
  });

  it('withinShiftLimit: 시작 >= 원래 날짜 00:00 - 30일, 끝 <= 다음 날 00:00 + 30일', () => {
    expect(withinShiftLimit('2026-11-18', kst('2026-10-19T00:00:00'), kst('2026-10-19T01:00:00'))).toBe(true);
    expect(withinShiftLimit('2026-11-18', kst('2026-10-18T23:59:00'), kst('2026-10-19T01:00:00'))).toBe(false);
    expect(withinShiftLimit('2026-11-18', kst('2026-12-18T22:00:00'), kst('2026-12-19T00:00:00'))).toBe(true);
    expect(withinShiftLimit('2026-11-18', kst('2026-12-18T22:00:00'), kst('2026-12-19T00:01:00'))).toBe(false);
  });

  it('seriesCandidateWindow: 첫 회차 시작 < to + 31일, repeatUntil >= (from - 31일) 의 KST 날짜', () => {
    const window = seriesCandidateWindow(kst('2026-12-01T00:00:00'), kst('2026-12-02T00:00:00'));
    expect(window.startsBefore).toEqual(kst('2027-01-02T00:00:00'));
    expect(window.untilOnOrAfter).toBe('2026-10-31');
  });
});
