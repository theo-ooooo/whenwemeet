import { readFileSync } from 'node:fs';
import { ApiException } from '../common/errors.js';
import {
  ICS_MAX_BYTES,
  ICS_MAX_VEVENTS,
  INVALID_START,
  instantOf,
  markBareDates,
  parseIcs,
  unfoldBytes,
} from './ics-parse.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/ics/${name}.ics`, import.meta.url));
const ics = (...lines: string[]) =>
  Buffer.from(
    ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR', ''].join(
      '\r\n',
    ),
  );

function errorOf(fn: () => unknown): ApiException {
  try {
    fn();
  } catch (error) {
    return error as ApiException;
  }
  throw new Error('예외가 나야 해요');
}

describe('unfoldBytes', () => {
  it('UTF-8 글자 중간에서 접힌 줄도 바이트 단계에서 이어 붙인다', () => {
    const bytes = Buffer.from('SUMMARY:한글', 'utf8');
    // '한'(3바이트) 의 둘째 바이트 앞에서 접는다
    const folded = Buffer.concat([
      bytes.subarray(0, 9),
      Buffer.from('\r\n '),
      bytes.subarray(9),
    ]);
    expect(unfoldBytes(folded).toString('utf8')).toBe('SUMMARY:한글');
    expect(unfoldBytes(Buffer.from('A:b\n\tc')).toString()).toBe('A:bc');
  });
});

describe('markBareDates (#309)', () => {
  it('VALUE=DATE 없이 날짜만 쓴 DTSTART, DTEND, EXDATE, RDATE, RECURRENCE-ID 에 VALUE=DATE 를 붙인다', () => {
    const input = [
      'DTSTART:20261112',
      'dtend:20261113\r',
      'EXDATE:20261114,20261121',
      'RDATE:20261115',
      'RECURRENCE-ID:20261116',
      'DTSTART;TZID=Asia/Seoul:20261117',
    ].join('\n');
    expect(markBareDates(input).split('\n')).toEqual([
      'DTSTART;VALUE=DATE:20261112',
      'dtend;VALUE=DATE:20261113\r',
      'EXDATE;VALUE=DATE:20261114,20261121',
      'RDATE;VALUE=DATE:20261115',
      'RECURRENCE-ID;VALUE=DATE:20261116',
      'DTSTART;TZID=Asia/Seoul;VALUE=DATE:20261117',
    ]);
  });

  it('VALUE 를 적은 줄, 시각이 있는 값, 달력에 없는 날, 다른 속성은 건드리지 않는다', () => {
    const untouched = [
      'DTSTART;VALUE=DATE:20261112',
      'DTSTART;VALUE=DATE-TIME:20261112',
      'DTSTART:20261112T090000Z',
      'DTSTART;TZID=Asia/Seoul:20261112T090000',
      'DTSTART:2026111',
      'DTSTART:202611120',
      'DTSTART:20261340',
      'DTEND:20260230',
      'EXDATE:20261114,2026111',
      'DTSTAMP:20261112',
      'DESCRIPTION:20261112',
      'X-DTSTART:20261112',
    ].join('\n');
    expect(markBareDates(untouched)).toBe(untouched);
  });
});

