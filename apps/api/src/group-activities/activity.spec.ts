import { anniversaryChanges, anniversaryUpdatedPayload, isSameAnniversary, snapshotName } from './activity.js';

const BASE = { name: '처음 만난 날', date: '2024-03-15', kind: 'COUNT_UP' as const };

describe('팀 활동 기록 규칙 (#191)', () => {
  it('같은 값 수정은 바뀐 것 없음 → 기록 안 함 (#62 규칙)', () => {
    expect(anniversaryChanges(BASE, { ...BASE })).toEqual([]);
    expect(anniversaryUpdatedPayload(BASE, { ...BASE })).toBeNull();
  });

  it('바뀐 필드만, 이전 값은 그 필드만 싣는다', () => {
    expect(anniversaryUpdatedPayload(BASE, { ...BASE, date: '2024-03-16' })).toEqual({ ...BASE, date: '2024-03-16', changed: ['date'], before: { date: '2024-03-15' } });
    expect(anniversaryUpdatedPayload(BASE, { name: '첫 만남', date: BASE.date, kind: 'YEARLY' })).toEqual({
      name: '첫 만남',
      date: BASE.date,
      kind: 'YEARLY',
      changed: ['name', 'kind'],
      before: { name: '처음 만난 날', kind: 'COUNT_UP' },
    });
  });

  it('되돌리기 판정: 이름, 날짜, 종류가 모두 같아야 한다', () => {
    expect(isSameAnniversary(BASE, { ...BASE })).toBe(true);
    expect(isSameAnniversary({ ...BASE, kind: 'ONCE' }, BASE)).toBe(false);
    expect(isSameAnniversary(null, BASE)).toBe(false);
    expect(isSameAnniversary('x', BASE)).toBe(false);
  });

  it('이름 스냅샷: 표시 이름 ?? 닉네임, 50자에서 자른다', () => {
    expect(snapshotName('별명', '닉')).toBe('별명');
    expect(snapshotName(null, '닉')).toBe('닉');
    expect(Array.from(snapshotName(null, '가'.repeat(60)))).toHaveLength(50);
  });
});
