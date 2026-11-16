import {
  cleanText,
  filterByDays,
  hasUrl,
  isMentioned,
  isRealDate,
  kstToDate,
  matchName,
  type NormalizeContext,
  NormalizeProblem,
  normalizeDraftEvent,
  normalizeDraftPoll,
  normalizeFindAnniversary,
  normalizeFreeTime,
  normalizeListEvents,
  normalizePeriod,
  resolveParticipants,
  saysEveryone,
  durationEnd,
  forcedEveryone,
  spokenDuration,
  spokenWeek,
  truncate,
  weekdayIsName,
} from './normalize.js';
import { NO_WHEN, type WhenArg } from './when.js';

/** 2026-11-16 (월) 14:05 KST */
const NOW = new Date('2026-11-16T05:05:00.000Z');
const person = (userId: number, displayName: string, nickname = displayName) => ({
  userId,
  displayName,
  nickname,
  member: { userId, displayName, color: '#F26D6D', profileImageUrl: null },
});
const context = (overrides: Partial<NormalizeContext> = {}): NormalizeContext => ({
  now: NOW,
  userId: 1,
  personal: false,
  members: [person(1, '민지'), person(2, '하늘'), person(3, '지훈', 'Jihoon'), person(4, '은', '은')],
  // 이름 확인(D-277)과 상관없는 시험은 모든 이름과 전원 말이 나온 글로 본다
  spoken: '민지 하늘이 지훈 jihoon 은 철수 다 같이',
  // 이번 글로 직접 읽는 안전장치(D-278)와 상관없는 시험은 빈 글
  text: '',
  ...overrides,
});

/** 날짜 표현 (#458). 글자를 주면 연도까지 말한 날짜(kind date) */
const on = (date: string): WhenArg => ({ ...NO_WHEN, kind: 'date', date });
const asWhen = (value: unknown): unknown => (typeof value === 'string' ? on(value) : value === null ? NO_WHEN : value);
const withWhen = (overrides: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, keys.includes(k) ? asWhen(v) : v]));

const event = (overrides: Record<string, unknown> = {}) => ({
  title: '회식',
  date: on('2026-11-27'),
  startTime: '19:00',
  endDate: NO_WHEN,
  endTime: null,
  allDay: false,
  place: null,
  participants: [],
  everyone: false,
  includeMe: true,
  ...withWhen(overrides, ['date', 'endDate']),
});

/** 던진 문제 */
function problemOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof NormalizeProblem) return error.problem;
    throw error;
  }
  throw new Error('문제가 없었다');
}

describe('글자', () => {
  it('cleanText: 줄바꿈, 제어 문자를 공백 하나로, 앞뒤 공백 제거 / hasUrl / truncate 는 코드 포인트', () => {
    expect(cleanText('  강남\n회식\t\u0007 ')).toBe('강남 회식');
    expect(cleanText('a b')).toBe('a b');
    expect(hasUrl('HTTPS://x')).toBe(true);
    expect(hasUrl('www.naver.com')).toBe(true);
    expect(hasUrl('강남역')).toBe(false);
    expect(truncate('😀😀😀', 2)).toBe('😀😀');
    expect(truncate('abc', 5)).toBe('abc');
  });

  it('날짜: 있는 날짜만, KST → UTC, 24:00 은 다음 날 0시', () => {
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(kstToDate('2026-11-27', '19:00').toISOString()).toBe('2026-11-27T10:00:00.000Z');
    expect(kstToDate('2026-11-27', '24:00').toISOString()).toBe('2026-11-27T15:00:00.000Z');
  });
});

