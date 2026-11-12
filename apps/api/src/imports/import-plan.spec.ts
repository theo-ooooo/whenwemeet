import { readFileSync } from 'node:fs';
import ICAL from 'ical.js';
import { expand, kstDate } from '../events/recurrence.js';
import { markBareDates, parseIcs } from './ics-parse.js';
import {
  buildCandidates,
  clip,
  finalizePlan,
  IMPORT_MAX_EVENTS,
  type ImportRange,
  importWindow,
  type PlannedEvent,
  selectEvents,
  sha256Hex,
  toMemo,
  toTitle,
} from './import-plan.js';

/** 2026-11-11 (수) 12:00 KST */
const NOW = new Date('2026-11-11T03:00:00Z');
const fixtureText = (name: string) => readFileSync(new URL(`../../test/fixtures/ics/${name}.ics`, import.meta.url));
const plan = (bytes: Buffer, range: ImportRange = 'future', existing: Set<string> = new Set()) =>
  finalizePlan(buildCandidates(parseIcs(bytes), range, NOW), existing);
const ics = (...lines: string[]) => Buffer.from(['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR', ''].join('\r\n'));
const vevent = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const byTitle = (events: PlannedEvent[], title: string) => events.filter((event) => event.title === title);
const iso = (date: Date) => date.toISOString();

describe('제목, 메모', () => {
  it('제목: 공백 정리, 비면 "제목 없음", 50자 넘으면 49자 + "…"', () => {
    expect(toTitle('  회의\n  준비 ')).toEqual({ title: '회의 준비', clipped: false });
    expect(toTitle(' ')).toEqual({ title: '제목 없음', clipped: false });
    const long = toTitle('가'.repeat(60));
    expect(long.clipped).toBe(true);
    expect(long.title).toBe(`${'가'.repeat(49)}…`);
  });

  it('자를 때 이모지(서로게이트 쌍)를 가르지 않는다', () => {
    const { text } = clip(`${'a'.repeat(48)}😀😀`, 50);
    expect(text).toBe(`${'a'.repeat(48)}…`);
  });

  it('메모: "장소: …" 첫 줄 + 설명, 500자 자름, 비면 null', () => {
    expect(toMemo('성수동', '영화')).toBe('장소: 성수동\n영화');
    expect(toMemo('', '')).toBeNull();
    expect(toMemo('', 'x'.repeat(600))).toHaveLength(500);
  });
});

describe('기간 창', () => {
  it('오늘 이후는 오늘 KST 00:00, 지난 1년은 365일 전 00:00 부터. 펼치기는 오늘부터 366일 전까지', () => {
    expect(iso(importWindow('future', NOW).lo)).toBe('2026-11-10T15:00:00.000Z');
    expect(iso(importWindow('year', NOW).lo)).toBe('2025-11-10T15:00:00.000Z');
    expect(iso(importWindow('future', NOW).hi)).toBe('2027-11-11T15:00:00.000Z');
  });
});

