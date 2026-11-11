import { ianaName, isFixedOffset, toInstant } from './ics-time.js';

const wall = (y: number, mo: number, d: number, h = 0, mi = 0) => ({ y, mo, d, h, mi, s: 0 });

describe('ianaName', () => {
  it('IANA 이름은 그대로, 접두사가 붙은 이름은 뒤의 대륙/도시, Windows 이름은 표로', () => {
    expect(ianaName('Asia/Seoul')).toBe('Asia/Seoul');
    expect(ianaName('/mozilla.org/20050126_1/America/New_York')).toBe('America/New_York');
    expect(ianaName('Korea Standard Time')).toBe('Asia/Seoul');
    expect(ianaName('"Asia/Tokyo"')).toBe('Asia/Tokyo');
  });

  it('모르는 이름은 null', () => {
    expect(ianaName('Mars/Olympus')).toBeNull();
    expect(ianaName('Custom Seoul Zone')).toBeNull();
  });
});

describe('toInstant', () => {
  it('UTC, KST, IANA', () => {
    expect(toInstant(wall(2026, 11, 20, 10), { type: 'UTC' }).toISOString()).toBe('2026-11-20T10:00:00.000Z');
    expect(toInstant(wall(2026, 11, 20, 10), { type: 'KST' }).toISOString()).toBe('2026-11-20T01:00:00.000Z');
    expect(toInstant(wall(2026, 11, 20, 10), { type: 'IANA', name: 'Asia/Seoul' }).toISOString()).toBe('2026-11-20T01:00:00.000Z');
  });

  it('서머타임 전후 뉴욕 10시는 UTC 15시, 14시', () => {
    const ny = { type: 'IANA', name: 'America/New_York' } as const;
    expect(toInstant(wall(2027, 3, 8, 10), ny).toISOString()).toBe('2027-03-08T15:00:00.000Z');
    expect(toInstant(wall(2027, 3, 15, 10), ny).toISOString()).toBe('2027-03-15T14:00:00.000Z');
  });

  it('봄에 없는 시각(2:30)은 앞으로 밀리고, 가을에 두 번 있는 시각(1:30)은 앞의 것', () => {
    const ny = { type: 'IANA', name: 'America/New_York' } as const;
    expect(toInstant(wall(2027, 3, 14, 2, 30), ny).toISOString()).toBe('2027-03-14T07:30:00.000Z');
    expect(toInstant(wall(2026, 11, 1, 1, 30), ny).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
});

describe('isFixedOffset', () => {
  it('서울, UTC, KST 는 고정, 뉴욕은 아님', () => {
    expect(isFixedOffset({ type: 'IANA', name: 'Asia/Seoul' }, 2026)).toBe(true);
    expect(isFixedOffset({ type: 'UTC' }, 2026)).toBe(true);
    expect(isFixedOffset({ type: 'KST' }, 2026)).toBe(true);
    expect(isFixedOffset({ type: 'IANA', name: 'America/New_York' }, 2026)).toBe(false);
  });
});
