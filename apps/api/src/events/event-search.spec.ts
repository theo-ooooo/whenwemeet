import { compareSearchItems, containsText, matchedFields, parseSearchQuery, representativeOccurrence } from './event-search.js';
import { likePattern } from './event-search.repository.js';
import type { SeriesRule } from './recurrence.js';

/** (#199) 일정 검색 순수 함수 (D-245, D-246) */
const kst = (value: string) => new Date(`${value}+09:00`);
const failsOn = (raw: Record<string, unknown>) => {
  try {
    parseSearchQuery(raw);
  } catch (error) {
    return (error as { details: { field: string }[] }).details[0].field;
  }
  return null;
};

describe('parseSearchQuery', () => {
  it('q 는 자르고, groupId 생략은 모든 팀, limit 기본 30', () => {
    expect(parseSearchQuery({ q: ' 치과 ' })).toEqual({ q: '치과', groupId: null, limit: 30 });
    expect(parseSearchQuery({ q: '밥', groupId: '12', limit: '50' })).toEqual({ q: '밥', groupId: 12, limit: 50 });
    expect(parseSearchQuery({ q: '가'.repeat(50), groupId: '', limit: '' })).toMatchObject({ groupId: null, limit: 30 });
  });

  it.each([
    [{}, 'q'],
    [{ q: ['a', 'b'] }, 'q'],
    [{ q: '가'.repeat(51) }, 'q'],
    [{ q: 'a', groupId: '0' }, 'groupId'],
    [{ q: 'a', groupId: '-1' }, 'groupId'],
    [{ q: 'a', groupId: '1.5' }, 'groupId'],
    [{ q: 'a', limit: '0' }, 'limit'],
    [{ q: 'a', limit: '51' }, 'limit'],
  ])('%j → %s 오류', (raw, field) => {
    expect(failsOn(raw)).toBe(field);
  });
});

describe('likePattern, containsText, matchedFields', () => {
  it('! % _ 를 ! 로 이스케이프', () => {
    expect(likePattern('50%')).toBe('%50!%%');
    expect(likePattern('a_b!')).toBe('%a!_b!!%');
  });

  it('대소문자 무시, 장소는 사용자 글자(직접 적은 것, 고를 때 검색어)만', () => {
    expect(containsText('Cafe ONHWA', 'onhwa')).toBe(true);
    expect(containsText(null, 'a')).toBe(false);
    const free = { text: '서울숲 입구', query: null, kakaoPlaceId: null, naverKey: null };
    const picked = { text: null, query: '뚝섬 공원', kakaoPlaceId: '8209184', naverKey: null };
    expect(matchedFields({ title: '산책', memo: '서울숲에서', place: free }, '서울숲')).toEqual(['memo', 'place']);
    expect(matchedFields({ title: '산책', memo: null, place: picked }, '뚝섬')).toEqual(['place']);
    expect(matchedFields({ title: '산책', memo: null, place: picked }, '8209184')).toEqual([]);
    expect(matchedFields({ title: '산책', memo: null, place: null }, '숲')).toEqual([]);
  });
});

describe('representativeOccurrence', () => {
  /** 매주 수요일 07:00~08:00, 2026-01-07 부터 */
  const weekly: SeriesRule = { startsAt: kst('2026-01-07T07:00:00'), endsAt: kst('2026-01-07T08:00:00'), allDay: false, repeat: 'WEEKLY', repeatUntil: null };
  const now = kst('2026-11-13T12:00:00');

  it('끝이 지금 뒤인 첫 회차. 진행 중인 회차도 다가오는 일정', () => {
    expect(representativeOccurrence(weekly, [], now)?.occurrence).toBe('2026-11-18');
    expect(representativeOccurrence(weekly, [], kst('2026-11-18T07:30:00'))?.occurrence).toBe('2026-11-18');
  });

  it('취소된 회차, 따로 줄이 있는 회차는 건너뛴다', () => {
    expect(representativeOccurrence(weekly, [{ occurrence: '2026-11-18', cancelled: true }], now)?.occurrence).toBe('2026-11-25');
    expect(representativeOccurrence(weekly, [], now, new Set(['2026-11-18']))?.occurrence).toBe('2026-11-25');
  });

  it('끝난 반복은 마지막 회차 (오래전에 끝나도), 회차가 하나도 없으면 null', () => {
    const ended: SeriesRule = { ...weekly, startsAt: kst('2023-01-04T07:00:00'), endsAt: kst('2023-01-04T08:00:00'), repeatUntil: '2023-03-01' };
    expect(representativeOccurrence(ended, [], now)?.occurrence).toBe('2023-03-01');
    expect(representativeOccurrence(ended, [{ occurrence: '2023-03-01', cancelled: true }], now)?.occurrence).toBe('2023-02-22');
    const one: SeriesRule = { ...ended, repeatUntil: '2023-01-04' };
    expect(representativeOccurrence(one, [{ occurrence: '2023-01-04', cancelled: true }], now)).toBeNull();
  });

  it('첫 회차가 400일 넘게 뒤인 반복도 첫 회차', () => {
    const later: SeriesRule = { ...weekly, startsAt: kst('2030-01-02T07:00:00'), endsAt: kst('2030-01-02T08:00:00') };
    expect(representativeOccurrence(later, [], now)?.occurrence).toBe('2030-01-02');
  });

  it('매년 반복은 400일 창 안에서 다음 회차', () => {
    const yearly: SeriesRule = { startsAt: kst('2020-02-01T00:00:00'), endsAt: kst('2020-02-02T00:00:00'), allDay: true, repeat: 'YEARLY', repeatUntil: null };
    expect(representativeOccurrence(yearly, [], now)?.occurrence).toBe('2027-02-01');
  });
});

describe('compareSearchItems', () => {
  it('다가오는 일정 먼저 시작 오름차순, 지난 일정은 시작 내림차순, 같으면 id, 회차', () => {
    const item = (upcoming: boolean, start: string, id: number, occurrence: string | null = null) => ({ upcoming, startsAt: kst(start), id, occurrence });
    const items = [
      item(false, '2025-01-01T10:00:00', 1),
      item(true, '2027-01-02T10:00:00', 2),
      item(false, '2025-06-01T10:00:00', 3),
      item(true, '2027-01-01T10:00:00', 5),
      item(true, '2027-01-01T10:00:00', 4, '2027-01-01'),
      item(true, '2027-01-01T10:00:00', 4, null),
    ].sort(compareSearchItems);
    expect(items.map((i) => [i.id, i.occurrence])).toEqual([
      [4, null],
      [4, '2027-01-01'],
      [5, null],
      [2, null],
      [3, null],
      [1, null],
    ]);
  });
});
