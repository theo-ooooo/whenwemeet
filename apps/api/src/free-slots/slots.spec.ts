import {
  buildDayWindows,
  ceilToSlotStep,
  clampFromToNow,
  findFreeSlots,
  Interval,
  mergeIntervals,
  parseHHmm,
  subtractBusy,
} from './slots.js';

const d = (iso: string) => new Date(iso);
const iv = (s: string, e: string): Interval => ({ startsAt: d(s), endsAt: d(e) });
const plain = (list: Interval[]) => list.map((x) => [x.startsAt.toISOString(), x.endsAt.toISOString()]);

describe('parseHHmm', () => {
  it('HH:mm → 분, 틀리면 null', () => {
    expect(parseHHmm('00:00')).toBe(0);
    expect(parseHHmm('09:30')).toBe(570);
    expect(parseHHmm('23:59')).toBe(1439);
    expect(parseHHmm('24:00')).toBeNull();
    expect(parseHHmm('9:00')).toBeNull();
    expect(parseHHmm('09:60')).toBeNull();
  });
});

describe('ceilToSlotStep', () => {
  it.each([
    ['정각은 그대로', '2026-11-10T14:00:00.000Z', '2026-11-10T14:00:00.000Z'],
    ['정각+1분 → 30분', '2026-11-10T14:01:00.000Z', '2026-11-10T14:30:00.000Z'],
    ['29분 → 30분', '2026-11-10T14:29:00.000Z', '2026-11-10T14:30:00.000Z'],
    ['30분은 그대로', '2026-11-10T14:30:00.000Z', '2026-11-10T14:30:00.000Z'],
    ['59분 → 다음 정각', '2026-11-10T14:59:00.000Z', '2026-11-10T15:00:00.000Z'],
    ['37분 → 다음 정각 (이슈 #16 예시)', '2026-11-10T14:37:00.000Z', '2026-11-10T15:00:00.000Z'],
    ['초가 붙어도 다음 경계', '2026-11-10T14:30:00.001Z', '2026-11-10T15:00:00.000Z'],
    ['자정 넘김', '2026-11-10T23:45:12.000Z', '2026-11-11T00:00:00.000Z'],
  ])('%s', (_name, input, expected) => {
    expect(ceilToSlotStep(d(input)).toISOString()).toBe(expected);
  });

  it('KST 경계와도 어긋나지 않는다 (KST 14:37 → KST 15:00)', () => {
    // KST 14:37 = 05:37Z → KST 15:00 = 06:00Z
    expect(ceilToSlotStep(d('2026-11-10T05:37:00Z')).toISOString()).toBe('2026-11-10T06:00:00.000Z');
  });

  it('단위를 바꿀 수 있다', () => {
    expect(ceilToSlotStep(d('2026-11-10T14:07:00Z'), 15).toISOString()).toBe('2026-11-10T14:15:00.000Z');
  });
});

describe('clampFromToNow', () => {
  const now = d('2026-11-10T14:37:00Z');

  it('from 이 과거면 now 를 30분 경계로 올린 값', () => {
    expect(clampFromToNow(d('2026-11-10T00:00:00Z'), now).toISOString()).toBe('2026-11-10T15:00:00.000Z');
  });

  it('from 이 now 와 같거나 미래면 그대로 (올림하지 않는다)', () => {
    const future = d('2026-11-10T14:40:00Z');
    expect(clampFromToNow(future, now)).toBe(future);
    expect(clampFromToNow(now, now)).toBe(now);
  });
});

describe('mergeIntervals', () => {
  it('겹치거나 맞닿은 구간을 병합하고 입력은 바꾸지 않는다', () => {
    const input = [
      iv('2026-11-10T01:00:00Z', '2026-11-10T03:00:00Z'),
      iv('2026-11-10T02:00:00Z', '2026-11-10T02:30:00Z'), // 안에 포함
      iv('2026-11-10T03:00:00Z', '2026-11-10T04:00:00Z'), // 맞닿음
      iv('2026-11-10T05:00:00Z', '2026-11-10T06:00:00Z'), // 떨어짐
    ];
    const snapshot = JSON.stringify(input);
    expect(plain(mergeIntervals(input))).toEqual([
      ['2026-11-10T01:00:00.000Z', '2026-11-10T04:00:00.000Z'],
      ['2026-11-10T05:00:00.000Z', '2026-11-10T06:00:00.000Z'],
    ]);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(mergeIntervals([])).toEqual([]);
  });
});

