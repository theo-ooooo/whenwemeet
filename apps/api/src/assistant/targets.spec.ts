import type { EventTarget } from './assistant.types.js';
import { type NormalizeContext, NormalizeProblem } from './normalize.js';
import {
  eventChoiceReply,
  eventDeleteReply,
  eventEditReply,
  HISTORY_MAX,
  targetNotFoundReply,
  alreadyReply,
  clarifyReply,
} from './replies.js';
import {
  dropEchoedTime,
  dropEchoedWhen,
  type EditChangesArgs,
  firstTargets,
  hasChanges,
  matchesKeyword,
  matchTargets,
  normalizeEdit,
  targetKeyword,
  targetSearch,
  toTarget,
} from './targets.js';
import { NO_WHEN, type WhenArg } from './when.js';

/** 2026-11-16 (월) 14:05 KST */
const NOW = new Date('2026-11-16T05:05:00.000Z');
const person = (userId: number, displayName: string) => ({
  userId,
  displayName,
  nickname: displayName,
  member: { userId, displayName, color: '#F26D6D', profileImageUrl: null },
});
const context = (
  overrides: Partial<NormalizeContext> = {},
): NormalizeContext => ({
  now: NOW,
  userId: 1,
  personal: false,
  members: [person(1, '경'), person(2, '김수경')],
  spoken: '',
  text: '',
  ...overrides,
});

const on = (date: string): WhenArg => ({ ...NO_WHEN, kind: 'date', date });
const weekday = (
  word: string,
  which: WhenArg['which'] = 'nearest',
): WhenArg => ({
  ...NO_WHEN,
  kind: 'weekday',
  weekday: word as WhenArg['weekday'],
  which,
});
const relative = (days: number): WhenArg => ({
  ...NO_WHEN,
  kind: 'relativeDays',
  days,
});

const NO_CHANGES: EditChangesArgs = {
  title: null,
  date: NO_WHEN,
  startTime: null,
  endTime: null,
  allDay: null,
  place: null,
};

/** KST 'YYYY-MM-DD HH:mm' → ISO */
const kst = (text: string) =>
  new Date(`${text.replace(' ', 'T')}:00.000+09:00`).toISOString();

const target = (overrides: Partial<EventTarget> = {}): EventTarget => ({
  id: 7,
  publicCode: 'abc123',
  occurrence: null,
  repeat: false,
  title: '회식',
  startsAt: kst('2026-11-20 19:00'),
  endsAt: kst('2026-11-20 21:00'),
  allDay: false,
  place: null,
  members: [],
  ...overrides,
});

const clarifyOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof NormalizeProblem) return error.problem;
    throw error;
  }
  return null;
};

