import {
  anniversaryItemsOn,
  type AnniversaryKind,
} from './anniversary-items.js';
import {
  anniversaryDayInWindow,
  itemsForOffset,
  planAnniversaries,
} from './anniversary-planner.js';
import type { AnniversaryPlanRow } from './push-planning.repository.js';

/** 그날의 첫 항목 라벨 (없으면 undefined, 이름만이면 null) */
const first = (date: string, kind: AnniversaryKind, day: string) =>
  anniversaryItemsOn({ date, kind }, day)[0];

describe('anniversaryItemsOn (기념일-자동표시.md 3-5 예시표를 그날 단위로)', () => {
  it('2025-01-01 COUNT_UP: 100일, 200일, 300일, 1주년, 1000일, 2000일, 700일', () => {
    expect(first('2025-01-01', 'COUNT_UP', '2025-04-10')).toMatchObject({
      type: 'DAYS',
      label: '100일',
    });
    expect(first('2025-01-01', 'COUNT_UP', '2025-07-19')).toMatchObject({
      label: '200일',
    });
    expect(first('2025-01-01', 'COUNT_UP', '2025-10-27')).toMatchObject({
      label: '300일',
    });
    expect(first('2025-01-01', 'COUNT_UP', '2026-01-01')).toMatchObject({
      type: 'YEARS',
      label: '1주년',
    });
    expect(first('2025-01-01', 'COUNT_UP', '2027-09-27')).toMatchObject({
      label: '1000일',
    });
    expect(first('2025-01-01', 'COUNT_UP', '2030-06-23')).toMatchObject({
      label: '2000일',
    });
    expect(first('2025-01-01', 'COUNT_UP', '2026-12-01')).toMatchObject({
      label: '700일',
    });
    expect(first('2025-01-01', 'COUNT_UP', '2027-01-01')).toMatchObject({
      label: '2주년',
    });
    // 단위가 아닌 날은 없음 (2026-11-10 = 679일)
    expect(
      anniversaryItemsOn(
        { date: '2025-01-01', kind: 'COUNT_UP' },
        '2026-11-10',
      ),
    ).toEqual([]);
  });

  it('2026-08-03 COUNT_UP → 2026-11-10 "100일"', () => {
    expect(first('2026-08-03', 'COUNT_UP', '2026-11-10')).toMatchObject({
      type: 'DAYS',
      n: 100,
      label: '100일',
    });
  });

  it('등록한 날짜 당일은 이름만 (ORIGINAL), 미래 COUNT_UP 의 100일도 그날 나온다', () => {
    expect(first('2026-12-24', 'COUNT_UP', '2026-12-24')).toMatchObject({
      type: 'ORIGINAL',
      label: null,
    });
    expect(first('2026-12-24', 'COUNT_UP', '2027-04-02')).toMatchObject({
      label: '100일',
    });
  });

  it('2024-02-29 COUNT_UP: 100일 2024-06-07, 1주년 2025-02-28 (평년), 4주년 2028-02-29 (윤년)', () => {
    expect(first('2024-02-29', 'COUNT_UP', '2024-06-07')).toMatchObject({
      label: '100일',
    });
    expect(first('2024-02-29', 'COUNT_UP', '2025-02-28')).toMatchObject({
      label: '1주년',
    });
    expect(first('2024-02-29', 'COUNT_UP', '2028-02-29')).toMatchObject({
      label: '4주년',
    });
    expect(
      anniversaryItemsOn(
        { date: '2024-02-29', kind: 'COUNT_UP' },
        '2028-02-28',
      ),
    ).toEqual([]);
  });

  it('1996-02-29 YEARLY: 2026-02-28, 2027-02-28, 2028-02-29', () => {
    for (const day of ['2026-02-28', '2027-02-28', '2028-02-29']) {
      expect(first('1996-02-29', 'YEARLY', day)).toMatchObject({
        type: 'YEARLY',
        label: null,
      });
    }
    expect(
      anniversaryItemsOn({ date: '1996-02-29', kind: 'YEARLY' }, '2028-02-28'),
    ).toEqual([]);
  });

  it('2000-05-05 YEARLY: 매년 5월 5일, 100일 단위 없음', () => {
    expect(first('2000-05-05', 'YEARLY', '2027-05-05')).toMatchObject({
      type: 'YEARLY',
    });
    expect(
      anniversaryItemsOn({ date: '2000-05-05', kind: 'YEARLY' }, '2000-08-12'),
    ).toEqual([]);
  });

  it('2026-11-20 ONCE: 그날 하나, 다음 해는 없음', () => {
    expect(first('2026-11-20', 'ONCE', '2026-11-20')).toMatchObject({
      type: 'ORIGINAL',
    });
    expect(
      anniversaryItemsOn({ date: '2026-11-20', kind: 'ONCE' }, '2027-11-20'),
    ).toEqual([]);
  });

  it('주년은 100주년까지, 등록 당일은 이름만 하나', () => {
    expect(
      anniversaryItemsOn(
        { date: '2024-01-01', kind: 'COUNT_UP' },
        '2024-01-01',
      ).map((item) => item.type),
    ).toEqual(['ORIGINAL']);
    expect(first('1900-01-01', 'COUNT_UP', '2000-01-01')).toMatchObject({
      label: '100주년',
    });
    expect(
      anniversaryItemsOn(
        { date: '1900-01-01', kind: 'COUNT_UP' },
        '2001-01-01',
      ),
    ).toEqual([]);
  });
});

