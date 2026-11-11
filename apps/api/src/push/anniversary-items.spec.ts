import { anniversaryItemsOn, type AnniversaryKind } from './anniversary-items.js';
import { anniversaryDayInWindow, planAnniversaries } from './anniversary-planner.js';
import type { AnniversaryPlanRow } from './push.repository.js';

/** 그날의 첫 항목 라벨 (없으면 undefined, 이름만이면 null) */
const first = (date: string, kind: AnniversaryKind, day: string) => anniversaryItemsOn({ date, kind }, day)[0];

describe('anniversaryItemsOn (기념일-자동표시.md 3-5 예시표를 그날 단위로)', () => {
  it('2025-01-01 COUNT_UP: 100일, 200일, 300일, 1주년, 1000일, 2000일, 700일', () => {
    expect(first('2025-01-01', 'COUNT_UP', '2025-04-10')).toMatchObject({ type: 'DAYS', label: '100일' });
    expect(first('2025-01-01', 'COUNT_UP', '2025-07-19')).toMatchObject({ label: '200일' });
    expect(first('2025-01-01', 'COUNT_UP', '2025-10-27')).toMatchObject({ label: '300일' });
    expect(first('2025-01-01', 'COUNT_UP', '2026-01-01')).toMatchObject({ type: 'YEARS', label: '1주년' });
    expect(first('2025-01-01', 'COUNT_UP', '2027-09-27')).toMatchObject({ label: '1000일' });
    expect(first('2025-01-01', 'COUNT_UP', '2030-06-23')).toMatchObject({ label: '2000일' });
    expect(first('2025-01-01', 'COUNT_UP', '2026-12-01')).toMatchObject({ label: '700일' });
    expect(first('2025-01-01', 'COUNT_UP', '2027-01-01')).toMatchObject({ label: '2주년' });
    // 단위가 아닌 날은 없음 (2026-11-10 = 679일)
    expect(anniversaryItemsOn({ date: '2025-01-01', kind: 'COUNT_UP' }, '2026-11-10')).toEqual([]);
  });

  it('2026-08-03 COUNT_UP → 2026-11-10 "100일"', () => {
    expect(first('2026-08-03', 'COUNT_UP', '2026-11-10')).toMatchObject({ type: 'DAYS', n: 100, label: '100일' });
  });

  it('등록한 날짜 당일은 이름만 (ORIGINAL), 미래 COUNT_UP 의 100일도 그날 나온다', () => {
    expect(first('2026-12-24', 'COUNT_UP', '2026-12-24')).toMatchObject({ type: 'ORIGINAL', label: null });
    expect(first('2026-12-24', 'COUNT_UP', '2027-04-02')).toMatchObject({ label: '100일' });
  });

  it('2024-02-29 COUNT_UP: 100일 2024-06-07, 1주년 2025-02-28 (평년), 4주년 2028-02-29 (윤년)', () => {
    expect(first('2024-02-29', 'COUNT_UP', '2024-06-07')).toMatchObject({ label: '100일' });
    expect(first('2024-02-29', 'COUNT_UP', '2025-02-28')).toMatchObject({ label: '1주년' });
    expect(first('2024-02-29', 'COUNT_UP', '2028-02-29')).toMatchObject({ label: '4주년' });
    expect(anniversaryItemsOn({ date: '2024-02-29', kind: 'COUNT_UP' }, '2028-02-28')).toEqual([]);
  });

  it('1996-02-29 YEARLY: 2026-02-28, 2027-02-28, 2028-02-29', () => {
    for (const day of ['2026-02-28', '2027-02-28', '2028-02-29']) {
      expect(first('1996-02-29', 'YEARLY', day)).toMatchObject({ type: 'YEARLY', label: null });
    }
    expect(anniversaryItemsOn({ date: '1996-02-29', kind: 'YEARLY' }, '2028-02-28')).toEqual([]);
  });

  it('2000-05-05 YEARLY: 매년 5월 5일, 100일 단위 없음', () => {
    expect(first('2000-05-05', 'YEARLY', '2027-05-05')).toMatchObject({ type: 'YEARLY' });
    expect(anniversaryItemsOn({ date: '2000-05-05', kind: 'YEARLY' }, '2000-08-12')).toEqual([]);
  });

  it('2026-11-20 ONCE: 그날 하나, 다음 해는 없음', () => {
    expect(first('2026-11-20', 'ONCE', '2026-11-20')).toMatchObject({ type: 'ORIGINAL' });
    expect(anniversaryItemsOn({ date: '2026-11-20', kind: 'ONCE' }, '2027-11-20')).toEqual([]);
  });

  it('주년은 100주년까지, 등록 당일은 이름만 하나', () => {
    expect(anniversaryItemsOn({ date: '2024-01-01', kind: 'COUNT_UP' }, '2024-01-01').map((item) => item.type)).toEqual(['ORIGINAL']);
    expect(first('1900-01-01', 'COUNT_UP', '2000-01-01')).toMatchObject({ label: '100주년' });
    expect(anniversaryItemsOn({ date: '1900-01-01', kind: 'COUNT_UP' }, '2001-01-01')).toEqual([]);
  });
});

describe('기념일 예약 (설계 5-5)', () => {
  it('창 (lo, hi] 안의 KST 09:00 (= 그날 00:00 UTC) 만', () => {
    expect(anniversaryDayInWindow(new Date('2026-11-09T23:55:00Z'), new Date('2026-11-10T00:00:00Z'))).toBe('2026-11-10');
    expect(anniversaryDayInWindow(new Date('2026-11-10T00:00:00Z'), new Date('2026-11-10T00:05:00Z'))).toBeNull();
    expect(anniversaryDayInWindow(new Date('2026-11-10T00:01:00Z'), new Date('2026-11-10T00:09:00Z'))).toBeNull();
  });

  const row = (overrides: Partial<AnniversaryPlanRow> = {}): AnniversaryPlanRow => ({
    id: 5,
    groupId: 10,
    groupName: '우리',
    name: '처음 만난 날',
    date: '2026-08-03',
    kind: 'COUNT_UP',
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  });

  it('그날 항목이 있으면 기념일 하나에 1건, 키 A:{id}:{날짜}, 09:00 KST', () => {
    const [planned, ...rest] = planAnniversaries([row(), row({ id: 6, date: '2026-01-01' })], '2026-11-10');
    expect(rest).toEqual([]);
    expect(planned).toMatchObject({
      kind: 'ANNIVERSARY',
      dedupeKey: 'A:5:2026-11-10',
      scheduledAt: new Date('2026-11-10T00:00:00Z'),
      anniversaryId: 5,
      payload: { title: '처음 만난 날 100일', body: '오늘은 처음 만난 날 100일이에요', subtitle: '우리', url: '/g/10/anniversaries' },
    });
  });

  it('그날 09:00 뒤에 등록, 수정한 기념일은 건너뛴다', () => {
    expect(planAnniversaries([row({ updatedAt: new Date('2026-11-10T00:00:01Z') })], '2026-11-10')).toEqual([]);
    expect(planAnniversaries([row({ updatedAt: new Date('2026-11-10T00:00:00Z') })], '2026-11-10')).toHaveLength(1);
  });
});