describe('참여자 이름 (D-268)', () => {
  const ctx = context();
  const one = (name: string) => {
    const match = matchName(name, ctx);
    return match.kind === 'one' ? match.member.userId : match.kind;
  };

  it('① 나, 저, 내 → 요청자 ② 표시 이름, 닉네임(대소문자, 공백 무시) ③ 님 ④ 받침 + 이', () => {
    expect(one('나')).toBe(1);
    expect(one('저')).toBe(1);
    expect(one('내')).toBe(1);
    expect(one(' 하 늘 ')).toBe(2);
    expect(one('jihoon')).toBe(3);
    expect(one('하늘님')).toBe(2);
    expect(one('하늘이')).toBe(2);
    expect(one('하늘이님')).toBe(2);
    expect(one('지훈이')).toBe(3);
    // 받침 없는 이름 + 이 는 떼지 않는다
    expect(one('민지이')).toBe('none');
    expect(one('철수')).toBe('none');
  });

  it('앞 단계에서 맞으면 멈춘다: "은" 이 이름이면 "은이" 는 ④ 로 "은"', () => {
    expect(one('은')).toBe(4);
    expect(one('은이')).toBe(4);
  });

  it('여럿이 맞으면 many', () => {
    const twins = context({ members: [person(1, '민지'), person(2, '하늘'), person(5, '하늘')] });
    expect(matchName('하늘', twins)).toMatchObject({ kind: 'many', members: [{ userId: 2 }, { userId: 5 }] });
    expect(problemOf(() => resolveParticipants({ participants: ['하늘'], everyone: false, includeMe: true }, 'me', twins))).toMatchObject({
      kind: 'clarify',
      field: 'participant',
      name: '하늘',
      choices: [{ userId: 2 }, { userId: 5 }],
    });
  });

  it('참여자: everyone(또는 "모두" 라는 이름) = 전원, 이름 + includeMe, 기본은 일정 나 / 빈 시간 전원, 개인 팀은 늘 나', () => {
    const input = (participants: string[], everyone = false, includeMe = true) => ({ participants, everyone, includeMe });
    expect(resolveParticipants(input([], true), 'me', ctx)).toEqual([1, 2, 3, 4]);
    expect(resolveParticipants(input(['모두']), 'me', ctx)).toEqual([1, 2, 3, 4]);
    expect(resolveParticipants(input(['지훈', '하늘']), 'me', ctx)).toEqual([1, 2, 3]);
    expect(resolveParticipants(input(['하늘'], false, false), 'me', ctx)).toEqual([2]);
    expect(resolveParticipants(input([' ']), 'me', ctx)).toEqual([1]);
    expect(resolveParticipants(input([]), 'all', ctx)).toEqual([1, 2, 3, 4]);
    expect(resolveParticipants(input(['하늘'], true), 'all', context({ personal: true }))).toEqual([1]);
    expect(problemOf(() => resolveParticipants(input(['철수']), 'me', ctx))).toEqual({ kind: 'clarify', field: 'participant', name: '철수' });
  });
});

describe('draft_event', () => {
  const ctx = context();

  it('끝 없음 = +1시간, 끝 <= 시작이고 끝 날짜 없음 = 다음 날(밤샘), 끝 날짜 있으면 그날', () => {
    expect(normalizeDraftEvent(event(), ctx)).toMatchObject({ startsAt: '2026-11-27T10:00:00.000Z', endsAt: '2026-11-27T11:00:00.000Z', allDay: false, participants: [1] });
    expect(normalizeDraftEvent(event({ startTime: '22:00', endTime: '02:00' }), ctx)).toMatchObject({ endsAt: '2026-11-27T17:00:00.000Z' });
    expect(normalizeDraftEvent(event({ endDate: '2026-11-28', endTime: '10:00' }), ctx)).toMatchObject({ endsAt: '2026-11-28T01:00:00.000Z' });
  });

  it('종일: 시각 무시, KST 자정 경계, 여러 날', () => {
    expect(normalizeDraftEvent(event({ allDay: true, startTime: '10:00' }), ctx)).toMatchObject({ startsAt: '2026-11-26T15:00:00.000Z', endsAt: '2026-11-27T15:00:00.000Z', allDay: true });
    expect(normalizeDraftEvent(event({ allDay: true, endDate: '2026-11-29' }), ctx)).toMatchObject({ endsAt: '2026-11-29T15:00:00.000Z' });
  });

  it('되묻기: 시각 없음(time), 30일 초과, 끝 < 시작(time), 날짜 범위 밖(date), 빈 제목(title)', () => {
    expect(problemOf(() => normalizeDraftEvent(event({ startTime: null }), ctx))).toEqual({ kind: 'clarify', field: 'time' });
    expect(problemOf(() => normalizeDraftEvent(event({ allDay: true, endDate: '2027-01-30' }), ctx))).toEqual({ kind: 'clarify', field: 'time' });
    expect(problemOf(() => normalizeDraftEvent(event({ endDate: '2026-11-26', endTime: '10:00' }), ctx))).toEqual({ kind: 'clarify', field: 'time' });
    expect(problemOf(() => normalizeDraftEvent(event({ date: '2025-11-15' }), ctx))).toEqual({ kind: 'clarify', field: 'date' });
    expect(problemOf(() => normalizeDraftEvent(event({ date: '2028-11-16' }), ctx))).toEqual({ kind: 'clarify', field: 'date' });
    expect(problemOf(() => normalizeDraftEvent(event({ date: '2026-02-30' }), ctx))).toEqual({ kind: 'clarify', field: 'date' });
    expect(problemOf(() => normalizeDraftEvent(event({ title: ' \n ' }), ctx))).toEqual({ kind: 'clarify', field: 'title' });
  });

  it('제목 50자, 장소 100자에서 자르고 URL 은 형식 실패, 빈 장소는 null', () => {
    const draft = normalizeDraftEvent(event({ title: '가'.repeat(60), place: '나'.repeat(120) }), ctx);
    expect(draft.title).toHaveLength(50);
    expect(draft.place?.text).toHaveLength(100);
    expect(normalizeDraftEvent(event({ place: '  ' }), ctx).place).toBeNull();
    expect(problemOf(() => normalizeDraftEvent(event({ title: 'www.evil.example' }), ctx))).toEqual({ kind: 'invalid' });
    expect(problemOf(() => normalizeDraftEvent(event({ place: 'http://evil' }), ctx))).toEqual({ kind: 'invalid' });
  });

  it('카드의 members 는 참여자 표시 정보 (가입순)', () => {
    expect(normalizeDraftEvent(event({ participants: ['하늘이'] }), ctx).members.map((m) => m.displayName)).toEqual(['민지', '하늘']);
  });
});