describe('(#511) 고치기, 지우기 대상 찾기 (D-283)', () => {
  it('targetKeyword: 정리, 20자, 주소나 빈 글은 null', () => {
    expect(targetKeyword('  강남\n회식 ')).toBe('강남 회식');
    expect(targetKeyword('가'.repeat(30))).toBe('가'.repeat(20));
    expect(targetKeyword('   ')).toBeNull();
    expect(targetKeyword('http://evil')).toBeNull();
    expect(targetKeyword(null)).toBeNull();
  });

  it('targetSearch: 날짜 없으면 오늘 7일 전 ~ 60일 뒤, 요일만이면 가장 가까운 그날, 주와 달은 그 기간', () => {
    expect(
      targetSearch({ title: '회식', when: NO_WHEN, time: null }, context()),
    ).toEqual({
      fromDate: '2026-11-09',
      toDate: '2027-01-15',
      keyword: '회식',
      time: null,
    });
    expect(
      targetSearch(
        { title: '회식', when: weekday('금'), time: '19:00' },
        context(),
      ),
    ).toEqual({
      fromDate: '2026-11-20',
      toDate: '2026-11-20',
      keyword: '회식',
      time: '19:00',
    });
    // 오늘이 그 요일이면 시각이 지났어도 오늘 (지난 일정도 고칠 수 있다)
    expect(
      targetSearch({ title: null, when: weekday('월'), time: null }, context()),
    ).toMatchObject({ fromDate: '2026-11-16', toDate: '2026-11-16' });
    expect(
      targetSearch({ title: null, when: relative(-1), time: null }, context()),
    ).toMatchObject({ fromDate: '2026-11-15', toDate: '2026-11-15' });
    expect(
      targetSearch(
        {
          title: null,
          when: { ...NO_WHEN, kind: 'week', which: 'next' },
          time: null,
        },
        context(),
      ),
    ).toMatchObject({ fromDate: '2026-11-22', toDate: '2026-11-28' });
    expect(
      targetSearch(
        {
          title: null,
          when: { ...NO_WHEN, kind: 'month', which: 'this' },
          time: null,
        },
        context(),
      ),
    ).toMatchObject({ fromDate: '2026-11-01', toDate: '2026-11-30' });
  });

  it('targetSearch: 제목도 날짜도 없으면 clarify(which), 풀 수 없거나 범위 밖 날짜는 clarify(date)', () => {
    expect(
      clarifyOf(() =>
        targetSearch({ title: null, when: NO_WHEN, time: '19:00' }, context()),
      ),
    ).toMatchObject({ kind: 'clarify', field: 'which' });
    expect(
      clarifyOf(() =>
        targetSearch(
          { title: '회식', when: { ...NO_WHEN, kind: 'weekday' }, time: null },
          context(),
        ),
      ),
    ).toMatchObject({ field: 'date' });
    expect(
      clarifyOf(() =>
        targetSearch(
          { title: '회식', when: on('2030-01-01'), time: null },
          context(),
        ),
      ),
    ).toMatchObject({ field: 'date' });
  });

  it('targetSearch: 이름 첫 글자를 요일로 읽었으면(D-278 ①) 날짜 없음으로 본다', () => {
    const search = targetSearch(
      { title: '영화', when: weekday('수'), time: null },
      context({ spoken: '수경이랑 영화 지워 줘' }),
    );
    expect(search).toMatchObject({
      fromDate: '2026-11-09',
      toDate: '2027-01-15',
    });
  });

  it('matchesKeyword: 낱말이 모두 제목에 (공백, 대소문자 무시, 끝의 "일정" 뗌), 없으면 제목이 말 안에', () => {
    const list = [
      { title: '강남 팀 회식' },
      { title: '회식' },
      { title: '병원' },
      { title: 'Daily 스탠드업' },
      { title: '' },
    ];
    expect(matchesKeyword(list, '강남 회식').map((e) => e.title)).toEqual([
      '강남 팀 회식',
    ]);
    expect(matchesKeyword(list, '회식 일정').map((e) => e.title)).toEqual([
      '강남 팀 회식',
      '회식',
    ]);
    expect(matchesKeyword(list, '병원 예약').map((e) => e.title)).toEqual([
      '병원',
    ]);
    expect(matchesKeyword(list, 'daily').map((e) => e.title)).toEqual([
      'Daily 스탠드업',
    ]);
    expect(matchesKeyword(list, '일정')).toHaveLength(list.length);
    expect(matchesKeyword(list, null)).toHaveLength(list.length);
    expect(matchesKeyword(list, '영화')).toEqual([]);
  });

  it('matchTargets: 시각을 말했으면 그 시각에 시작하는 종일 아닌 일정만, 지금과 가까운 순', () => {
    const at = (title: string, start: string, allDay = false) => ({
      title,
      startsAt: new Date(kst(start)),
      endsAt: new Date(kst(start)),
      allDay,
    });
    const list = [
      at('회식', '2026-11-27 19:00'),
      at('회식', '2026-11-13 19:00'),
      at('회식', '2026-11-20 19:00'),
      at('회식', '2026-11-20 00:00', true),
      at('회식', '2026-11-18 18:00'),
    ];
    const search = {
      fromDate: '2026-11-09',
      toDate: '2027-01-15',
      keyword: '회식',
      time: '19:00',
    };
    expect(
      matchTargets(list, search, NOW).map((e) => e.startsAt.toISOString()),
    ).toEqual([
      kst('2026-11-13 19:00'),
      kst('2026-11-20 19:00'),
      kst('2026-11-27 19:00'),
    ]);
    expect(matchTargets(list, { ...search, time: null }, NOW)).toHaveLength(5);
    expect(
      matchTargets(list, { ...search, keyword: '영화', time: null }, NOW),
    ).toEqual([]);
  });

  it('firstTargets 5개, toTarget: 반복 회차, 장소 글자(없으면 검색어), 시각은 ISO', () => {
    expect(firstTargets([1, 2, 3, 4, 5, 6, 7])).toEqual([1, 2, 3, 4, 5]);
    const view = {
      id: 3,
      publicCode: 'c3',
      occurrence: '2026-11-23',
      repeat: 'WEEKLY',
      title: '주간 회의',
      startsAt: new Date(kst('2026-11-23 10:00')),
      endsAt: new Date(kst('2026-11-23 11:00')),
      allDay: false,
      place: { text: null, query: '카페' },
      participants: { members: [] },
      memo: '내보내지 않는다',
    };
    expect(toTarget(view)).toEqual({
      id: 3,
      publicCode: 'c3',
      occurrence: '2026-11-23',
      repeat: true,
      title: '주간 회의',
      startsAt: kst('2026-11-23 10:00'),
      endsAt: kst('2026-11-23 11:00'),
      allDay: false,
      place: { text: '카페' },
      members: [],
    });
    expect(
      toTarget({
        ...view,
        repeat: null,
        occurrence: null,
        place: { text: '  ' },
      }),
    ).toMatchObject({ repeat: false, place: null });
  });
});