describe('buildDayWindows', () => {
  it('KST 날짜별 [dayStart, dayEnd) 창을 만들고 [from, to) 로 자른다', () => {
    // from = 11/10 KST 11:00 (02:00Z), to = 11/12 KST 10:00 (01:00Z). 창 09:00~18:00 KST
    const windows = buildDayWindows(d('2026-11-10T02:00:00Z'), d('2026-11-12T01:00:00Z'), 9 * 60, 18 * 60);
    expect(plain(windows)).toEqual([
      ['2026-11-10T02:00:00.000Z', '2026-11-10T09:00:00.000Z'], // 첫날은 from 부터
      ['2026-11-11T00:00:00.000Z', '2026-11-11T09:00:00.000Z'],
      ['2026-11-12T00:00:00.000Z', '2026-11-12T01:00:00.000Z'], // 마지막 날은 to 까지
    ]);
  });

  it('UTC 날짜와 KST 날짜가 다른 경계를 올바르게 나눈다', () => {
    // 11/10 20:00Z = 11/11 KST 05:00. 창 00:00~08:00 KST → 11/11 KST 창은 11/10 15:00Z~23:00Z
    const windows = buildDayWindows(d('2026-11-10T20:00:00Z'), d('2026-11-10T23:30:00Z'), 0, 8 * 60);
    expect(plain(windows)).toEqual([['2026-11-10T20:00:00.000Z', '2026-11-10T23:00:00.000Z']]);
  });

  it('창이 범위 밖이면 비고, to <= from 이면 빈 배열', () => {
    expect(buildDayWindows(d('2026-11-10T10:00:00Z'), d('2026-11-10T12:00:00Z'), 9 * 60, 12 * 60)).toEqual([]);
    expect(buildDayWindows(d('2026-11-10T10:00:00Z'), d('2026-11-10T10:00:00Z'), 0, 1440)).toEqual([]);
  });
});

describe('subtractBusy', () => {
  const windows = [iv('2026-11-10T00:00:00Z', '2026-11-10T14:00:00Z'), iv('2026-11-11T00:00:00Z', '2026-11-11T14:00:00Z')];

  it('busy 를 빼고 minMinutes 미만은 버린다', () => {
    const busy = [
      iv('2026-11-09T23:00:00Z', '2026-11-10T00:30:00Z'), // 창 시작과 겹침
      iv('2026-11-10T01:00:00Z', '2026-11-10T03:00:00Z'),
      iv('2026-11-10T13:00:00Z', '2026-11-10T15:00:00Z'), // 창 끝과 겹침
      iv('2026-11-11T05:00:00Z', '2026-11-11T06:00:00Z'),
    ];
    expect(plain(subtractBusy(windows, busy, 60))).toEqual([
      ['2026-11-10T03:00:00.000Z', '2026-11-10T13:00:00.000Z'], // 00:30~01:00 은 30분이라 제외
      ['2026-11-11T00:00:00.000Z', '2026-11-11T05:00:00.000Z'],
      ['2026-11-11T06:00:00.000Z', '2026-11-11T14:00:00.000Z'],
    ]);
  });

  it('busy 가 없으면 창 그대로, 창을 전부 덮으면 비어 있다', () => {
    expect(plain(subtractBusy(windows, [], 120))).toEqual(plain(windows));
    expect(subtractBusy(windows, [iv('2026-11-09T00:00:00Z', '2026-11-12T00:00:00Z')], 30)).toEqual([]);
  });

  it('여러 날에 걸친 busy 하나가 다음 창에도 적용된다', () => {
    const busy = [iv('2026-11-10T10:00:00Z', '2026-11-11T02:00:00Z')];
    expect(plain(subtractBusy(windows, busy, 60))).toEqual([
      ['2026-11-10T00:00:00.000Z', '2026-11-10T10:00:00.000Z'],
      ['2026-11-11T02:00:00.000Z', '2026-11-11T14:00:00.000Z'],
    ]);
  });
});

describe('findFreeSlots', () => {
  it('병합 → 창 → 빼기 → 상한 100', () => {
    const from = d('2026-11-01T00:00:00Z');
    const to = d('2026-12-01T00:00:00Z');
    // 매일 09:00~23:00 KST 창에 1시간짜리 busy 를 한 시간 간격으로 넣어 조각을 많이 만든다
    const busy: Interval[] = [];
    for (let day = 0; day < 30; day += 1) {
      for (let hour = 1; hour < 14; hour += 2) {
        const start = new Date(from.getTime() + day * 86_400_000 + hour * 3_600_000);
        busy.push({ startsAt: start, endsAt: new Date(start.getTime() + 3_600_000) });
      }
    }
    const slots = findFreeSlots({ from, to, dayStartMin: 9 * 60, dayEndMin: 23 * 60, minMinutes: 30, busy });
    expect(slots).toHaveLength(100);
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i].startsAt.getTime()).toBeGreaterThanOrEqual(slots[i - 1].endsAt.getTime());
    }
    expect(findFreeSlots({ from, to, dayStartMin: 9 * 60, dayEndMin: 23 * 60, minMinutes: 30, busy, limit: 3 })).toHaveLength(3);
  });
});