describe('기간, 빈 시간', () => {
  const free = (overrides: Record<string, unknown> = {}) => ({
    from: on('2026-11-16'),
    to: on('2026-11-22'),
    days: 'all' as const,
    dayStart: null,
    dayEnd: null,
    minMinutes: null,
    participants: [],
    everyone: false,
    includeMe: true,
    next: 'show' as const,
    purpose: null,
    ...withWhen(overrides, ['from', 'to']),
  });

  it('기간 1~31일, 거꾸로나 너무 먼 날짜는 clarify(period)', () => {
    expect(normalizePeriod('2026-11-16', '2026-11-16', 31, '2026-11-16')).toMatchObject({ from: new Date('2026-11-15T15:00:00Z'), to: new Date('2026-11-16T15:00:00Z') });
    expect(problemOf(() => normalizePeriod('2026-11-16', '2026-12-17', 31, '2026-11-16'))).toEqual({ kind: 'clarify', field: 'period' });
    expect(problemOf(() => normalizePeriod('2026-11-20', '2026-11-16', 31, '2026-11-16'))).toEqual({ kind: 'clarify', field: 'period' });
    expect(problemOf(() => normalizePeriod('2026-13-01', '2026-11-16', 31, '2026-11-16'))).toEqual({ kind: 'clarify', field: 'period' });
    expect(problemOf(() => normalizePeriod('2029-01-01', '2029-01-02', 31, '2026-11-16'))).toEqual({ kind: 'clarify', field: 'period' });
  });

  it('기본 09:00~23:00, 120분, 30~720 으로 자름, 기본 대상 전원, 개인 팀은 투표 없음, 목적은 투표 제목(URL, 줄바꿈이면 버림)', () => {
    expect(normalizeFreeTime(free(), context())).toMatchObject({ dayStart: '09:00', dayEnd: '23:00', minMinutes: 120, participants: [1, 2, 3, 4], poll: false, pollTitle: null });
    expect(normalizeFreeTime(free({ minMinutes: 5 }), context()).minMinutes).toBe(30);
    expect(normalizeFreeTime(free({ minMinutes: 9999 }), context()).minMinutes).toBe(720);
    expect(normalizeFreeTime(free({ next: 'poll', purpose: ' 저녁 약속 ' }), context())).toMatchObject({ poll: true, pollTitle: '저녁 약속' });
    expect(normalizeFreeTime(free({ next: 'poll' }), context({ personal: true })).poll).toBe(false);
    expect(normalizeFreeTime(free({ purpose: 'www.x.com' }), context()).pollTitle).toBeNull();
    expect(normalizeFreeTime(free({ purpose: '저녁\n약속' }), context()).pollTitle).toBeNull();
    expect(normalizeFreeTime(free({ dayEnd: '24:00', dayStart: '20:00' }), context())).toMatchObject({ dayStart: '20:00', dayEnd: '24:00' });
    expect(problemOf(() => normalizeFreeTime(free({ dayStart: '22:00', dayEnd: '18:00' }), context()))).toEqual({ kind: 'clarify', field: 'period' });
  });

  it('요일 거르기: 주말 = KST 토, 일 / 평일 = 월~금', () => {
    const at = (iso: string) => ({ startsAt: new Date(iso), endsAt: new Date(iso) });
    const slots = [at('2026-11-20T15:30:00Z'), at('2026-11-20T10:00:00Z'), at('2026-11-22T10:00:00Z')]; // 토 00:30, 금, 일
    expect(filterByDays(slots, 'weekend')).toEqual([slots[0], slots[2]]);
    expect(filterByDays(slots, 'weekday')).toEqual([slots[1]]);
    expect(filterByDays(slots, 'all')).toEqual(slots);
  });
});