describe('(#511) 바꿀 값 정규화 (draft_event 와 같은 규칙)', () => {
  it('hasChanges: 값이 하나라도 있으면', () => {
    expect(hasChanges(NO_CHANGES)).toBe(false);
    expect(hasChanges({ ...NO_CHANGES, title: '  ' })).toBe(false);
    expect(hasChanges({ ...NO_CHANGES, startTime: '19:30' })).toBe(true);
    expect(hasChanges({ ...NO_CHANGES, allDay: false })).toBe(true);
    expect(hasChanges({ ...NO_CHANGES, date: weekday('목') })).toBe(true);
    expect(hasChanges({ ...NO_CHANGES, place: '강남' })).toBe(true);
  });

  it('시작만 바꾸면 길이를 그대로, 끝을 주면 그 시각(시작보다 이르면 다음 날)', () => {
    expect(
      normalizeEdit(target(), { ...NO_CHANGES, startTime: '19:30' }, context()),
    ).toEqual({
      title: '회식',
      startsAt: kst('2026-11-20 19:30'),
      endsAt: kst('2026-11-20 21:30'),
      allDay: false,
      place: null,
    });
    expect(
      normalizeEdit(target(), { ...NO_CHANGES, endTime: '22:00' }, context()),
    ).toMatchObject({
      startsAt: kst('2026-11-20 19:00'),
      endsAt: kst('2026-11-20 22:00'),
    });
    expect(
      normalizeEdit(
        target(),
        { ...NO_CHANGES, startTime: '23:00', endTime: '01:00' },
        context(),
      ),
    ).toMatchObject({
      startsAt: kst('2026-11-20 23:00'),
      endsAt: kst('2026-11-21 01:00'),
    });
  });

  it('날짜: 요일(가장 가까운), 며칠 뒤, "다음 주로"는 그 주의 같은 요일, 지난 "이번 주 X요일"은 되묻기', () => {
    expect(
      normalizeEdit(
        target(),
        { ...NO_CHANGES, date: weekday('목') },
        context(),
      ),
    ).toMatchObject({
      startsAt: kst('2026-11-19 19:00'),
      endsAt: kst('2026-11-19 21:00'),
    });
    expect(
      normalizeEdit(
        target(),
        { ...NO_CHANGES, date: relative(1), startTime: '18:00' },
        context(),
      ),
    ).toMatchObject({
      startsAt: kst('2026-11-17 18:00'),
      endsAt: kst('2026-11-17 20:00'),
    });
    expect(
      normalizeEdit(
        target(),
        { ...NO_CHANGES, date: { ...NO_WHEN, kind: 'week', which: 'next' } },
        context(),
      ),
    ).toMatchObject({ startsAt: kst('2026-11-27 19:00') });
    expect(
      clarifyOf(() =>
        normalizeEdit(
          target(),
          { ...NO_CHANGES, date: weekday('일', 'this') },
          context(),
        ),
      ),
    ).toMatchObject({ field: 'date' });
  });

  it('종일: 시각 일정을 종일로 바꾸면 그날 하루, 종일 일정은 일 수 그대로 옮긴다', () => {
    expect(
      normalizeEdit(target(), { ...NO_CHANGES, allDay: true }, context()),
    ).toMatchObject({
      allDay: true,
      startsAt: kst('2026-11-20 00:00'),
      endsAt: kst('2026-11-21 00:00'),
    });
    const trip = target({
      title: '여행',
      allDay: true,
      startsAt: kst('2026-11-20 00:00'),
      endsAt: kst('2026-11-23 00:00'),
    });
    expect(
      normalizeEdit(trip, { ...NO_CHANGES, date: on('2026-12-04') }, context()),
    ).toMatchObject({
      startsAt: kst('2026-12-04 00:00'),
      endsAt: kst('2026-12-07 00:00'),
      allDay: true,
    });
  });

  it('종일 일정을 시각 일정으로: 시작이 없으면 되묻기(제목 머리말), 있으면 끝 없음 = 1시간', () => {
    const trip = target({
      title: '여행',
      allDay: true,
      startsAt: kst('2026-11-20 00:00'),
      endsAt: kst('2026-11-21 00:00'),
    });
    expect(
      clarifyOf(() =>
        normalizeEdit(trip, { ...NO_CHANGES, allDay: false }, context()),
      ),
    ).toEqual({ kind: 'clarify', field: 'time', subject: '여행' });
    expect(
      normalizeEdit(trip, { ...NO_CHANGES, startTime: '10:00' }, context()),
    ).toMatchObject({
      allDay: false,
      startsAt: kst('2026-11-20 10:00'),
      endsAt: kst('2026-11-20 11:00'),
    });
  });

  it('제목, 장소: 바꾼 것만, 주소는 형식 실패, 빈 값은 그대로', () => {
    expect(
      normalizeEdit(
        target(),
        { ...NO_CHANGES, title: ' 팀  회식 ' },
        context(),
      ),
    ).toMatchObject({ title: '팀 회식', startsAt: kst('2026-11-20 19:00') });
    expect(
      normalizeEdit(target(), { ...NO_CHANGES, place: '강남' }, context()),
    ).toMatchObject({ place: { text: '강남' } });
    expect(
      normalizeEdit(
        target({ place: { text: '홍대' } }),
        { ...NO_CHANGES, startTime: '20:00' },
        context(),
      ),
    ).toMatchObject({ place: { text: '홍대' } });
    expect(
      clarifyOf(() =>
        normalizeEdit(
          target(),
          { ...NO_CHANGES, title: 'www.evil.com' },
          context(),
        ),
      ),
    ).toEqual({ kind: 'invalid' });
    expect(
      clarifyOf(() =>
        normalizeEdit(
          target(),
          { ...NO_CHANGES, place: 'http://x' },
          context(),
        ),
      ),
    ).toEqual({ kind: 'invalid' });
  });

  it('지금 값과 같으면 null, 30일 넘는 길이는 되묻기', () => {
    expect(
      normalizeEdit(target(), { ...NO_CHANGES, startTime: '19:00' }, context()),
    ).toBeNull();
    expect(
      normalizeEdit(
        target(),
        { ...NO_CHANGES, title: '회식', date: on('2026-11-20') },
        context(),
      ),
    ).toBeNull();
    const long = target({ endsAt: kst('2026-12-15 19:00') });
    expect(
      clarifyOf(() =>
        normalizeEdit(
          long,
          { ...NO_CHANGES, startTime: '18:00', endTime: null },
          context(),
        ),
      ),
    ).toBeNull();
    expect(
      clarifyOf(() =>
        normalizeEdit(
          target({
            allDay: true,
            startsAt: kst('2026-11-20 00:00'),
            endsAt: kst('2026-12-25 00:00'),
          }),
          { ...NO_CHANGES, date: on('2026-11-21') },
          context(),
        ),
      ),
    ).toMatchObject({
      field: 'time',
    });
  });
});