describe('구글 내보내기', () => {
  const result = plan(fixtureText('google'));

  it('요약: 9개 중 14개(반복 유지 2, 펼침 11), 취소 1, 지난 일정 1', () => {
    expect(result.preview).toMatchObject({
      total: 9,
      toCreate: 14,
      recurringKept: 2,
      expanded: 11,
      expandedSeries: 3,
      skipped: [
        { reason: 'CANCELLED', count: 1 },
        { reason: 'TOO_OLD', count: 1 },
      ],
      warnings: [],
    });
    expect(result.preview.sample).toHaveLength(5);
    expect(iso(result.preview.firstStartsAt!)).toBe('2026-11-11T15:00:00.000Z');
    expect(iso(result.preview.lastStartsAt!)).toBe('2027-07-31T00:00:00.000Z');
  });

  it('매주 화요일: 시작을 창 안 첫 회차로 당기고, EXDATE 는 취소, 바뀐 회차는 예외', () => {
    const [study] = byTitle(result.events, '영어 스터디');
    expect(study).toMatchObject({ repeat: 'WEEKLY', repeatUntil: null, allDay: false, source: 'KEPT', uidHash: sha256Hex('weekly-study@google.com') });
    expect(iso(study.startsAt)).toBe('2026-11-17T10:00:00.000Z');
    expect(study.exceptions).toEqual([
      { occurrence: '2026-11-17', cancelled: true, title: null, startsAt: null, endsAt: null, allDay: null, memo: null },
      {
        occurrence: '2026-11-24',
        cancelled: false,
        title: '영어 스터디 (한 시간 늦게)',
        startsAt: new Date('2026-11-24T11:00:00Z'),
        endsAt: new Date('2026-11-24T12:00:00Z'),
        allDay: null,
        memo: null,
      },
    ]);
  });

  it('매년 종일 생일은 YEARLY, 시작은 다음 생일', () => {
    const [birthday] = byTitle(result.events, '엄마 생신');
    expect(birthday).toMatchObject({ repeat: 'YEARLY', allDay: true });
    expect(kstDate(birthday.startsAt)).toBe('2027-03-15');
    expect(birthday.endsAt.getTime() - birthday.startsAt.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('UTC(Z) 시각과 장소, 설명', () => {
    const [dentist] = byTitle(result.events, '치과');
    expect(iso(dentist.startsAt)).toBe('2026-11-20T01:00:00.000Z');
    expect(dentist.memo).toMatch(/^장소: 서울시 강남구 테헤란로 1, 2층\n스케일링 예약/);
  });

  it('매월 31일은 RFC 대로(31일 없는 달 건너뜀) 펼친다 (우리 규칙은 말일 보정이라 다르다)', () => {
    expect(byTitle(result.events, '월말 정산').map((event) => kstDate(event.startsAt))).toEqual([
      '2026-12-31',
      '2027-01-31',
      '2027-03-31',
      '2027-05-31',
      '2027-07-31',
    ]);
  });

  it('매월 둘째 화요일(BYDAY=2TU)은 UNTIL 까지 펼친다', () => {
    expect(byTitle(result.events, '독서 모임').map((event) => kstDate(event.startsAt))).toEqual(['2026-12-08', '2027-01-12', '2027-02-09']);
  });

  it('매일(COUNT=3) 종일은 펼친다', () => {
    expect(byTitle(result.events, '제주 여행 준비').map((event) => kstDate(event.startsAt))).toEqual(['2026-11-12', '2026-11-13', '2026-11-14']);
  });
});

describe('애플 내보내기', () => {
  const result = plan(fixtureText('apple'));

  it('서머타임 있는 시간대의 매주는 펼쳐서 UTC 가 바뀐다', () => {
    expect(byTitle(result.events, '뉴욕 주간 회의').map((event) => iso(event.startsAt))).toEqual([
      '2027-03-01T15:00:00.000Z',
      '2027-03-08T15:00:00.000Z',
      '2027-03-15T14:00:00.000Z',
    ]);
  });

  it('여러 날 종일, DURATION, 떠 있는 시각(KST)', () => {
    const [trip] = byTitle(result.events, '가족 여행');
    expect(trip).toMatchObject({ allDay: true, startsAt: new Date('2026-12-23T15:00:00Z'), endsAt: new Date('2026-12-26T15:00:00Z') });
    const [meeting] = byTitle(result.events, '분기 회의');
    expect(meeting.endsAt.getTime() - meeting.startsAt.getTime()).toBe(90 * 60 * 1000);
    expect(iso(byTitle(result.events, '떠 있는 시각')[0].startsAt)).toBe('2026-12-05T01:00:00.000Z');
  });
});

describe('네이버 내보내기', () => {
  const result = plan(fixtureText('naver'));

  it('TRANSP:TRANSPARENT 도 넣고, 매월 25일(종일)은 MONTHLY, 격주 토요일은 BIWEEKLY + 종료일', () => {
    expect(byTitle(result.events, '송년회')).toHaveLength(1);
    expect(byTitle(result.events, '월급날')[0]).toMatchObject({ repeat: 'MONTHLY', allDay: true });
    expect(kstDate(byTitle(result.events, '월급날')[0].startsAt)).toBe('2026-11-25');
    const [hike] = byTitle(result.events, '격주 등산');
    expect(hike).toMatchObject({ repeat: 'BIWEEKLY', repeatUntil: '2027-01-30' });
    expect(kstDate(hike.startsAt)).toBe('2026-11-21');
  });

  it('평일 매일(요일 여럿)은 COUNT 만큼 펼친다', () => {
    expect(byTitle(result.events, '아침 운동')).toHaveLength(10);
  });
});

describe('TimeTree 도구 산출물', () => {
  const result = plan(fixtureText('timetree'));

  it('VALARM 은 무시하고, 매주 + UNTIL + EXDATE 는 WEEKLY 와 취소 예외', () => {
    const [friday] = byTitle(result.events, '금요일 저녁');
    expect(friday).toMatchObject({ repeat: 'WEEKLY', repeatUntil: '2026-12-11' });
    expect(friday.exceptions.map((exception) => [exception.occurrence, exception.cancelled])).toEqual([['2026-11-27', true]]);
  });

  it('매월 30일은 2월을 건너뛰며 1년 안 회차만 펼친다', () => {
    const dates = byTitle(result.events, '우리 만난 날 (매월)').map((event) => kstDate(event.startsAt));
    expect(dates).toHaveLength(11);
    expect(dates).not.toContain('2027-02-28');
    expect(dates.at(-1)).toBe('2027-10-30');
  });
});

describe('TimeTree 도구 1.0.0 산출물 (#309, VALUE=DATE 없는 종일)', () => {
  const result = plan(fixtureText('timetree-1.0'));
  const span = (title: string) => {
    const [event] = byTitle(result.events, title);
    return { allDay: event.allDay, startsAt: iso(event.startsAt), endsAt: iso(event.endsAt) };
  };

  it('못 읽음 없이 모두 넣는다', () => {
    expect(result.preview).toMatchObject({ total: 8, skipped: [], warnings: [] });
    // 한 번짜리 7 + 매주 반복 1 (옮김)
    expect(result.preview.toCreate).toBe(8);
  });

  it('DTEND 는 배타: 하루, 사흘, 열하루가 KST 00:00 ~ 끝 날 다음 날 00:00', () => {
    expect(span('하루 종일')).toEqual({ allDay: true, startsAt: '2026-11-19T15:00:00.000Z', endsAt: '2026-11-20T15:00:00.000Z' });
    expect(span('사흘 여행')).toEqual({ allDay: true, startsAt: '2026-11-24T15:00:00.000Z', endsAt: '2026-11-27T15:00:00.000Z' });
    expect(span('열하루 출장')).toEqual({ allDay: true, startsAt: '2026-11-30T15:00:00.000Z', endsAt: '2026-12-11T15:00:00.000Z' });
  });

  it('DTEND 가 DTSTART 와 같거나 없으면 하루', () => {
    expect(span('끝이 시작과 같음')).toEqual({ allDay: true, startsAt: '2026-12-04T15:00:00.000Z', endsAt: '2026-12-05T15:00:00.000Z' });
    expect(span('끝 없음')).toEqual({ allDay: true, startsAt: '2026-12-05T15:00:00.000Z', endsAt: '2026-12-06T15:00:00.000Z' });
  });

  it('시간 일정: TZID 와 UTC', () => {
    expect(span('저녁 약속')).toEqual({ allDay: false, startsAt: '2026-12-07T10:00:00.000Z', endsAt: '2026-12-07T12:00:00.000Z' });
    expect(span('UTC 회의')).toEqual({ allDay: false, startsAt: '2026-12-08T01:00:00.000Z', endsAt: '2026-12-08T02:00:00.000Z' });
  });

  it('종일 매주 + 날짜만 쓴 UNTIL, EXDATE 는 WEEKLY 와 취소 예외', () => {
    const [weekly] = byTitle(result.events, '매주 목요일 종일');
    expect(weekly).toMatchObject({ allDay: true, repeat: 'WEEKLY', repeatUntil: '2026-12-31' });
    expect(weekly.exceptions.map((exception) => [exception.occurrence, exception.cancelled])).toEqual([['2026-12-17', true]]);
  });

  it('진짜 잘못된 날짜는 여전히 INVALID', () => {
    const bytes = ics(...vevent('UID:bad1', 'DTSTART:20261340', 'DTEND:20261341'), ...vevent('UID:bad2', 'DTSTART:2026111'));
    expect(plan(bytes).preview).toMatchObject({ toCreate: 0, skipped: [{ reason: 'INVALID', count: 2 }] });
  });
});

describe('손으로 만든 엣지', () => {
  const result = plan(Buffer.from(fixtureText('edge')));

  it('요약: 경고 2종, 중복 1, 지난 1, 너무 김 2, 못 읽음 2', () => {
    expect(result.preview).toMatchObject({
      total: 16,
      toCreate: 9,
      warnings: ['UNKNOWN_TZID', 'TRUNCATED_TITLE'],
      skipped: [
        { reason: 'DUPLICATE', count: 1 },
        { reason: 'TOO_OLD', count: 1 },
        { reason: 'TOO_LONG', count: 2 },
        { reason: 'INVALID', count: 2 },
      ],
    });
  });

  it('끝 없는 시간 일정은 1시간, 끝 없는 종일은 하루, 빈 제목은 "제목 없음"', () => {
    const [noEnd] = byTitle(result.events, '끝 없음');
    expect(noEnd.endsAt.getTime() - noEnd.startsAt.getTime()).toBe(60 * 60 * 1000);
    const [allDay] = byTitle(result.events, '끝 없는 종일');
    expect(allDay.endsAt.getTime() - allDay.startsAt.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(allDay.memo).toBe('접힌 줄이탭으로 이어집니다');
    expect(byTitle(result.events, '제목 없음')).toHaveLength(1);
  });

  it('30일 밖으로 옮긴 회차는 원본에서 취소하고 따로 넣고, 취소된 회차는 취소 예외', () => {
    const [meeting] = byTitle(result.events, '월요 회의');
    expect(meeting).toMatchObject({ repeat: 'WEEKLY', repeatUntil: '2026-12-28' });
    expect(meeting.exceptions.map((exception) => [exception.occurrence, exception.cancelled])).toEqual([
      ['2026-12-14', true],
      ['2026-12-21', true],
    ]);
    const [moved] = byTitle(result.events, '월요 회의 (멀리 옮김)');
    expect(moved).toMatchObject({ repeat: null, uidHash: sha256Hex('e11#2026-12-13T23:00:00.000Z') });
  });

  it('사용자 VTIMEZONE(서머타임 없음)의 매주는 WEEKLY 로 옮긴다', () => {
    expect(byTitle(result.events, '사용자 시간대 주간')[0]).toMatchObject({ repeat: 'WEEKLY' });
  });
});

describe('반복 옮기기 표', () => {
  const series = (dtstart: string, rule: string, extra: string[] = []) =>
    plan(ics(...vevent('UID:r', `DTSTART;TZID=Asia/Seoul:${dtstart}`, `DTEND;TZID=Asia/Seoul:${dtstart.slice(0, 9)}235900`, `RRULE:${rule}`, ...extra))).events;

  it.each([
    ['20261202T100000', 'FREQ=WEEKLY', 'WEEKLY'],
    ['20261202T100000', 'FREQ=WEEKLY;BYDAY=WE', 'WEEKLY'],
    ['20261202T100000', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE', 'BIWEEKLY'],
    ['20261202T100000', 'FREQ=MONTHLY', 'MONTHLY'],
    ['20261202T100000', 'FREQ=MONTHLY;BYMONTHDAY=2', 'MONTHLY'],
    ['20261228T100000', 'FREQ=MONTHLY', 'MONTHLY'],
    ['20261202T100000', 'FREQ=YEARLY', 'YEARLY'],
    ['20261202T100000', 'FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=2', 'YEARLY'],
  ])('%s %s → %s', (dtstart, rule, repeat) => {
    const events = series(dtstart, rule);
    expect(events).toHaveLength(1);
    expect(events[0].repeat).toBe(repeat);
  });

  it.each([
    ['20261202T100000', 'FREQ=DAILY;COUNT=3'],
    ['20261202T100000', 'FREQ=WEEKLY;BYDAY=WE,FR;COUNT=4'],
    ['20261202T100000', 'FREQ=WEEKLY;INTERVAL=3;COUNT=3'],
    ['20261208T100000', 'FREQ=MONTHLY;BYDAY=2TU;COUNT=3'],
    ['20261208T100000', 'FREQ=MONTHLY;BYSETPOS=2;BYDAY=TU;COUNT=3'],
    ['20261229T100000', 'FREQ=MONTHLY;COUNT=3'],
    ['20261202T100000', 'FREQ=MONTHLY;INTERVAL=2;COUNT=3'],
    ['20261202T100000', 'FREQ=YEARLY;INTERVAL=2;COUNT=1'],
  ])('%s %s → 펼침', (dtstart, rule) => {
    const events = series(dtstart, rule);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.repeat === null && event.source === 'EXPANDED')).toBe(true);
  });

  it('2/29 매년은 펼친다 (1년 안에 회차가 없으면 지난 일정)', () => {
    const result = plan(ics(...vevent('UID:leap', 'DTSTART;VALUE=DATE:20240229', 'RRULE:FREQ=YEARLY')));
    expect(result.events).toHaveLength(0);
    expect(result.preview.skipped).toEqual([{ reason: 'TOO_OLD', count: 1 }]);
  });

  it('COUNT 는 마지막 회차 날짜를 repeatUntil 로', () => {
    expect(series('20261202T100000', 'FREQ=WEEKLY;COUNT=3')[0].repeatUntil).toBe('2026-12-16');
    expect(series('20261202T100000', 'FREQ=MONTHLY;COUNT=3')[0].repeatUntil).toBe('2027-02-02');
  });

  it('UNTIL 은 그 순간 이전에 시작하는 마지막 회차 날짜 (UTC UNTIL 이 KST 로 다음 날이어도)', () => {
    // 12/16 10:00 KST = 01:00Z. UNTIL 12/16 00:59Z 면 12/16 회차는 빠진다
    expect(series('20261202T100000', 'FREQ=WEEKLY;UNTIL=20261216T005900Z')[0].repeatUntil).toBe('2026-12-09');
  });

  it('반복 주기보다 긴 일정은 TOO_LONG', () => {
    const result = plan(ics(...vevent('UID:w', 'DTSTART;VALUE=DATE:20261202', 'DTEND;VALUE=DATE:20261210', 'RRULE:FREQ=WEEKLY')));
    expect(result.preview.skipped).toEqual([{ reason: 'TOO_LONG', count: 1 }]);
  });

  it('시간 단위 반복과 RRULE 두 개는 INVALID', () => {
    const result = plan(ics(...vevent('UID:h', 'DTSTART:20261202T000000Z', 'RRULE:FREQ=MINUTELY')));
    expect(result.preview.skipped).toEqual([{ reason: 'INVALID', count: 1 }]);
  });

  it('RDATE 가 있으면 펼친다 (RRULE 없이 RDATE 만 있어도)', () => {
    const withRule = plan(ics(...vevent('UID:a', 'DTSTART:20261202T000000Z', 'RRULE:FREQ=WEEKLY;COUNT=2', 'RDATE:20261205T000000Z')));
    expect(withRule.events.map((event) => iso(event.startsAt))).toEqual(['2026-12-02T00:00:00.000Z', '2026-12-05T00:00:00.000Z', '2026-12-09T00:00:00.000Z']);
    const onlyRdate = plan(ics(...vevent('UID:b', 'DTSTART:20261202T000000Z', 'DTEND:20261202T010000Z', 'RDATE:20261205T000000Z,20261206T000000Z')));
    expect(onlyRdate.preview).toMatchObject({ toCreate: 3, expanded: 3, expandedSeries: 1 });
  });

  it('원본 없는 바뀐 회차는 한 번짜리로', () => {
    const result = plan(ics(...vevent('UID:o', 'RECURRENCE-ID:20261202T000000Z', 'DTSTART:20261203T000000Z', 'SUMMARY:혼자')));
    expect(result.events).toHaveLength(1);
    expect(result.events[0].uidHash).toBe(sha256Hex('o#2026-12-02T00:00:00.000Z'));
  });

  it('펼친 반복의 바뀐 회차는 그 회차를 대신하고, 취소된 회차는 빠진다', () => {
    const result = plan(
      ics(
        ...vevent('UID:d', 'DTSTART;TZID=Asia/Seoul:20261202T100000', 'DTEND;TZID=Asia/Seoul:20261202T110000', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:매일'),
        ...vevent('UID:d', 'RECURRENCE-ID;TZID=Asia/Seoul:20261203T100000', 'DTSTART;TZID=Asia/Seoul:20261203T150000', 'DTEND;TZID=Asia/Seoul:20261203T160000', 'SUMMARY:매일 (오후)'),
        ...vevent('UID:d', 'RECURRENCE-ID;TZID=Asia/Seoul:20261204T100000', 'DTSTART;TZID=Asia/Seoul:20261204T100000', 'STATUS:CANCELLED', 'SUMMARY:매일'),
      ),
    );
    expect(result.events.map((event) => [event.title, iso(event.startsAt)])).toEqual([
      ['매일', '2026-12-02T01:00:00.000Z'],
      ['매일 (오후)', '2026-12-03T06:00:00.000Z'],
    ]);
    expect(result.preview.skipped).toEqual([{ reason: 'CANCELLED', count: 1 }]);
  });

  it('반복으로 옮긴 회차는 ical.js 가 펼친 회차와 같다 (EXDATE 반영)', () => {
    for (const name of ['google', 'naver', 'timetree', 'timetree-1.0']) {
      const bytes = fixtureText(name);
      const kept = plan(bytes).events.filter((event) => event.source === 'KEPT');
      const root = new ICAL.Component(ICAL.parse(markBareDates(bytes.toString('utf8').replace(/\r\n[ \t]/g, ''))) as unknown[]);
      for (const event of kept) {
        const from = event.startsAt;
        const to = new Date(from.getTime() + 400 * 24 * 60 * 60 * 1000);
        const ours = expand(
          { startsAt: event.startsAt, endsAt: event.endsAt, allDay: event.allDay, repeat: event.repeat!, repeatUntil: event.repeatUntil },
          event.exceptions.filter((exception) => exception.cancelled),
          from,
          to,
        ).map((occurrence) => occurrence.occurrence);

        const vevent = root.getAllSubcomponents('vevent').find((component) => sha256Hex(String(component.getFirstPropertyValue('uid'))) === event.uidHash && !component.hasProperty('recurrence-id'))!;
        // ical.js 는 등록 안 된 TZID 를 떠 있는 시각으로 비교해 UNTIL 경계가 9시간 어긋난다. 끝은 우리 repeatUntil 로 자른다
        const recur = (vevent.getFirstPropertyValue('rrule') as ICAL.Recur).clone();
        recur.until = null;
        recur.count = null;
        const dtstart = vevent.getFirstPropertyValue('dtstart') as ICAL.Time;
        const iterator = recur.iterator(ICAL.Time.fromData({ year: dtstart.year, month: dtstart.month, day: dtstart.day, hour: dtstart.hour, minute: dtstart.minute, isDate: dtstart.isDate }));
        const excluded = new Set(event.exceptions.filter((exception) => exception.cancelled).map((exception) => exception.occurrence));
        const theirs: string[] = [];
        for (let next = iterator.next(); next; next = iterator.next()) {
          const date = next.isDate ? next.toString() : kstDate(new Date(Date.UTC(next.year, next.month - 1, next.day, next.hour - 9, next.minute)));
          if (date >= kstDate(to) || (event.repeatUntil !== null && date > event.repeatUntil)) break;
          if (date >= kstDate(from) && !excluded.has(date)) theirs.push(date);
        }
        expect({ name, title: event.title, dates: ours }).toEqual({ name, title: event.title, dates: theirs });
      }
    }
  });
});

describe('기간', () => {
  it('지난 1년을 고르면 1년 안 지난 일정도 넣는다', () => {
    const bytes = ics(...vevent('UID:p', 'DTSTART;TZID=Asia/Seoul:20260301T100000', 'DTEND;TZID=Asia/Seoul:20260301T110000'));
    expect(plan(bytes, 'future').preview.skipped).toEqual([{ reason: 'TOO_OLD', count: 1 }]);
    expect(plan(bytes, 'year').preview.toCreate).toBe(1);
  });

  it('전체(#314)는 아래 끝이 없다: 몇 년 전 일정과 반복도 넣고 TOO_OLD 가 없다', () => {
    const bytes = ics(
      ...vevent('UID:old', 'DTSTART;VALUE=DATE:20150301', 'DTEND;VALUE=DATE:20150302'),
      ...vevent('UID:p', 'DTSTART;TZID=Asia/Seoul:20260301T100000', 'DTEND;TZID=Asia/Seoul:20260301T110000'),
      ...vevent('UID:w', 'DTSTART;TZID=Asia/Seoul:20200106T100000', 'DTEND;TZID=Asia/Seoul:20200106T110000', 'RRULE:FREQ=WEEKLY;COUNT=3'),
    );
    expect(iso(importWindow('all', NOW).lo)).toBe('1899-12-31T15:00:00.000Z');
    expect(plan(bytes, 'year').preview.skipped).toEqual([{ reason: 'TOO_OLD', count: 2 }]);
    const all = plan(bytes, 'all');
    expect(all.preview.skipped).toEqual([]);
    expect(all.preview.toCreate).toBe(3);
    // 옮긴 반복은 원래 첫 회차 그대로
    expect(iso(all.events[0].startsAt)).toBe('2015-02-28T15:00:00.000Z');
    expect(all.events.find((event) => event.repeat === 'WEEKLY')!.startsAt.toISOString()).toBe('2020-01-06T01:00:00.000Z');
  });

  it('오늘 시작해 진행 중인 일정은 넣는다 (끝이 오늘 00:00 뒤)', () => {
    const bytes = ics(...vevent('UID:n', 'DTSTART;VALUE=DATE:20261110', 'DTEND;VALUE=DATE:20261112'));
    expect(plan(bytes).preview.toCreate).toBe(1);
  });
});

describe('중복과 상한', () => {
  it('이미 넣은 해시는 DUPLICATE', () => {
    const bytes = fixtureText('naver');
    const first = plan(bytes);
    const again = plan(bytes, 'future', new Set(first.events.map((event) => event.uidHash)));
    expect(again.preview.toCreate).toBe(0);
    expect(again.preview.skipped).toEqual([{ reason: 'DUPLICATE', count: 13 }]);
  });

  it(`${IMPORT_MAX_EVENTS}개 넘는 것은 시작 순으로 잘라 OVER_LIMIT`, () => {
    const lines: string[] = [];
    for (let i = 0; i < IMPORT_MAX_EVENTS + 5; i += 1) {
      const start = new Date(Date.UTC(2026, 11, 1) + i * 3600_000).toISOString().replace(/[-:]/g, '').slice(0, 15);
      lines.push(...vevent(`UID:${i}`, `DTSTART:${start}Z`));
    }
    const result = plan(ics(...lines));
    expect(result.events).toHaveLength(IMPORT_MAX_EVENTS);
    expect(result.preview.skipped).toEqual([{ reason: 'OVER_LIMIT', count: 5 }]);
    expect(iso(result.events[0].startsAt)).toBe('2026-12-01T00:00:00.000Z');
  });

  it('UID 없는 일정은 (제목, 시작, 끝) 으로 같은 파일 안 중복을 거른다', () => {
    const one = vevent('DTSTART:20261201T000000Z', 'DTEND:20261201T010000Z', 'SUMMARY:같음');
    const result = plan(ics(...one, ...one));
    expect(result.preview.toCreate).toBe(1);
    expect(result.events[0].uidHash).toBe(sha256Hex('~같음|2026-12-01T00:00:00.000Z|2026-12-01T01:00:00.000Z'));
  });
});

describe('골라서 넣기 (#314)', () => {
  it('items 는 넣을 일정 전부(시작 순)이고 key 는 중복 방지 해시와 같다', () => {
    const result = plan(fixtureText('google'));
    expect(result.preview.items).toHaveLength(result.preview.toCreate);
    expect(result.preview.items.map((item) => item.key)).toEqual(result.events.map((event) => event.uidHash));
    expect(new Set(result.preview.items.map((item) => item.key)).size).toBe(result.preview.items.length);
    const first = result.events[0];
    expect(result.preview.items[0]).toEqual({
      key: first.uidHash,
      title: first.title,
      startsAt: first.startsAt,
      endsAt: first.endsAt,
      allDay: first.allDay,
      repeat: first.repeat,
    });
    // 예시 5개는 옛 웹을 위해 그대로
    expect(result.preview.sample).toHaveLength(5);
  });

  it('OVER_LIMIT 이면 items 도 1,000개까지', () => {
    const lines: string[] = [];
    for (let i = 0; i < IMPORT_MAX_EVENTS + 3; i += 1) {
      const start = new Date(Date.UTC(2026, 11, 1) + i * 3600_000).toISOString().replace(/[-:]/g, '').slice(0, 15);
      lines.push(...vevent(`UID:${i}`, `DTSTART:${start}Z`));
    }
    expect(plan(ics(...lines)).preview.items).toHaveLength(IMPORT_MAX_EVENTS);
  });

  it('selectEvents: include 가 없으면 전부, 있으면 그 키만, 모르는 키는 무시', () => {
    const result = plan(fixtureText('naver'));
    expect(selectEvents(result, undefined)).toBe(result);
    const keys = result.events.map((event) => event.uidHash);
    const picked = selectEvents(result, [keys[0], keys[2], sha256Hex('없는 일정')]);
    expect(picked.events.map((event) => event.uidHash)).toEqual([keys[0], keys[2]]);
    // 미리보기 값(건너뜀 수 등)은 그대로. 뺀 일정은 건너뜀으로 세지 않는다
    expect(picked.preview).toBe(result.preview);
    expect(selectEvents(result, [sha256Hex('없는 일정')]).events).toEqual([]);
  });
});

describe('성능 상한', () => {
  it('COUNT 없는 오래된 매일, 매주 반복은 시작을 당겨 돌아도 회차 날짜가 같다', () => {
    const result = plan(
      ics(
        ...vevent('UID:d3', 'DTSTART;VALUE=DATE:19900101', 'RRULE:FREQ=DAILY;INTERVAL=3', 'SUMMARY:사흘마다'),
        ...vevent('UID:w3', 'DTSTART;VALUE=DATE:19900103', 'RRULE:FREQ=WEEKLY;INTERVAL=3;BYDAY=WE,FR', 'SUMMARY:3주마다'),
      ),
    );
    expect(result.preview.skipped).toEqual([]);
    const dayNumber = (event: PlannedEvent) => Date.parse(`${kstDate(event.startsAt)}T00:00:00Z`) / 86_400_000;
    const epoch = Date.UTC(1990, 0, 1) / 86_400_000;
    const daily = byTitle(result.events, '사흘마다');
    expect(daily.length).toBe(122);
    expect(kstDate(daily[0].startsAt) >= '2026-11-11').toBe(true);
    expect(daily.every((event) => (dayNumber(event) - epoch) % 3 === 0)).toBe(true);
    const weekly = byTitle(result.events, '3주마다');
    expect(weekly.length).toBeGreaterThan(30);
    expect(weekly.every((event) => [0, 2].includes((dayNumber(event) - epoch - 2) % 21))).toBe(true);
  });

  it('당길 수 없는 오래된 반복(COUNT)이 많아도 파일 걸음 상한에서 멈추고 나머지는 INVALID', () => {
    const lines: string[] = [];
    for (let i = 0; i < 40; i += 1) lines.push(...vevent(`UID:d${i}`, 'DTSTART;VALUE=DATE:19900101', 'RRULE:FREQ=DAILY;COUNT=99999'));
    const started = performance.now();
    const result = plan(ics(...lines));
    expect(performance.now() - started).toBeLessThan(5000);
    expect(result.preview.skipped.find((skip) => skip.reason === 'INVALID')?.count).toBeGreaterThan(0);
  });
});