describe('draft_poll, list_events, find_anniversary', () => {
  const options = [
    { date: on('2026-11-22'), startTime: '18:00', endTime: '20:00' },
    { date: on('2026-11-21'), startTime: '18:00', endTime: '20:00' },
  ];
  const list = (fromDate: string, toDate: string, member: string | null) => ({ from: on(fromDate), to: on(toDate), member });

  it('투표: 시작 순 정렬, 대상 기본 전원, 개인 팀은 team_only, 중복이나 끝 <= 시작은 clarify(period)', () => {
    const draft = normalizeDraftPoll({ title: '약속', options, participants: [], everyone: false }, context());
    expect(draft.options.map((o) => o.startsAt)).toEqual(['2026-11-21T09:00:00.000Z', '2026-11-22T09:00:00.000Z']);
    expect(draft.participants).toEqual([1, 2, 3, 4]);
    expect(normalizeDraftPoll({ title: '약속', options, participants: ['하늘'], everyone: false }, context()).participants).toEqual([1, 2]);
    expect(problemOf(() => normalizeDraftPoll({ title: '약속', options, participants: [], everyone: true }, context({ personal: true })))).toEqual({ kind: 'unsupported', action: 'team_only' });
    expect(problemOf(() => normalizeDraftPoll({ title: '약속', options: [options[0], options[0]], participants: [], everyone: true }, context()))).toEqual({ kind: 'clarify', field: 'period' });
    expect(problemOf(() => normalizeDraftPoll({ title: '약속', options: [{ ...options[0], endTime: '17:00' }, options[1]], participants: [], everyone: true }, context()))).toEqual({
      kind: 'clarify',
      field: 'period',
    });
  });

  it('일정 찾기: 사람 이름은 id 로, 없으면 null, 못 찾으면 clarify(participant)', () => {
    expect(normalizeListEvents(list('2026-11-15', '2026-11-21', '하늘이'), context())).toMatchObject({ memberId: 2, fromDate: '2026-11-15' });
    expect(normalizeListEvents(list('2026-11-15', '2026-11-21', ' '), context()).memberId).toBeNull();
    expect(problemOf(() => normalizeListEvents(list('2026-11-15', '2026-11-21', '철수'), context()))).toMatchObject({ field: 'participant' });
  });

  it('기념일: 기간 없으면 오늘부터 1년, 검색어 20자', () => {
    expect(normalizeFindAnniversary({ keyword: null, from: NO_WHEN, to: NO_WHEN }, context())).toMatchObject({ fromDate: '2026-11-16', toDate: '2027-11-16', keyword: null });
    expect(normalizeFindAnniversary({ keyword: '가'.repeat(30), from: on('2026-12-01'), to: NO_WHEN }, context())).toMatchObject({ toDate: '2027-12-01', keyword: '가'.repeat(20) });
    expect(normalizeFindAnniversary({ keyword: ' ', from: NO_WHEN, to: NO_WHEN }, context()).keyword).toBeNull();
  });
});

