import ICAL from 'ical.js';
import { expand, type SeriesRule } from '../events/recurrence.js';
import {
  allDayDates,
  anniversaryEvents,
  eventDescription,
  eventLocation,
  eventToIcs,
  eventUid,
  eventUrl,
  type FeedEventInput,
  feedWindow,
  sequenceOf,
} from './feed-items.js';
import {
  feedToken,
  feedTokenHash,
  lookupHash,
  newFeedSalt,
  tokenMatches,
} from './feed-token.js';
import {
  buildIcs,
  escapeText,
  foldLine,
  formatUtc,
  type IcsEvent,
} from './ics.js';

const kst = (value: string) => new Date(`${value}+09:00`);
const OPTIONS = {
  includeMemo: false,
  includeParticipants: true,
  webOrigin: 'https://whenwemeet.day',
  groupCode: 'teamcode',
};
const UPDATED = new Date('2026-11-01T00:00:00Z');

function event(overrides: Partial<FeedEventInput> = {}): FeedEventInput {
  return {
    id: 7,
    publicCode: 'evntcode',
    title: '저녁',
    startsAt: kst('2026-11-22T18:00:00'),
    endsAt: kst('2026-11-22T20:00:00'),
    allDay: false,
    memo: null,
    updatedAt: UPDATED,
    repeat: null,
    occurrence: null,
    participants: { all: false, members: [] },
    ...overrides,
  };
}

function calendar(events: IcsEvent[], name = '언제볼까 - 우리') {
  return buildIcs({
    name,
    timezone: 'Asia/Seoul',
    refreshInterval: 'PT1H',
    events,
  });
}

/** 접힌 줄을 펴서 속성 줄 목록으로 */
function unfold(body: string): string[] {
  return body.replace(/\r\n /g, '').split('\r\n');
}

