import {
  anniversaryChanges,
  anniversaryUpdatedPayload,
  isSameAnniversary,
  pickValues,
  pollEventLogIds,
  snapshotName,
} from './activity.js';

const BASE = {
  name: '처음 만난 날',
  date: '2024-03-15',
  kind: 'COUNT_UP' as const,
};

describe('(#189) pollEventLogIds', () => {
  it('POLL_CLOSED 의 eventLogId 만 모은다', () => {
    expect([
      ...pollEventLogIds([
        { type: 'POLL_CLOSED', payload: { eventLogId: 3 } },
        { type: 'POLL_CREATED', payload: { pollId: 1 } },
        { type: 'POLL_CLOSED', payload: null },
        { type: 'MEMBER_LEFT', payload: { eventLogId: 9 } },
      ]),
    ]).toEqual([3]);
  });
});

describe('팀 활동 기록 규칙 (#191)', () => {
  it('같은 값 수정은 바뀐 것 없음 → 기록 안 함 (#62 규칙)', () => {
    expect(anniversaryChanges(BASE, { ...BASE })).toEqual([]);
    expect(anniversaryUpdatedPayload(BASE, { ...BASE })).toBeNull();
  });

  it('바뀐 필드만, 이전 값은 그 필드만 싣는다', () => {
    expect(
      anniversaryUpdatedPayload(BASE, { ...BASE, date: '2024-03-16' }),
    ).toEqual({
      ...BASE,
      date: '2024-03-16',
      changed: ['date'],
      before: { date: '2024-03-15' },
    });
    expect(
      anniversaryUpdatedPayload(BASE, {
        name: '첫 만남',
        date: BASE.date,
        kind: 'YEARLY',
      }),
    ).toEqual({
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

describe('(#562) 음력 기념일 새 소식 값', () => {
  const solar = { name: '제사', date: '2000-03-15', kind: 'YEARLY' as const };
  const lunar = { ...solar, calendar: 'LUNAR' as const };

  it('양력 ↔ 음력, 윤달만 바꿔도 날짜가 바뀐 것. 이전 값에 음력 키를 함께 남긴다', () => {
    expect(anniversaryChanges(solar, lunar)).toEqual(['date']);
    expect(
      anniversaryUpdatedPayload(lunar, { ...lunar, isLeapMonth: true }),
    ).toEqual({
      ...lunar,
      isLeapMonth: true,
      changed: ['date'],
      before: { date: '2000-03-15', calendar: 'LUNAR' },
    });
    expect(
      anniversaryUpdatedPayload(lunar, { ...lunar, name: '기일' }),
    ).toEqual({
      ...lunar,
      name: '기일',
      changed: ['name'],
      before: { name: '제사' },
    });
  });

  it('되돌리기 판정은 달력 종류까지 같아야 한다. 양력 기록은 옛 모양 그대로', () => {
    expect(isSameAnniversary(lunar, lunar)).toBe(true);
    expect(isSameAnniversary(solar, lunar)).toBe(false);
    expect(pickValues(solar)).toEqual(solar);
  });
});