describe('parseIcs', () => {
  it('구글 내보내기: 접힌 줄, 이스케이프, TZID, UTC, 종일, 반복, EXDATE, RECURRENCE-ID', () => {
    const { events, veventCount } = parseIcs(fixture('google'));
    expect(veventCount).toBe(9);
    const dentist = events.find((event) => event.uid === 'dentist@google.com')!;
    expect(dentist.location).toBe('서울시 강남구 테헤란로 1, 2층');
    expect(dentist.description).toContain('늦으면 전화 주세요\n전화는');
    expect(dentist.description).toContain('접힌 줄 확인용 긴 설명입니다.');
    expect(instantOf(dentist.start).toISOString()).toBe(
      '2026-11-20T01:00:00.000Z',
    );

    const study = events.find(
      (event) => event.uid === 'weekly-study@google.com' && !event.recurrenceId,
    )!;
    expect(study.rule?.freq).toBe('WEEKLY');
    expect(study.rule?.parts).toEqual({ BYDAY: ['TU'] });
    expect(study.exdates.map((time) => instantOf(time).toISOString())).toEqual([
      '2026-11-17T10:00:00.000Z',
    ]);
    const moved = events.find((event) => event.recurrenceId)!;
    expect(instantOf(moved.recurrenceId!).toISOString()).toBe(
      '2026-11-24T10:00:00.000Z',
    );

    const birthday = events.find(
      (event) => event.uid === 'mom-birthday@google.com',
    )!;
    expect(birthday.start).toMatchObject({ allDay: true, date: '1995-03-15' });
  });

  it('애플 내보내기: VALARM, ATTENDEE 는 무시하고 DURATION 과 떠 있는 시각을 읽는다', () => {
    const { events } = parseIcs(fixture('apple'));
    expect(events).toHaveLength(4);
    const meeting = events.find((event) => event.summary === '분기 회의')!;
    expect(meeting.durationSec).toBe(5400);
    const floating = events.find((event) => event.summary === '떠 있는 시각')!;
    expect(instantOf(floating.start).toISOString()).toBe(
      '2026-12-05T01:00:00.000Z',
    );
  });

  it('timetree-exporter 모양: VTIMEZONE 없는 TZID 는 Intl 로 읽는다', () => {
    const { events } = parseIcs(fixture('timetree'));
    const date = events.find((event) => event.summary === '데이트')!;
    expect(instantOf(date.start).toISOString()).toBe(
      '2026-11-14T04:00:00.000Z',
    );
    expect(date.unknownTzid).toBe(false);
  });

  it('timetree-exporter 1.0.0 모양(#309): VALUE=DATE 없는 날짜는 종일, 시각은 TZID 와 UTC 로 읽는다', () => {
    const { events, veventCount } = parseIcs(fixture('timetree-1.0'));
    expect(veventCount).toBe(8);
    expect(events.filter((event) => event.start === INVALID_START)).toEqual([]);
    const trip = events.find((event) => event.summary === '사흘 여행')!;
    expect(trip.start).toMatchObject({ allDay: true, date: '2026-11-25' });
    expect(trip.end).toMatchObject({ allDay: true, date: '2026-11-28' });
    expect(events.find((event) => event.summary === '끝 없음')!.end).toBeNull();
    const dinner = events.find((event) => event.summary === '저녁 약속')!;
    expect(dinner.start).toMatchObject({
      allDay: false,
      zone: { type: 'IANA', name: 'Asia/Seoul' },
    });
    expect(instantOf(dinner.start).toISOString()).toBe(
      '2026-12-07T10:00:00.000Z',
    );
    const utc = events.find((event) => event.summary === 'UTC 회의')!;
    expect(instantOf(utc.start).toISOString()).toBe('2026-12-08T01:00:00.000Z');
    const weekly = events.find(
      (event) => event.summary === '매주 목요일 종일',
    )!;
    expect(weekly.exdates).toEqual([
      expect.objectContaining({ allDay: true, date: '2026-12-17' }),
    ]);
  });

  it('VALUE=DATE 없는 RECURRENCE-ID 도 날짜로 읽는다 (#309)', () => {
    const { events } = parseIcs(
      ics(
        'BEGIN:VEVENT',
        'UID:r',
        'DTSTART:20261211',
        'DTEND:20261212',
        'RECURRENCE-ID:20261210',
        'END:VEVENT',
      ),
    );
    expect(events[0].recurrenceId).toMatchObject({
      allDay: true,
      date: '2026-12-10',
    });
  });

  it('진짜 잘못된 날짜 값은 여전히 못 읽음 (#309)', () => {
    for (const value of [
      'DTSTART:2026111',
      'DTSTART:20261340',
      'DTSTART;VALUE=DATE-TIME:20261112',
      'DTSTART:2026-11-12',
    ]) {
      const { events } = parseIcs(
        ics('BEGIN:VEVENT', 'UID:x', value, 'END:VEVENT'),
      );
      expect({ value, start: events[0].start }).toEqual({
        value,
        start: INVALID_START,
      });
    }
  });

  it('모르는 TZID 는 KST 로 보고 표시, 사용자 VTIMEZONE 은 그 정의로', () => {
    const { events } = parseIcs(fixture('edge'));
    const unknown = events.find((event) => event.uid === 'e1')!;
    expect(unknown.unknownTzid).toBe(true);
    expect(instantOf(unknown.start).toISOString()).toBe(
      '2026-12-01T01:00:00.000Z',
    );
    const custom = events.find((event) => event.uid === 'e2')!;
    expect(custom.start).toMatchObject({
      allDay: false,
      zone: { type: 'VTIMEZONE', fixed: true },
    });
    expect(instantOf(custom.start).toISOString()).toBe(
      '2026-12-02T00:00:00.000Z',
    );
  });

  it('BOM 이 있어도 읽는다', () => {
    const body = ics(
      'BEGIN:VEVENT',
      'UID:a',
      'DTSTART:20261201T000000Z',
      'END:VEVENT',
    );
    expect(
      parseIcs(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body])).events,
    ).toHaveLength(1);
  });

  it('빈 파일, 캘린더가 아닌 파일, 깨진 파일, 2MB 초과는 VALIDATION_FAILED(file)', () => {
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.from('hello'),
      Buffer.from('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n'),
      Buffer.alloc(ICS_MAX_BYTES + 1, 'a'),
    ]) {
      const error = errorOf(() => parseIcs(bytes));
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual([
        { field: 'file', message: expect.any(String) },
      ]);
    }
  });

  it(`VEVENT 가 ${ICS_MAX_VEVENTS}개를 넘으면 IMPORT_TOO_LARGE`, () => {
    const lines: string[] = [];
    for (let i = 0; i <= ICS_MAX_VEVENTS; i += 1)
      lines.push(
        'BEGIN:VEVENT',
        `UID:${i}`,
        'DTSTART:20261201T000000Z',
        'END:VEVENT',
      );
    expect(errorOf(() => parseIcs(ics(...lines))).code).toBe(
      'IMPORT_TOO_LARGE',
    );
  });

  it('DTSTART 가 없는 VEVENT 는 시작을 못 읽은 표시로 남긴다 (계획에서 INVALID)', () => {
    const { events } = parseIcs(
      ics('BEGIN:VEVENT', 'UID:x', 'SUMMARY:없음', 'END:VEVENT'),
    );
    expect(events[0].start).toMatchObject({ date: '0000-00-00' });
  });

  it('RRULE 이 둘이면 옮길 수 없음 표시', () => {
    const { events } = parseIcs(
      ics(
        'BEGIN:VEVENT',
        'UID:x',
        'DTSTART:20261201T000000Z',
        'RRULE:FREQ=DAILY',
        'RRULE:FREQ=WEEKLY',
        'END:VEVENT',
      ),
    );
    expect(events[0].ruleUnsupported).toBe(true);
  });
});
