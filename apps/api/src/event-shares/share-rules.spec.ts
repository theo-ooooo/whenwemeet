import {
  generateShareToken,
  landingDate,
  resolveSharedOccurrence,
  SHARE_TOKEN_PATTERN,
  shareExpiresAt,
  type ShareableEvent,
} from './share-rules.js';

const kst = (value: string) => new Date(`${value}+09:00`);

const ONCE: ShareableEvent = {
  title: '저녁',
  startsAt: kst('2027-01-09T19:00:00'),
  endsAt: kst('2027-01-09T21:00:00'),
  allDay: false,
  repeat: null,
  repeatUntil: null,
  repeatAnchor: null,
};
const WEEKLY: ShareableEvent = {
  ...ONCE,
  title: '회의',
  startsAt: kst('2027-01-06T10:00:00'),
  endsAt: kst('2027-01-06T11:00:00'),
  repeat: 'WEEKLY',
};

describe('share-rules (#274)', () => {
  it('토큰은 base64url 22자, 매번 다르다', () => {
    const tokens = new Set(Array.from({ length: 50 }, generateShareToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(SHARE_TOKEN_PATTERN);
    expect(SHARE_TOKEN_PATTERN.test('A'.repeat(21))).toBe(false);
    expect(SHARE_TOKEN_PATTERN.test(`${'A'.repeat(21)}=`)).toBe(false);
  });

  it('만료: 회차 끝 + 1일, 만든 때 + 30일을 넘지 않음', () => {
    const now = kst('2027-01-01T12:00:00');
    expect(shareExpiresAt(kst('2027-01-09T21:00:00'), now)).toEqual(
      kst('2027-01-10T21:00:00'),
    );
    expect(shareExpiresAt(kst('2027-03-01T00:00:00'), now)).toEqual(
      kst('2027-01-31T12:00:00'),
    );
  });

  it('한 번짜리: occurrence null 이면 그대로, 값이 있으면(반복이던 일정) 없음', () => {
    expect(resolveSharedOccurrence(ONCE, [], null)).toEqual({
      title: '저녁',
      startsAt: ONCE.startsAt,
      endsAt: ONCE.endsAt,
      allDay: false,
      occurrence: null,
    });
    expect(resolveSharedOccurrence(ONCE, [], '2027-01-09')).toBeNull();
  });

  it('반복: 회차 값, 예외 반영, 취소/회차 아님/종료 뒤는 없음, null 이면 첫 회차', () => {
    expect(resolveSharedOccurrence(WEEKLY, [], '2027-01-13')).toEqual({
      title: '회의',
      startsAt: kst('2027-01-13T10:00:00'),
      endsAt: kst('2027-01-13T11:00:00'),
      allDay: false,
      occurrence: '2027-01-13',
    });
    expect(resolveSharedOccurrence(WEEKLY, [], null)?.occurrence).toBe(
      '2027-01-06',
    );
    expect(resolveSharedOccurrence(WEEKLY, [], '2027-01-14')).toBeNull();
    expect(
      resolveSharedOccurrence(
        WEEKLY,
        [{ occurrence: '2027-01-13', cancelled: true }],
        '2027-01-13',
      ),
    ).toBeNull();
    expect(
      resolveSharedOccurrence(
        { ...WEEKLY, repeatUntil: '2027-01-12' },
        [],
        '2027-01-13',
      ),
    ).toBeNull();
    const moved = resolveSharedOccurrence(
      WEEKLY,
      [
        {
          occurrence: '2027-01-13',
          cancelled: false,
          title: '옮김',
          startsAt: kst('2027-01-14T15:00:00'),
          endsAt: kst('2027-01-14T16:00:00'),
        },
      ],
      '2027-01-13',
    );
    expect(moved).toMatchObject({ title: '옮김', occurrence: '2027-01-13' });
    expect(landingDate(moved!)).toBe('2027-01-14');
  });
});