describe('(#511) 고치기, 지우기 문구 틀', () => {
  it('고치기 1개: "이렇게 고칠까요?", 기록에 전 → 후, 제목, 장소', () => {
    const before = target({ place: { text: '홍대' } });
    const reply = eventEditReply({
      target: before,
      after: {
        title: '팀 회식',
        startsAt: kst('2026-11-20 19:30'),
        endsAt: kst('2026-11-20 21:30'),
        allDay: false,
        place: { text: '강남' },
      },
    });
    expect(reply.reply).toBe('이렇게 고칠까요?');
    expect(reply.cards).toEqual([
      {
        type: 'eventEditDraft',
        draft: {
          target: before,
          after: expect.objectContaining({ title: '팀 회식' }),
        },
      },
    ]);
    expect(reply.historyText).toBe(
      '[일정 수정 초안] 회식, 2026-11-20(금) 19:00~21:00 → 2026-11-20(금) 19:30~21:30, 제목 → 팀 회식, 장소 → 강남',
    );
    const titleOnly = eventEditReply({
      target: target(),
      after: {
        title: '송년회',
        startsAt: target().startsAt,
        endsAt: target().endsAt,
        allDay: false,
        place: null,
      },
    });
    expect(titleOnly.historyText).toBe(
      '[일정 수정 초안] 회식, 2026-11-20(금) 19:00~21:00, 제목 → 송년회',
    );
  });

  it('지우기 1개, 못 찾음, 이미 같음, 바꿀 값 되묻기', () => {
    expect(eventDeleteReply(target())).toEqual({
      reply: '이 일정을 지울까요?',
      cards: [{ type: 'eventDeleteDraft', target: target() }],
      historyText: '[일정 삭제 초안] 회식, 2026-11-20(금) 19:00~21:00',
    });
    expect(targetNotFoundReply('회식')).toEqual({
      reply: '그 일정을 찾지 못했어요. 날짜나 제목을 넣어 다시 말해 주세요',
      cards: [],
      historyText: '[일정 못 찾음] 회식',
    });
    expect(targetNotFoundReply(null).historyText).toBe('[일정 못 찾음]');
    expect(alreadyReply(target())).toMatchObject({
      reply: '이미 그렇게 되어 있어요',
      cards: [],
    });
    expect(clarifyReply('change', { subject: '회식' })).toMatchObject({
      reply: "'회식'은 무엇으로 바꿀까요?",
      cards: [{ type: 'clarify', field: 'change', choices: [] }],
    });
  });

  it('고르기: "일정이 N개 있어요. 어느 일정을 고칠까요?", 넘는 개수, 기록 600자', () => {
    const options = Array.from({ length: 5 }, (_, i) => ({
      target: target({
        id: i,
        title: '회'.repeat(50),
        startsAt: kst(`2026-11-2${i} 19:00`),
      }),
      after: null,
    }));
    const reply = eventChoiceReply('delete', options, 7);
    expect(reply.reply).toBe('일정이 7개 있어요. 어느 일정을 지울까요?');
    expect(reply.cards).toEqual([
      { type: 'eventChoice', action: 'delete', options, more: 2 },
    ]);
    expect(
      reply.historyText.startsWith(
        `[일정 고르기] 지울 일정 후보 11-20(금) 19:00 ${'회'.repeat(50)}; 11-21(토)`,
      ),
    ).toBe(true);
    expect(Array.from(reply.historyText).length).toBeLessThanOrEqual(
      HISTORY_MAX,
    );
    expect(eventChoiceReply('edit', options.slice(0, 2), 2).reply).toBe(
      '일정이 2개 있어요. 어느 일정을 고칠까요?',
    );
  });
});