describe('기념일 예약 (설계 5-5)', () => {
  it('창 (lo, hi] 안의 KST 09:00 (= 그날 00:00 UTC) 만', () => {
    expect(
      anniversaryDayInWindow(
        new Date('2026-11-09T23:55:00Z'),
        new Date('2026-11-10T00:00:00Z'),
      ),
    ).toBe('2026-11-10');
    expect(
      anniversaryDayInWindow(
        new Date('2026-11-10T00:00:00Z'),
        new Date('2026-11-10T00:05:00Z'),
      ),
    ).toBeNull();
    expect(
      anniversaryDayInWindow(
        new Date('2026-11-10T00:01:00Z'),
        new Date('2026-11-10T00:09:00Z'),
      ),
    ).toBeNull();
  });

  const row = (
    overrides: Partial<AnniversaryPlanRow> = {},
  ): AnniversaryPlanRow => ({
    id: 5,
    groupId: 10,
    groupName: '우리',
    groupCode: 'teamcode',
    name: '처음 만난 날',
    date: '2026-08-03',
    kind: 'COUNT_UP',
    calendar: 'SOLAR',
    isLeapMonth: false,
    remindDayOf: true,
    remindDayBefore: false,
    remindWeekBefore: false,
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  });

  it('그날 항목이 있으면 기념일 하나에 1건, 키 A:{id}:{날짜}, 09:00 KST', () => {
    const [planned, ...rest] = planAnniversaries(
      [row(), row({ id: 6, date: '2026-01-01' })],
      '2026-11-10',
    );
    expect(rest).toEqual([]);
    expect(planned).toMatchObject({
      kind: 'ANNIVERSARY',
      dedupeKey: 'A:5:2026-11-10',
      scheduledAt: new Date('2026-11-10T00:00:00Z'),
      anniversaryId: 5,
      payload: {
        title: '처음 만난 날 100일',
        body: '오늘은 처음 만난 날 100일이에요',
        subtitle: '우리',
        url: '/anniversaries?team=teamcode',
      },
    });
  });

  it('그날 09:00 뒤에 등록, 수정한 기념일은 건너뛴다', () => {
    expect(
      planAnniversaries(
        [row({ updatedAt: new Date('2026-11-10T00:00:01Z') })],
        '2026-11-10',
      ),
    ).toEqual([]);
    expect(
      planAnniversaries(
        [row({ updatedAt: new Date('2026-11-10T00:00:00Z') })],
        '2026-11-10',
      ),
    ).toHaveLength(1);
  });
});