describe('(#458) 운영 재현: 날짜 표현과 말한 사람만 (D-276, D-277)', () => {
  // 2인 팀 "경"(나), "김수경". 2026-11-16 (월) 14:05
  const team = (spoken: string) =>
    context({ userId: 1, members: [person(1, '경'), person(2, '김수경')], spoken, text: spoken });
  const weekdayWhen = (weekday: WhenArg['weekday'], which: WhenArg['which']): WhenArg => ({ ...NO_WHEN, kind: 'weekday', weekday, which });
  const draft = (date: WhenArg, extra: Record<string, unknown> = {}) => ({
    ...event({ title: '강남 회식', place: '강남' }),
    date,
    participants: ['나', '김수경'],
    everyone: true,
    ...extra,
  });

  it('"다음 주 금요일 7시 강남 회식 잡아줘" → 11-27 (금) 19:00, 모델이 김수경과 everyone 을 넣어도 나만', () => {
    const card = normalizeDraftEvent(draft(weekdayWhen('금', 'next')), team('다음 주 금요일 7시 강남 회식 잡아줘'));
    expect(card).toMatchObject({ startsAt: '2026-11-27T10:00:00.000Z', endsAt: '2026-11-27T11:00:00.000Z', participants: [1] });
  });

  it('"이번 주 금요일 저녁 7시 강남 회식" → 11-20 (금), 나만', () => {
    const card = normalizeDraftEvent(draft(weekdayWhen('금', 'this')), team('이번 주 금요일 저녁 7시 강남 회식'));
    expect(card).toMatchObject({ startsAt: '2026-11-20T10:00:00.000Z', participants: [1] });
  });

  it('"11월 27일 금요일 저녁 7시 강남 회식" → 11-27, 나만', () => {
    const when: WhenArg = { ...NO_WHEN, kind: 'monthDay', month: 11, day: 27, weekday: '금' };
    expect(normalizeDraftEvent(draft(when), team('11월 27일 금요일 저녁 7시 강남 회식'))).toMatchObject({ startsAt: '2026-11-27T10:00:00.000Z', participants: [1] });
  });

  it('이름을 말하면 그 사람 + 나: "수경이랑" 은 성 뗀 이름으로 김수경, "다 같이" 면 전원', () => {
    expect(normalizeDraftEvent(draft(weekdayWhen('금', 'next'), { everyone: false }), team('다음 주 금요일 7시 수경이랑 회식')).participants).toEqual([1, 2]);
    expect(normalizeDraftEvent(draft(weekdayWhen('금', 'next'), { participants: [] }), team('다음 주 금요일 7시 다 같이 회식')).participants).toEqual([1, 2]);
  });

  it('"이번 주 일요일"(이미 지난 날)은 초안에서 되묻는다, 날짜를 말하지 않으면 되묻는다', () => {
    expect(problemOf(() => normalizeDraftEvent(draft(weekdayWhen('일', 'this')), team('이번 주 일요일 7시')))).toEqual({ kind: 'clarify', field: 'date' });
    expect(problemOf(() => normalizeDraftEvent(draft(NO_WHEN), team('7시 회식')))).toEqual({ kind: 'clarify', field: 'date' });
  });

  it('요일만 말하고 오늘이 그 요일이면 시각이 지났을 때 다음 주 (월 09:00 → 11-23, 월 19:00 → 오늘)', () => {
    expect(normalizeDraftEvent(draft(weekdayWhen('월', 'nearest'), { startTime: '09:00' }), team('월요일 9시')).startsAt).toBe('2026-11-23T00:00:00.000Z');
    expect(normalizeDraftEvent(draft(weekdayWhen('월', 'nearest'), { startTime: '19:00' }), team('월요일 7시')).startsAt).toBe('2026-11-16T10:00:00.000Z');
  });

  it('끝 날짜 표현: 주말 여행(종일)은 토~일, 시작보다 앞이면 되묻기', () => {
    const weekend: WhenArg = { ...NO_WHEN, kind: 'weekend', which: 'this' };
    expect(normalizeDraftEvent(draft(weekend, { allDay: true, endDate: weekend, participants: [] }), team('이번 주말 여행'))).toMatchObject({
      startsAt: '2026-11-20T15:00:00.000Z',
      endsAt: '2026-11-22T15:00:00.000Z',
    });
    expect(problemOf(() => normalizeDraftEvent(draft(on('2026-11-27'), { endDate: on('2026-11-26'), endTime: '10:00' }), team('x')))).toEqual({ kind: 'clarify', field: 'time' });
  });

  it('isMentioned: 낱말 첫머리만, 님, 받침 + 이, 성 뗀 이름, 나', () => {
    expect(isMentioned('하늘', '다음 주 하늘이랑')).toBe(true);
    expect(isMentioned('하늘님', '하늘님이랑')).toBe(true);
    expect(isMentioned('김수경', '수경이랑 저녁')).toBe(true);
    expect(isMentioned('김수경', '강남 회식')).toBe(false);
    expect(isMentioned('남', '강남 회식')).toBe(false);
    expect(isMentioned('Jihoon', 'jihoon 이랑')).toBe(true);
    expect(isMentioned('나', '')).toBe(true);
    expect(isMentioned(' ', '아무 글')).toBe(false);
    expect(saysEveryone('셋 다 되는 저녁')).toBe(true);
    expect(saysEveryone('우리 회식')).toBe(true);
    expect(saysEveryone('강남 회식')).toBe(false);
  });

  it('빈 시간: 글에 없는 이름은 버리고 기본(전원), list_events 의 글에 없는 사람은 거르지 않음', () => {
    const free = {
      from: { ...NO_WHEN, kind: 'week' as const, which: 'next' as const },
      to: NO_WHEN,
      days: 'all' as const,
      dayStart: null,
      dayEnd: null,
      minMinutes: null,
      participants: ['김수경'],
      everyone: false,
      includeMe: false,
      next: 'show' as const,
      purpose: null,
    };
    expect(normalizeFreeTime(free, team('다음 주 빈 시간'))).toMatchObject({ fromDate: '2026-11-22', toDate: '2026-11-28', participants: [1, 2] });
    expect(normalizeFreeTime(free, team('다음 주 수경이만 빈 시간')).participants).toEqual([2]);
    const thisWeek = { ...NO_WHEN, kind: 'week' as const, which: 'this' as const };
    expect(normalizeListEvents({ from: thisWeek, to: NO_WHEN, member: '김수경' }, team('이번 주 뭐 있어?'))).toMatchObject({ fromDate: '2026-11-15', toDate: '2026-11-21', memberId: null });
    expect(normalizeListEvents({ from: thisWeek, to: NO_WHEN, member: '김수경' }, team('이번 주 수경이 일정')).memberId).toBe(2);
  });

  it('기념일 기간 표현: 다음 달이면 그 달, 하루면 그날부터 1년, 풀 수 없으면 되묻기', () => {
    expect(normalizeFindAnniversary({ keyword: null, from: { ...NO_WHEN, kind: 'month', which: 'next' }, to: NO_WHEN }, team(''))).toMatchObject({ fromDate: '2026-12-01', toDate: '2026-12-31' });
    expect(normalizeFindAnniversary({ keyword: null, from: { ...NO_WHEN, kind: 'relativeDays', days: 1 }, to: NO_WHEN }, team(''))).toMatchObject({ fromDate: '2026-11-17', toDate: '2027-11-17' });
    expect(problemOf(() => normalizeFindAnniversary({ keyword: null, from: { ...NO_WHEN, kind: 'weekday' }, to: NO_WHEN }, team('')))).toEqual({ kind: 'clarify', field: 'period' });
  });

  it('투표 후보의 날짜 표현도 서버가 정한다', () => {
    const options = [
      { date: weekdayWhen('토', 'this'), startTime: '18:00', endTime: '20:00' },
      { date: weekdayWhen('일', 'next'), startTime: '18:00', endTime: '20:00' },
    ];
    const draftPoll = normalizeDraftPoll({ title: '약속', options, participants: [], everyone: false }, team('이번 주 토요일이랑 다음 주 일요일로 투표'));
    expect(draftPoll.options.map((o) => o.startsAt)).toEqual(['2026-11-21T09:00:00.000Z', '2026-11-22T09:00:00.000Z']);
  });
});