describe('ics 텍스트 규칙 (RFC 5545 3.1, 3.3.11)', () => {
  it('escapeText: \\ ; , 줄바꿈(CRLF, CR 포함)을 이스케이프하고 제어 문자는 지운다', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf\rg')).toBe(
      'a\\\\b\\;c\\,d\\ne\\nf\\ng',
    );
    expect(escapeText('x\u0000y\u0007z\tw')).toBe('xyz\tw');
  });

  it('foldLine: 75 옥텟 이하는 그대로', () => {
    const line = 'A'.repeat(75);
    expect(foldLine(line)).toBe(line);
  });

  it('foldLine: 한글은 3바이트 글자 경계에서만 접고, 이어진 줄은 공백 + 74 옥텟 이하', () => {
    const line = `SUMMARY:${'가나다라마바사아자차'.repeat(6)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    expect(Buffer.byteLength(parts[0], 'utf8')).toBeLessThanOrEqual(75);
    for (const part of parts.slice(1)) {
      expect(part.startsWith(' ')).toBe(true);
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    }
    // 잘린 글자가 없다: 이어 붙이면 원래 줄, 각 조각이 온전한 UTF-8
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
    for (const part of parts)
      expect(Buffer.from(part, 'utf8').toString('utf8')).toBe(part);
  });

  it('foldLine: 4바이트 이모지도 가르지 않는다', () => {
    const line = `SUMMARY:${'🎉'.repeat(40)}`;
    const parts = foldLine(line).split('\r\n');
    for (const part of parts)
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });

  it('buildIcs: 모든 줄이 CRLF 로 끝나고 단독 LF 가 없다. 머리 속성', () => {
    const body = calendar([eventToIcs(event(), OPTIONS)]);
    expect(body.endsWith('\r\n')).toBe(true);
    expect(body.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const lines = unfold(body);
    expect(lines.slice(0, 10)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//whenwemeet.day//whenwemeet calendar feed 1.0//KO',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:언제볼까 - 우리',
      'NAME:언제볼까 - 우리',
      'X-WR-TIMEZONE:Asia/Seoul',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
    ]);
    expect(lines.at(-2)).toBe('END:VCALENDAR');
  });

  it('팀 이름의 쉼표, 세미콜론도 이스케이프', () => {
    expect(unfold(calendar([], '언제볼까 - 가족, 친구;'))).toContain(
      'X-WR-CALNAME:언제볼까 - 가족\\, 친구\\;',
    );
  });

  it('formatUtc: 초 아래는 버린다', () => {
    expect(formatUtc(new Date('2026-11-22T09:05:07.999Z'))).toBe(
      '20261122T090507Z',
    );
  });
});

describe('(#199) 장소 → LOCATION, GEO (D-248)', () => {
  const picked = { text: null, query: '온화', kakaoPlaceId: '27531028' };
  const resolved = {
    name: '카페; 온화, 성수점',
    address: '서울 성동구 연무장길 12',
    lat: 37.5428,
    lng: 127.0565,
  };

  it('피드를 만들 때 다시 찾았으면 "이름, 주소" 를 이스케이프해 싣고 좌표는 소수 6자리 GEO. 메모 옵션과 무관', () => {
    const body = calendar([
      eventToIcs(event({ place: picked }), OPTIONS, resolved),
    ]);
    const lines = unfold(body);
    expect(lines).toContain(
      'LOCATION:카페\\; 온화\\, 성수점\\, 서울 성동구 연무장길 12',
    );
    expect(lines).toContain('GEO:37.542800;127.056500');
    expect(
      new ICAL.Event(
        new ICAL.Component(ICAL.parse(body)).getFirstSubcomponent('vevent')!,
      ).location,
    ).toBe('카페; 온화, 성수점, 서울 성동구 연무장길 12');
  });

  it('못 찾았으면 사용자 글자(고를 때 검색어, 직접 적은 글자), GEO 없음. 장소가 없으면 둘 다 없음', () => {
    const unresolved = unfold(
      calendar([eventToIcs(event({ place: picked }), OPTIONS)]),
    );
    expect(unresolved).toContain('LOCATION:온화');
    expect(unresolved.some((l) => l.startsWith('GEO'))).toBe(false);
    expect(eventLocation({ text: '집', query: null, kakaoPlaceId: null })).toBe(
      '집',
    );
    expect(eventLocation(null, { ...resolved, address: null })).toBe(
      resolved.name,
    );
    expect(eventLocation(null, { ...resolved, address: resolved.name })).toBe(
      resolved.name,
    );
    expect(eventLocation(null)).toBeNull();
    expect(eventLocation(undefined)).toBeNull();
    const none = unfold(calendar([eventToIcs(event(), OPTIONS)]));
    expect(
      none.some((l) => l.startsWith('LOCATION') || l.startsWith('GEO')),
    ).toBe(false);
  });
});

describe('일정 → VEVENT', () => {
  it('시간 일정은 UTC, UID 는 e{id}, 상세 링크, DTSTAMP, SEQUENCE', () => {
    const lines = unfold(calendar([eventToIcs(event(), OPTIONS)]));
    expect(lines).toEqual(
      expect.arrayContaining([
        'UID:e7@whenwemeet.day',
        'DTSTART:20261122T090000Z',
        'DTEND:20261122T110000Z',
        'SUMMARY:저녁',
        'URL:https://whenwemeet.day/events/evntcode?team=teamcode',
        `DTSTAMP:${formatUtc(UPDATED)}`,
        `LAST-MODIFIED:${formatUtc(UPDATED)}`,
        `SEQUENCE:${sequenceOf(UPDATED)}`,
      ]),
    );
    expect(lines.some((l) => l.startsWith('DESCRIPTION'))).toBe(false);
  });

  it('자정을 넘는 시간 일정은 시각 그대로 (UTC)', () => {
    const ics = eventToIcs(
      event({
        startsAt: kst('2026-11-22T23:00:00'),
        endsAt: kst('2026-11-23T01:30:00'),
      }),
      OPTIONS,
    );
    expect(ics.start).toEqual({
      allDay: false,
      at: kst('2026-11-22T23:00:00'),
    });
    expect(ics.end).toEqual({ allDay: false, at: kst('2026-11-23T01:30:00') });
  });

  it('종일: VALUE=DATE 와 배타 끝(다음 날). 여러 날 종일도 같은 규칙', () => {
    const one = eventToIcs(
      event({
        allDay: true,
        startsAt: kst('2026-11-22T00:00:00'),
        endsAt: kst('2026-11-23T00:00:00'),
      }),
      OPTIONS,
    );
    const lines = unfold(calendar([one]));
    expect(lines).toContain('DTSTART;VALUE=DATE:20261122');
    expect(lines).toContain('DTEND;VALUE=DATE:20261123');
    const multi = eventToIcs(
      event({
        allDay: true,
        startsAt: kst('2026-11-22T00:00:00'),
        endsAt: kst('2026-11-25T00:00:00'),
      }),
      OPTIONS,
    );
    expect(multi.start).toEqual({ allDay: true, date: '2026-11-22' });
    expect(multi.end).toEqual({ allDay: true, date: '2026-11-25' });
  });

  it('allDayDates: 자정이 아닌 저장값도 날짜로 맞추고, 끝은 시작 다음 날보다 앞서지 않는다', () => {
    expect(
      allDayDates(kst('2026-11-22T00:00:00'), kst('2026-11-22T23:59:00')),
    ).toEqual({ start: '2026-11-22', end: '2026-11-23' });
    expect(
      allDayDates(kst('2026-11-22T00:00:00'), kst('2026-11-22T00:00:00')),
    ).toEqual({ start: '2026-11-22', end: '2026-11-23' });
  });

  it('설명: 참여자 이름 첫 줄, 메모는 켰을 때만 (빈 줄 하나 띄움)', () => {
    const e = event({
      memo: '  창가 자리;예약 ',
      participants: {
        all: false,
        members: [{ displayName: '민지' }, { displayName: '지훈' }],
      },
    });
    expect(eventDescription(e, false)).toBe('참여: 민지, 지훈');
    expect(eventDescription(e, true)).toBe(
      '참여: 민지, 지훈\n\n창가 자리;예약',
    );
    expect(
      eventDescription(
        event({ participants: { all: true, members: [] } }),
        false,
      ),
    ).toBe('참여: 모두');
    expect(eventDescription(event({ memo: '메모만' }), true)).toBe('메모만');
    expect(eventDescription(event({ memo: '메모만' }), false)).toBeNull();
    // 개인 팀은 참여자 줄 없이 메모만
    expect(eventDescription(e, true, false)).toBe('창가 자리;예약');
    expect(eventDescription(e, false, false)).toBeNull();
    // (#566) 음력으로 넣은 일정은 맨 앞에 그 회차 날짜의 음력 (2026-11-24 = 음력 10월 16일)
    const lunar = {
      ...e,
      startsAt: kst('2026-11-24T19:00:00'),
      lunarInput: true,
    };
    expect(eventDescription(lunar, false)).toBe(
      '음력 10월 16일\n참여: 민지, 지훈',
    );
    expect(eventDescription(lunar, false, false)).toBe('음력 10월 16일');
    expect(
      eventDescription({ ...lunar, lunarInput: false }, false, false),
    ).toBeNull();
    const lines = unfold(
      calendar([eventToIcs(e, { ...OPTIONS, includeMemo: true })]),
    );
    expect(lines).toContain(
      'DESCRIPTION:참여: 민지\\, 지훈\\n\\n창가 자리\\;예약',
    );
  });

  it('UID 와 주소: 회차는 원래 날짜로 고정 (옮겨도 같다), 한 번짜리는 occurrence 를 쓰지 않는다', () => {
    expect(eventUid(7, '2026-11-22')).toBe('e7-20261122@whenwemeet.day');
    expect(eventUid(7, null)).toBe('e7@whenwemeet.day');
    expect(
      eventUrl(event({ repeat: 'WEEKLY', occurrence: '2026-11-22' }), OPTIONS),
    ).toBe(
      'https://whenwemeet.day/events/evntcode?team=teamcode&occurrence=2026-11-22',
    );
    expect(
      eventToIcs(event({ repeat: null, occurrence: '2026-11-22' }), OPTIONS)
        .uid,
    ).toBe('e7@whenwemeet.day');
  });

  it('반복 펼침 + 예외: 취소 회차는 없고, "이 일정만" 으로 옮긴 회차는 같은 UID 로 새 시각, 말일 보정 회차', () => {
    const series: SeriesRule = {
      startsAt: kst('2026-01-31T19:00:00'),
      endsAt: kst('2026-01-31T20:00:00'),
      allDay: false,
      repeat: 'MONTHLY',
      repeatUntil: '2026-05-31',
    };
    const occurrences = expand(
      series,
      [
        { occurrence: '2026-03-31', cancelled: true },
        {
          occurrence: '2026-04-30',
          cancelled: false,
          title: '옮긴 회의',
          startsAt: kst('2026-05-01T10:00:00'),
          endsAt: kst('2026-05-01T11:00:00'),
        },
      ],
      kst('2026-01-01T00:00:00'),
      kst('2026-07-01T00:00:00'),
    );
    const items = occurrences.map((o) =>
      eventToIcs(
        event({
          repeat: 'MONTHLY',
          occurrence: o.occurrence,
          startsAt: o.startsAt,
          endsAt: o.endsAt,
          title: o.title ?? '회의',
        }),
        OPTIONS,
      ),
    );
    expect(items.map((i) => i.uid)).toEqual([
      'e7-20260131@whenwemeet.day',
      'e7-20260228@whenwemeet.day', // 31일 → 2월 말일 (D-64)
      'e7-20260430@whenwemeet.day', // 옮겨도 원래 날짜 UID
      'e7-20260531@whenwemeet.day',
    ]);
    expect(items[2]).toMatchObject({
      summary: '옮긴 회의',
      start: { allDay: false, at: kst('2026-05-01T10:00:00') },
    });
    expect(new Set(items.map((i) => i.uid)).size).toBe(items.length);
  });

  it('sequenceOf: 2020 기준 초, 32비트 안', () => {
    expect(sequenceOf(new Date(Date.UTC(2020, 0, 1, 0, 0, 10)))).toBe(10);
    expect(sequenceOf(new Date('2019-01-01T00:00:00Z'))).toBe(0);
    expect(sequenceOf(new Date('2080-01-01T00:00:00Z'))).toBeLessThan(2 ** 31);
  });
});

describe('기념일 → 종일 VEVENT (Q3)', () => {
  const window = { firstDay: '2026-09-14', lastDay: '2027-12-18' };

  it('COUNT_UP: 원래 날짜, 100일 단위, N주년. 하루 하나 (우선순위 첫 항목)', () => {
    const items = anniversaryEvents(
      {
        id: 3,
        name: '처음 만난 날',
        date: '2026-09-20',
        kind: 'COUNT_UP',
        updatedAt: UPDATED,
      },
      window,
    );
    expect(items.map((i) => [i.start, i.summary])).toEqual([
      [{ allDay: true, date: '2026-09-20' }, '처음 만난 날'],
      [{ allDay: true, date: '2026-12-28' }, '처음 만난 날 100일'],
      [{ allDay: true, date: '2027-04-07' }, '처음 만난 날 200일'],
      [{ allDay: true, date: '2027-07-16' }, '처음 만난 날 300일'],
      [{ allDay: true, date: '2027-09-20' }, '처음 만난 날 1주년'],
      [{ allDay: true, date: '2027-10-24' }, '처음 만난 날 400일'],
    ]);
    expect(items[0]).toMatchObject({
      uid: 'a3-20260920@whenwemeet.day',
      end: { allDay: true, date: '2026-09-21' },
      transparent: true,
    });
  });

  it('YEARLY 는 매년 이름만, ONCE 는 그날 하나, 창 밖은 없다', () => {
    const yearly = anniversaryEvents(
      {
        id: 4,
        name: '엄마 생신',
        date: '1960-03-05',
        kind: 'YEARLY',
        updatedAt: UPDATED,
      },
      window,
    );
    expect(yearly.map((i) => i.summary)).toEqual(['엄마 생신']);
    expect(yearly[0].start).toEqual({ allDay: true, date: '2027-03-05' });
    const once = anniversaryEvents(
      {
        id: 5,
        name: '이사',
        date: '2027-01-02',
        kind: 'ONCE',
        updatedAt: UPDATED,
      },
      window,
    );
    expect(once.map((i) => i.start)).toEqual([
      { allDay: true, date: '2027-01-02' },
    ]);
    expect(
      anniversaryEvents(
        {
          id: 6,
          name: '옛날',
          date: '2020-01-01',
          kind: 'ONCE',
          updatedAt: UPDATED,
        },
        window,
      ),
    ).toEqual([]);
  });
});

describe('feedWindow (Q7)', () => {
  it('오늘(KST) 기준 과거 60일 ~ 미래 400일, 조회는 [첫날 00:00, 마지막 날 다음 날 00:00)', () => {
    const w = feedWindow(new Date('2026-11-12T16:00:00Z')); // KST 11-13 01:00
    expect(w.firstDay).toBe('2026-09-14');
    expect(w.lastDay).toBe('2027-12-18');
    expect(w.from).toEqual(kst('2026-09-14T00:00:00'));
    expect(w.to).toEqual(kst('2027-12-19T00:00:00'));
  });
});

describe('외부 파서로 읽기 (ical.js)', () => {
  it('한글 긴 제목, 종일, 반복 회차, 기념일이 그대로 읽힌다', () => {
    const longTitle =
      '아주 긴 한글 제목으로 줄 접기를 확인하는 일정입니다, 세미콜론; 백슬래시\\ 까지';
    const body = calendar([
      eventToIcs(event({ title: longTitle, memo: '첫 줄\n둘째 줄' }), {
        ...OPTIONS,
        includeMemo: true,
      }),
      eventToIcs(
        event({
          id: 8,
          allDay: true,
          startsAt: kst('2026-11-24T00:00:00'),
          endsAt: kst('2026-11-26T00:00:00'),
        }),
        OPTIONS,
      ),
      ...anniversaryEvents(
        {
          id: 3,
          name: '만난 날',
          date: '2026-09-20',
          kind: 'COUNT_UP',
          updatedAt: UPDATED,
        },
        { firstDay: '2026-09-14', lastDay: '2026-12-31' },
      ),
    ]);
    const vcal = new ICAL.Component(ICAL.parse(body));
    expect(vcal.getFirstPropertyValue('x-wr-calname')).toBe('언제볼까 - 우리');
    const vevents = vcal
      .getAllSubcomponents('vevent')
      .map((c) => new ICAL.Event(c));
    expect(vevents).toHaveLength(4);
    expect(vevents[0].summary).toBe(longTitle);
    expect(vevents[0].description).toBe('첫 줄\n둘째 줄');
    expect(vevents[0].startDate.toJSDate()).toEqual(kst('2026-11-22T18:00:00'));
    expect(vevents[1].startDate.isDate).toBe(true);
    expect(vevents[1].startDate.toString()).toBe('2026-11-24');
    expect(vevents[1].endDate.toString()).toBe('2026-11-26');
    expect(vevents[3].summary).toBe('만난 날 100일');
  });
});

describe('구독 토큰 (D-218)', () => {
  const key = Buffer.alloc(32, 7);

  it('43자 base64url, 같은 입력이면 같은 토큰, 소금이 바뀌면 다른 토큰', () => {
    const salt = newFeedSalt();
    expect(salt).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const token = feedToken(key, 1, 2, salt);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(feedToken(key, 1, 2, salt)).toBe(token);
    expect(feedToken(key, 1, 2, newFeedSalt())).not.toBe(token);
    expect(feedToken(key, 1, 3, salt)).not.toBe(token);
    expect(feedToken(Buffer.alloc(32, 8), 1, 2, salt)).not.toBe(token);
  });

  it('lookupHash: 형식이 틀리면 null, 맞으면 sha256 hex', () => {
    expect(lookupHash('short')).toBeNull();
    expect(lookupHash(`${'A'.repeat(42)}!`)).toBeNull();
    expect(lookupHash(123)).toBeNull();
    const token = feedToken(key, 1, 2, 'salt');
    expect(lookupHash(token)).toBe(feedTokenHash(token));
    expect(feedTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tokenMatches: 행으로 다시 만든 토큰과 같아야 한다 (대소문자 구분)', () => {
    const row = { userId: 1, groupId: 2, tokenSalt: 'salt' };
    const token = feedToken(key, 1, 2, 'salt');
    expect(tokenMatches(key, row, token)).toBe(true);
    const flipped =
      token[0] === token[0].toUpperCase()
        ? token[0].toLowerCase() + token.slice(1)
        : token[0].toUpperCase() + token.slice(1);
    if (flipped !== token) expect(tokenMatches(key, row, flipped)).toBe(false);
    expect(tokenMatches(key, { ...row, tokenSalt: 'other' }, token)).toBe(
      false,
    );
    expect(tokenMatches(key, row, 'x')).toBe(false);
  });
});