describe('기념일 알림 시점 (#269, 설계 5-5, D-144 ~ D-147)', () => {
  const ALL = {
    remindDayOf: true,
    remindDayBefore: true,
    remindWeekBefore: true,
  };
  const row = (
    overrides: Partial<AnniversaryPlanRow> = {},
  ): AnniversaryPlanRow => ({
    id: 7,
    groupId: 10,
    groupName: '우리',
    groupCode: 'teamcode',
    name: '처음 만난 날',
    date: '2026-08-03',
    kind: 'COUNT_UP',
    calendar: 'SOLAR',
    isLeapMonth: false,
    remindDayOf: true,
    remindDayBefore: false,
    remindWeekBefore: false,
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  });
  const plan = (r: AnniversaryPlanRow, day: string) =>
    planAnniversaries([r], day).map((p) => ({
      key: p.dedupeKey,
      at: p.scheduledAt.toISOString(),
      body: p.payload.body,
    }));

  // 2026-08-03 COUNT_UP: 100일 = 2026-11-10. 2026-08-03 은 ORIGINAL, 2027-08-03 은 1주년
  // 2000-05-05 YEARLY: 매년 05-05. 2026-12-24 ONCE: 그날만
  it.each([
    // [항목, 기념일, 그날, 시점, 보내는 날, 문구 | null(안 보냄)]
    [
      'DAYS 당일',
      row(),
      '2026-11-10',
      'remindDayOf',
      '2026-11-10',
      '오늘은 처음 만난 날 100일이에요',
    ],
    [
      'DAYS 하루 전',
      row(),
      '2026-11-10',
      'remindDayBefore',
      '2026-11-09',
      '내일은 처음 만난 날 100일이에요',
    ],
    [
      'DAYS 일주일 전 (없음)',
      row(),
      '2026-11-10',
      'remindWeekBefore',
      '2026-11-03',
      null,
    ],
    [
      'YEARS 당일',
      row(),
      '2027-08-03',
      'remindDayOf',
      '2027-08-03',
      '오늘은 처음 만난 날 1주년이에요',
    ],
    [
      'YEARS 하루 전',
      row(),
      '2027-08-03',
      'remindDayBefore',
      '2027-08-02',
      '내일은 처음 만난 날 1주년이에요',
    ],
    [
      'YEARS 일주일 전',
      row(),
      '2027-08-03',
      'remindWeekBefore',
      '2027-07-27',
      '처음 만난 날 1주년이 일주일 남았어요',
    ],
    [
      'YEARLY 당일',
      row({ name: '하늘 생일', date: '2000-05-05', kind: 'YEARLY' }),
      '2027-05-05',
      'remindDayOf',
      '2027-05-05',
      '오늘은 하늘 생일이에요',
    ],
    [
      'YEARLY 하루 전',
      row({ name: '하늘 생일', date: '2000-05-05', kind: 'YEARLY' }),
      '2027-05-05',
      'remindDayBefore',
      '2027-05-04',
      '내일은 하늘 생일이에요',
    ],
    [
      'YEARLY 일주일 전',
      row({ name: '하늘 생일', date: '2000-05-05', kind: 'YEARLY' }),
      '2027-05-05',
      'remindWeekBefore',
      '2027-04-28',
      '하늘 생일이 일주일 남았어요',
    ],
    [
      'ORIGINAL 당일',
      row({ name: '결혼식', date: '2026-12-24', kind: 'ONCE' }),
      '2026-12-24',
      'remindDayOf',
      '2026-12-24',
      '오늘은 결혼식이에요',
    ],
    [
      'ORIGINAL 하루 전',
      row({ name: '결혼식', date: '2026-12-24', kind: 'ONCE' }),
      '2026-12-24',
      'remindDayBefore',
      '2026-12-23',
      '내일은 결혼식이에요',
    ],
    [
      'ORIGINAL 일주일 전',
      row({ name: '결혼식', date: '2026-12-24', kind: 'ONCE' }),
      '2026-12-24',
      'remindWeekBefore',
      '2026-12-17',
      '결혼식이 일주일 남았어요',
    ],
  ] as const)('%s', (_, base, target, flag, sendDay, body) => {
    const r = {
      ...base,
      remindDayOf: false,
      remindDayBefore: false,
      remindWeekBefore: false,
      [flag]: true,
    };
    const suffix =
      flag === 'remindDayOf' ? '' : flag === 'remindDayBefore' ? ':D1' : ':D7';
    expect(plan(r, sendDay)).toEqual(
      body === null
        ? []
        : [
            {
              key: `A:7:${target}${suffix}`,
              at: `${sendDay}T00:00:00.000Z`,
              body,
            },
          ],
    );
  });

  it('셋 다 켜면 보내는 날마다 맞는 시점만 (같은 그날의 당일과 하루 전은 키가 다르다)', () => {
    const r = row({
      ...ALL,
      name: '하늘 생일',
      date: '2000-05-05',
      kind: 'YEARLY',
    });
    expect(plan(r, '2027-04-28').map((p) => p.key)).toEqual([
      'A:7:2027-05-05:D7',
    ]);
    expect(plan(r, '2027-05-04').map((p) => p.key)).toEqual([
      'A:7:2027-05-05:D1',
    ]);
    expect(plan(r, '2027-05-05').map((p) => p.key)).toEqual(['A:7:2027-05-05']);
    expect(plan(r, '2027-05-01')).toEqual([]);
  });

  it('보내는 날 하나에 여러 기념일, 여러 시점이면 각각 1건 (오늘 100일 당일, 일주일 뒤 생일, 내일 1주년)', () => {
    const rows = [
      row({ ...ALL }), // 2026-11-10 이 100일
      row({
        ...ALL,
        id: 8,
        name: '하늘 생일',
        date: '2000-11-17',
        kind: 'YEARLY',
      }),
      row({
        ...ALL,
        id: 9,
        name: '결혼기념일',
        date: '2025-11-11',
        kind: 'COUNT_UP',
      }),
    ];
    expect(
      planAnniversaries(rows, '2026-11-10').map((p) => [
        p.dedupeKey,
        p.payload.body,
      ]),
    ).toEqual([
      ['A:7:2026-11-10', '오늘은 처음 만난 날 100일이에요'],
      ['A:8:2026-11-17:D7', '하늘 생일이 일주일 남았어요'],
      ['A:9:2026-11-11:D1', '내일은 결혼기념일 1주년이에요'],
    ]);
  });

  it('일주일 전은 그날의 N주년과 N일이 겹치면 N주년으로 (DAYS 만 뺀다)', () => {
    const a = { date: '2026-08-03', kind: 'COUNT_UP' as const };
    expect(itemsForOffset(a, '2026-11-10', 7)).toEqual([]);
    expect(itemsForOffset(a, '2026-11-10', 1).map((i) => i.type)).toEqual([
      'DAYS',
    ]);
    expect(itemsForOffset(a, '2027-08-03', 7).map((i) => i.label)).toEqual([
      '1주년',
    ]);
  });

  it('알림 없음(셋 다 꺼짐) 은 0건', () => {
    expect(plan(row({ remindDayOf: false }), '2026-11-10')).toEqual([]);
  });

  it('보내는 날 09:00 KST 경계: 그 순간 이전 수정은 보내고, 뒤 수정은 건너뛴다 (그날이 아니라 보내는 날 기준)', () => {
    const r = (updatedAt: string) =>
      row({
        remindDayOf: false,
        remindDayBefore: true,
        updatedAt: new Date(updatedAt),
      });
    expect(plan(r('2026-11-09T00:00:00.000Z'), '2026-11-09')).toHaveLength(1);
    expect(plan(r('2026-11-09T00:00:00.001Z'), '2026-11-09')).toEqual([]);
    // 전날 KST 23:59 (= 14:59 UTC) 수정은 다음 날 09:00 에 간다
    expect(plan(r('2026-11-08T14:59:00Z'), '2026-11-09')).toHaveLength(1);
  });

  it('창 경계: KST 날짜가 바뀌는 0시(= 15:00 UTC) 가 아니라 09:00 (= 00:00 UTC) 에 날짜가 정해진다', () => {
    expect(
      anniversaryDayInWindow(
        new Date('2026-11-08T14:55:00Z'),
        new Date('2026-11-08T15:05:00Z'),
      ),
    ).toBeNull();
    expect(
      anniversaryDayInWindow(
        new Date('2026-11-08T23:59:30Z'),
        new Date('2026-11-09T00:00:00Z'),
      ),
    ).toBe('2026-11-09');
  });
});