describe('(#459) 서버 안전장치: 실모델 평가에서 남은 실수 (D-278)', () => {
  // 실모델 평가와 같은 2인 팀 "경"(나), "김수경". 2026-11-16 (월) 14:05
  const pair = [person(1, '경'), person(2, '김수경')];
  const team = (text: string, members = pair) => context({ userId: 1, members, spoken: text, text });
  const weekday = (w: WhenArg['weekday'], which: WhenArg['which']): WhenArg => ({ ...NO_WHEN, kind: 'weekday', weekday: w, which });
  const today: WhenArg = { ...NO_WHEN, kind: 'relativeDays', days: 0 };
  const free = (overrides: Record<string, unknown> = {}) => ({
    from: today,
    to: NO_WHEN,
    days: 'all' as const,
    dayStart: '18:00',
    dayEnd: '23:00',
    minMinutes: null,
    participants: [] as string[],
    everyone: false,
    includeMe: true,
    next: 'show' as const,
    purpose: null,
    ...overrides,
  });

  describe('① 이름 첫 글자를 요일로 읽음', () => {
    it('운영 재현(gpt-4.1-mini): "다음 주 수경이 일정 뭐 있어?" 를 수요일로 읽어도 다음 주 전체, 김수경', () => {
      const plan = normalizeListEvents({ from: weekday('수', 'next'), to: NO_WHEN, member: '김수경' }, team('다음 주 수경이 일정 뭐 있어?'));
      expect(plan).toMatchObject({ fromDate: '2026-11-22', toDate: '2026-11-28', memberId: 2 });
    });

    it('weekdayIsName: 그 글자가 이름 첫머리에만 있으면 이름, 요일로도 쓰였으면 요일', () => {
      const ctx = (text: string, members = pair) => ({ members, spoken: text });
      expect(weekdayIsName(weekday('수', 'next'), ctx('다음 주 수경이 일정'))).toBe(true);
      expect(weekdayIsName(weekday('수', 'next'), ctx('다음 주 김수경 일정'))).toBe(true);
      expect(weekdayIsName(weekday('수', 'next'), ctx('다음 주 수요일 수경이 일정'))).toBe(false);
      expect(weekdayIsName(weekday('수', 'next'), ctx('다음 주 수 저녁'))).toBe(false);
      expect(weekdayIsName(weekday('목', 'this'), ctx('이번 주 목련이랑', [person(1, '경'), person(2, '목련')]))).toBe(true);
      expect(weekdayIsName(weekday('금', 'this'), ctx('금비 일정', [person(1, '경'), person(2, 'x', '금비')]))).toBe(true);
      // 그 글자로 시작하는 이름이 없거나, 요일이 아닌 표현이면 손대지 않는다
      expect(weekdayIsName(weekday('수', 'next'), ctx('다음 주 수경이 일정', [person(1, '경'), person(2, '하늘')]))).toBe(false);
      expect(weekdayIsName(today, ctx('수경이'))).toBe(false);
      // 낱말 첫머리가 아니면 이름이 아니다 ("일호" 팀원, "토일호" 는 지우지 않음)
      expect(weekdayIsName(weekday('일', 'this'), ctx('토일호', [person(1, '경'), person(2, '일호')]))).toBe(false);
    });

    it('빈 시간: 글의 주 말이 없으면 모델의 주, 요일만이면 이번 주. 끝이 이름 요일이면 버린다', () => {
      expect(normalizeFreeTime(free({ from: weekday('수', 'next') }), team('수경이랑 빈 시간'))).toMatchObject({ fromDate: '2026-11-22', toDate: '2026-11-28' });
      expect(normalizeFreeTime(free({ from: weekday('수', 'nearest') }), team('수경이랑 빈 시간'))).toMatchObject({ fromDate: '2026-11-15', toDate: '2026-11-21' });
      expect(normalizeFreeTime(free({ from: weekday('수', 'nearest') }), team('다다음 주 수경이랑 빈 시간'))).toMatchObject({ fromDate: '2026-11-29', toDate: '2026-12-05' });
      const thisWeek: WhenArg = { ...NO_WHEN, kind: 'week', which: 'this' };
      expect(normalizeFreeTime(free({ from: thisWeek, to: weekday('수', 'this') }), team('이번 주 수경이랑'))).toMatchObject({ fromDate: '2026-11-15', toDate: '2026-11-21' });
    });

    it('일정, 투표 초안: 이름을 요일로 읽었으면 날짜를 되묻는다, 진짜 요일은 그대로', () => {
      const draft = { ...event({ participants: ['김수경'] }), date: weekday('수', 'next') };
      expect(problemOf(() => normalizeDraftEvent(draft, team('다음 주 수경이랑 7시 저녁')))).toEqual({ kind: 'clarify', field: 'date' });
      expect(normalizeDraftEvent(draft, team('다음 주 수요일 수경이랑 7시 저녁')).startsAt).toBe('2026-11-25T10:00:00.000Z');
      const options = [
        { date: weekday('수', 'next'), startTime: '18:00', endTime: '20:00' },
        { date: weekday('금', 'next'), startTime: '18:00', endTime: '20:00' },
      ];
      expect(problemOf(() => normalizeDraftPoll({ title: '약속', options, participants: [], everyone: false }, team('다음 주 금요일이랑 수경이 되는 날로 투표')))).toEqual({
        kind: 'clarify',
        field: 'date',
      });
    });

    it('spokenWeek: 다다음 주, 다음 주(담주), 이번 주, 없음', () => {
      expect(spokenWeek('다다음 주')).toBe('after_next');
      expect(spokenWeek('담주에')).toBe('next');
      expect(spokenWeek('다음주')).toBe('next');
      expect(spokenWeek('이번 주')).toBe('this');
      expect(spokenWeek('주말')).toBeNull();
    });
  });

  describe('② 기간 길이를 말했는데 끝이 빠짐', () => {
    it('운영 재현(gpt-4.1-mini): "오늘부터 일주일 동안 둘 다 되는 저녁" 끝이 없어도 11-16~11-22', () => {
      expect(normalizeFreeTime(free(), team('오늘부터 일주일 동안 둘 다 되는 저녁'))).toMatchObject({ fromDate: '2026-11-16', toDate: '2026-11-22' });
    });

    it('끝이 시작과 같은 날이거나 시작도 없으면 길이로, 모델이 다른 끝을 주면 그대로', () => {
      expect(normalizeFreeTime(free({ to: today }), team('오늘부터 3일 동안'))).toMatchObject({ fromDate: '2026-11-16', toDate: '2026-11-18' });
      expect(normalizeFreeTime(free({ from: NO_WHEN }), team('2주 동안 되는 저녁'))).toMatchObject({ fromDate: '2026-11-16', toDate: '2026-11-29' });
      expect(normalizeFreeTime(free({ from: { ...NO_WHEN, kind: 'relativeDays', days: 1 } }), team('내일부터 이틀간'))).toMatchObject({ fromDate: '2026-11-17', toDate: '2026-11-18' });
      const end: WhenArg = { ...NO_WHEN, kind: 'relativeDays', days: 4 };
      expect(normalizeFreeTime(free({ to: end }), team('오늘부터 일주일 동안'))).toMatchObject({ fromDate: '2026-11-16', toDate: '2026-11-20' });
      expect(normalizeListEvents({ from: today, to: NO_WHEN, member: null }, team('오늘부터 한 달 동안 일정'))).toMatchObject({ fromDate: '2026-11-16', toDate: '2026-12-15' });
      // 길이 말이 없으면 원래대로 (하루)
      expect(normalizeFreeTime(free(), team('오늘 둘 다 되는 저녁'))).toMatchObject({ fromDate: '2026-11-16', toDate: '2026-11-16' });
      // 시작도 끝도 없고 길이도 없으면 되묻기
      expect(problemOf(() => normalizeFreeTime(free({ from: NO_WHEN }), team('빈 시간')))).toEqual({ kind: 'clarify', field: 'period' });
      expect(problemOf(() => normalizeFreeTime(free({ from: { ...NO_WHEN, kind: 'weekday' } }), team('3일 동안')))).toEqual({ kind: 'clarify', field: 'period' });
    });

    it('spokenDuration: N일, 이틀, 일주일, 한 주, N주, 한 달, N개월. "동안, 간, 내, 이내, 안에" 가 있어야 길이', () => {
      expect(spokenDuration('3일 동안')).toEqual({ days: 3 });
      expect(spokenDuration('10일간')).toEqual({ days: 10 });
      expect(spokenDuration('이틀 동안')).toEqual({ days: 2 });
      expect(spokenDuration('일주일 동안')).toEqual({ days: 7 });
      expect(spokenDuration('일주일 안에')).toEqual({ days: 7 });
      expect(spokenDuration('한 주 동안')).toEqual({ days: 7 });
      expect(spokenDuration('2주 동안')).toEqual({ days: 14 });
      expect(spokenDuration('두 주일간')).toEqual({ days: 14 });
      expect(spokenDuration('한 달 동안')).toEqual({ months: 1 });
      expect(spokenDuration('1개월 내')).toEqual({ months: 1 });
      // 날짜, 시점 말은 길이가 아니다
      expect(spokenDuration('일주일 뒤 저녁')).toBeNull();
      expect(spokenDuration('11월 27일 저녁')).toBeNull();
      expect(spokenDuration('다음 주 동안')).toBeNull();
      expect(spokenDuration('')).toBeNull();
    });

    it('durationEnd: 시작 + 길이 - 1일, 달은 다음 달 같은 날 - 1일 (없으면 말일)', () => {
      expect(durationEnd('2026-11-16', { days: 7 })).toBe('2026-11-22');
      expect(durationEnd('2026-11-16', { days: 0 })).toBe('2026-11-16');
      expect(durationEnd('2026-11-16', { months: 1 })).toBe('2026-12-15');
      expect(durationEnd('2026-12-20', { months: 1 })).toBe('2027-01-19');
      expect(durationEnd('2027-01-31', { months: 1 })).toBe('2027-02-28');
    });
  });

  describe('③ 전원 말이 있는데 모델이 everyone 을 빼먹음', () => {
    it('운영 재현(gpt-4.1): "오늘부터 일주일 동안 둘 다 되는 저녁" everyone=false, 이름 없음이어도 [경, 김수경]', () => {
      const plan = normalizeFreeTime(free({ participants: [], everyone: false, includeMe: true }), team('오늘부터 일주일 동안 둘 다 되는 저녁'));
      expect(plan).toMatchObject({ fromDate: '2026-11-16', toDate: '2026-11-22', participants: [1, 2] });
    });

    it('일정 초안(기본 나만)과 투표도 전원 말이면 전원, 모델이 이름 하나만 줘도', () => {
      const three = [person(1, '경'), person(2, '김수경'), person(3, '하늘')];
      const draft = { ...event({ participants: ['하늘'], everyone: false }), date: on('2026-11-27') };
      expect(normalizeDraftEvent(draft, team('27일 7시 다 같이 회식', three)).participants).toEqual([1, 2, 3]);
      expect(normalizeDraftEvent(draft, team('27일 7시 모두 회식', three)).participants).toEqual([1, 2, 3]);
      const options = [
        { date: on('2026-11-27'), startTime: '18:00', endTime: '20:00' },
        { date: on('2026-11-28'), startTime: '18:00', endTime: '20:00' },
      ];
      expect(normalizeDraftPoll({ title: '약속', options, participants: ['하늘'], everyone: false }, team('27일이랑 28일 다들 투표', three)).participants).toEqual([1, 2, 3]);
    });

    it('사람 수를 말했고 글의 이름(+ 나)이 꼭 그 수면 그 사람들만, 아니면 전원', () => {
      const three = [person(1, '경'), person(2, '김수경'), person(3, '하늘')];
      expect(normalizeFreeTime(free({ participants: ['김수경'], includeMe: true }), team('수경이랑 나 둘 다 되는 저녁', three)).participants).toEqual([1, 2]);
      expect(normalizeFreeTime(free({ participants: ['김수경', '하늘'], includeMe: false }), team('수경이랑 하늘이 둘 다 되는 날', three)).participants).toEqual([2, 3]);
      expect(normalizeFreeTime(free({ participants: [], includeMe: true }), team('둘 다 되는 저녁', three)).participants).toEqual([1, 2, 3]);
      expect(normalizeFreeTime(free({ participants: [], includeMe: true }), team('셋 다 되는 저녁', three)).participants).toEqual([1, 2, 3]);
    });

    it('개인 팀은 늘 나만, 전원 말이 없으면 원래 규칙 (D-277)', () => {
      expect(normalizeFreeTime(free(), context({ personal: true, spoken: '다 같이', text: '다 같이' })).participants).toEqual([1]);
      const draft = { ...event({ participants: [], everyone: true }), date: on('2026-11-27') };
      expect(normalizeDraftEvent(draft, team('27일 7시 회식')).participants).toEqual([1]);
    });

    it('forcedEveryone: 사람 수, 전원, "다음, 다른, 다시" 는 아님, 앞 대화가 아닌 이번 글만', () => {
      expect(forcedEveryone('둘 다 되는 저녁')).toBe(2);
      expect(forcedEveryone('둘다 되는')).toBe(2);
      expect(forcedEveryone('셋 모두')).toBe(3);
      expect(forcedEveryone('다 같이 저녁')).toBe('all');
      expect(forcedEveryone('함께 다 되는')).toBe('all');
      expect(forcedEveryone('모두 되는 날')).toBe('all');
      expect(forcedEveryone('전원')).toBe('all');
      expect(forcedEveryone('다들 언제 돼?')).toBe('all');
      expect(forcedEveryone('우리 다 되는 날')).toBe('all');
      expect(forcedEveryone('우리 다음 주 저녁')).toBeNull();
      expect(forcedEveryone('우리 다시 보자')).toBeNull();
      expect(forcedEveryone('다른 날')).toBeNull();
      expect(forcedEveryone('우리 회식')).toBeNull();
      expect(forcedEveryone('강남 회식')).toBeNull();
      // 앞 대화의 "다 같이" 는 강제하지 않는다
      const ctx = context({ userId: 1, members: pair, spoken: '다 같이 저녁\n27일 7시 회식', text: '27일 7시 회식' });
      expect(normalizeDraftEvent({ ...event({ participants: [], everyone: false }), date: on('2026-11-27') }, ctx).participants).toEqual([1]);
    });
  });
});