describe('(#511) dropEchoedWhen: 대상 날짜가 바꿀 날짜와 같으면 대상 날짜를 지운다 (D-283)', () => {
  const thu = {
    ...NO_WHEN,
    kind: 'weekday' as const,
    weekday: '목' as const,
    which: 'nearest' as const,
  };
  const fri = {
    ...NO_WHEN,
    kind: 'weekday' as const,
    weekday: '금' as const,
    which: 'nearest' as const,
  };
  it('같은 표현이면 NO_WHEN', () => {
    expect(
      dropEchoedWhen({ title: '병원 예약', when: thu, time: null }, thu).when,
    ).toEqual(NO_WHEN);
  });
  it('다르거나 바꿀 날짜가 없으면 그대로', () => {
    expect(
      dropEchoedWhen({ title: '회식', when: fri, time: null }, thu).when,
    ).toEqual(fri);
    expect(
      dropEchoedWhen({ title: '회식', when: fri, time: null }, NO_WHEN).when,
    ).toEqual(fri);
    expect(
      dropEchoedWhen({ title: '회식', when: fri, time: null }, null).when,
    ).toEqual(fri);
  });
});

describe('(#511) dropEchoedTime: 대상 시각이 바꿀 시작 시각과 같으면 지운다 (D-283)', () => {
  it('같으면 null, 다르거나 없으면 그대로', () => {
    expect(
      dropEchoedTime({ title: '회식', when: NO_WHEN, time: '19:30' }, '19:30')
        .time,
    ).toBeNull();
    expect(
      dropEchoedTime({ title: '회의', when: NO_WHEN, time: '19:00' }, '20:00')
        .time,
    ).toBe('19:00');
    expect(
      dropEchoedTime({ title: '회의', when: NO_WHEN, time: '19:00' }, null)
        .time,
    ).toBe('19:00');
  });
});
