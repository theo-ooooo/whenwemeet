import {
  anniversaryPayload,
  subjectParticle,
  changePayload,
  changePhrase,
  copula,
  eventUrl,
  importPayload,
  noticeBodyPreview,
  noticePayload,
  pollClosedPayload,
  pollDeadlinePayload,
  pollOpenedPayload,
  pollTimeLabel,
  joinPayload,
  kstDateLabel,
  kstTimeLabel,
  reminderPayload,
  type ReminderTarget,
  toExpoMessage,
  weeklyNudgePayload,
  weeklySummaryPayload,
} from './push-copy.js';

const kst = (value: string) => new Date(`${value}+09:00`);
const NOW = kst('2026-11-12T17:00:00');
const TODAY = '2026-11-12';

describe('공통 표기 (설계 6장)', () => {
  it('시각은 KST 오전/오후 h:mm, 0시 = 오전 12:00, 12시 = 오후 12:00', () => {
    expect(kstTimeLabel(kst('2026-11-12T18:00:00'))).toBe('오후 6:00');
    expect(kstTimeLabel(kst('2026-11-12T00:05:00'))).toBe('오전 12:05');
    expect(kstTimeLabel(kst('2026-11-12T12:00:00'))).toBe('오후 12:00');
    expect(kstTimeLabel(kst('2026-11-12T09:30:00'))).toBe('오전 9:30');
  });

  it('날짜는 M월 D일 (요일), 올해가 아니면 연도', () => {
    expect(kstDateLabel('2026-11-12', TODAY)).toBe('11월 12일 (목)');
    expect(kstDateLabel('2027-01-05', TODAY)).toBe('2027년 1월 5일 (화)');
  });

  it('이에요/예요 는 끝 글자 받침, 한글이 아니면 받침 없음 쪽', () => {
    expect(copula('처음 만난 날 300일')).toBe('처음 만난 날 300일이에요');
    expect(copula('엄마 생일')).toBe('엄마 생일이에요');
    expect(copula('아빠 기념회')).toBe('아빠 기념회예요');
    expect(copula('BTS')).toBe('BTS예요');
  });

  it('(#311) 일정 상세 경로는 /events/<일정 코드>?team=<팀 코드>, 반복이면 occurrence', () => {
    expect(eventUrl('teamcode', 'evntcode', null)).toBe(
      '/events/evntcode?team=teamcode',
    );
    expect(eventUrl('teamcode', 'evntcode', '2026-11-18')).toBe(
      '/events/evntcode?team=teamcode&occurrence=2026-11-18',
    );
  });
});

describe('일정 알림 문구', () => {
  const timed: ReminderTarget = {
    groupId: 10,
    groupName: '우리',
    groupCode: 'teamcode',
    eventId: 5,
    eventCode: 'evntcode',
    occurrence: null,
    title: '저녁 약속',
    startsAt: kst('2026-11-12T18:00:00'),
    endsAt: kst('2026-11-12T20:00:00'),
    allDay: false,
    reminder: 'HOUR_1',
  };

  it.each([
    ['AT_START', '지금 오후 6:00'],
    ['MIN_10', '10분 뒤 오후 6:00'],
    ['HOUR_1', '1시간 뒤 오후 6:00'],
    ['DAY_1', '내일 오후 6:00'],
  ] as const)('시간 일정 %s → "%s"', (reminder, body) => {
    expect(reminderPayload({ ...timed, reminder }, TODAY)).toMatchObject({
      title: '저녁 약속',
      subtitle: '우리',
      body,
    });
  });

  it('경로와 만료 (회차 시작)', () => {
    const payload = reminderPayload(timed, TODAY);
    expect(payload.url).toBe('/events/evntcode?team=teamcode');
    expect(payload.expiration).toBe(
      kst('2026-11-12T18:00:00').getTime() / 1000,
    );
  });

  it('반복 회차는 occurrence 를 붙인다 (원래 회차 날짜)', () => {
    const payload = reminderPayload(
      { ...timed, occurrence: '2026-11-11' },
      TODAY,
    );
    expect(payload.url).toBe(
      '/events/evntcode?team=teamcode&occurrence=2026-11-11',
    );
  });

  it('종일 하루짜리: 오늘 종일 / 내일 종일, 만료는 그날 끝 KST 24:00', () => {
    const allDay = {
      ...timed,
      allDay: true,
      startsAt: kst('2026-11-12T00:00:00'),
      endsAt: kst('2026-11-13T00:00:00'),
    };
    expect(
      reminderPayload({ ...allDay, reminder: 'DAY_OF_0900' }, TODAY).body,
    ).toBe('오늘 종일');
    expect(
      reminderPayload({ ...allDay, reminder: 'DAY_BEFORE_0900' }, TODAY).body,
    ).toBe('내일 종일');
    expect(
      reminderPayload({ ...allDay, reminder: 'DAY_OF_0900' }, TODAY).expiration,
    ).toBe(kst('2026-11-13T00:00:00').getTime() / 1000);
  });

  it('종일 여러 날: 오늘부터 / 내일부터 {끝 날짜}까지, 올해가 아니면 연도', () => {
    const multi = {
      ...timed,
      allDay: true,
      startsAt: kst('2026-12-30T00:00:00'),
      endsAt: kst('2027-01-02T00:00:00'),
    };
    expect(
      reminderPayload({ ...multi, reminder: 'DAY_OF_0900' }, '2026-12-30').body,
    ).toBe('오늘부터 2027년 1월 1일 (금)까지');
    expect(
      reminderPayload({ ...multi, reminder: 'DAY_BEFORE_0900' }, '2026-12-29')
        .body,
    ).toBe('내일부터 2027년 1월 1일 (금)까지');
  });
});

describe('팀원 변경 문구', () => {
  const log = {
    eventId: 5,
    eventCode: 'evntcode',
    title: '저녁 약속',
    startsAt: kst('2026-11-12T18:00:00'),
    endsAt: kst('2026-11-12T20:00:00'),
    allDay: false,
    repeat: null,
    scope: null,
    occurrence: null,
  };
  const target = {
    groupId: 10,
    groupName: '우리',
    groupCode: 'teamcode',
    actorName: '민지',
    action: 'CREATED' as const,
    log,
  };

  it('추가: 제목, 날짜 시각. 메모는 넣지 않는다', () => {
    expect(changePayload(target, NOW)).toEqual({
      title: '민지님이 일정을 추가했어요',
      subtitle: '우리',
      body: '저녁 약속, 11월 12일 (목) 오후 6:00',
      url: '/events/evntcode?team=teamcode',
      expiration: Math.floor((NOW.getTime() + 86_400_000) / 1000),
    });
  });

  it('반복 추가, 종일, 올해 아닌 날짜', () => {
    const payload = changePayload(
      {
        ...target,
        log: {
          ...log,
          repeat: 'WEEKLY',
          allDay: true,
          startsAt: kst('2027-01-05T00:00:00'),
        },
      },
      NOW,
    );
    expect(payload.title).toBe('민지님이 매주 반복 일정을 추가했어요');
    expect(payload.body).toBe('저녁 약속, 2027년 1월 5일 (화) 종일');
    expect(payload.url).toBe(
      '/events/evntcode?team=teamcode&occurrence=2027-01-05',
    );
  });

  it('수정 문장은 웹 newsPhrase 와 같다', () => {
    expect(
      changePhrase('UPDATED', { repeat: null, scope: null, occurrence: null }),
    ).toBe('일정을 수정했어요');
    expect(
      changePhrase('UPDATED', {
        repeat: 'WEEKLY',
        scope: 'THIS',
        occurrence: '2026-11-18',
      }),
    ).toBe('11월 18일 일정만 수정했어요');
    expect(
      changePhrase('UPDATED', {
        repeat: 'WEEKLY',
        scope: 'FOLLOWING',
        occurrence: '2026-11-18',
      }),
    ).toBe('11월 18일부터 반복 일정을 수정했어요');
    expect(
      changePhrase('DELETED', {
        repeat: 'WEEKLY',
        scope: 'THIS',
        occurrence: '2026-11-18',
      }),
    ).toBe('11월 18일 일정을 삭제했어요');
    expect(
      changePhrase('DELETED', {
        repeat: 'WEEKLY',
        scope: 'FOLLOWING',
        occurrence: '2026-11-18',
      }),
    ).toBe('11월 18일부터 반복을 삭제했어요');
    expect(
      changePhrase('DELETED', { repeat: null, scope: null, occurrence: null }),
    ).toBe('일정을 삭제했어요');
  });

  it('"이 일정만" 수정 경로는 그 회차, 삭제는 새 소식', () => {
    const thisLog = {
      ...log,
      repeat: 'WEEKLY' as const,
      scope: 'THIS' as const,
      occurrence: '2026-11-11',
      startsAt: kst('2026-11-12T18:00:00'),
    };
    expect(
      changePayload({ ...target, action: 'UPDATED', log: thisLog }, NOW).url,
    ).toBe('/events/evntcode?team=teamcode&occurrence=2026-11-11');
    expect(
      changePayload(
        {
          ...target,
          action: 'DELETED',
          log: { ...log, eventId: null, eventCode: null },
        },
        NOW,
      ).url,
    ).toBe('/news?team=teamcode');
    // 원본이 지워져 코드가 없으면 수정 묶음도 새 소식으로
    expect(
      changePayload(
        {
          ...target,
          action: 'UPDATED',
          log: { ...log, eventId: null, eventCode: null },
        },
        NOW,
      ).url,
    ).toBe('/news?team=teamcode');
  });
});

describe('기념일, 합류 문구', () => {
  it('기념일: 이름 + 라벨, "오늘은 …이에요", 만료는 그날 KST 24:00', () => {
    const payload = anniversaryPayload({
      groupId: 10,
      groupName: '우리',
      groupCode: 'teamcode',
      name: '처음 만난 날',
      label: '300일',
      date: '2026-11-12',
      offsetDays: 0,
    });
    expect(payload).toEqual({
      title: '처음 만난 날 300일',
      subtitle: '우리',
      body: '오늘은 처음 만난 날 300일이에요',
      url: '/anniversaries?team=teamcode',
      expiration: kst('2026-11-13T00:00:00').getTime() / 1000,
    });
    expect(
      anniversaryPayload({
        groupId: 10,
        groupName: '우리',
        groupCode: 'teamcode',
        name: '엄마 생신',
        label: null,
        date: '2026-11-12',
        offsetDays: 0,
      }).title,
    ).toBe('엄마 생신');
  });

  it('기념일 하루 전, 일주일 전 (#269, D-147): 제목은 그대로, 본문만 다르고 만료는 보내는 날 KST 24:00', () => {
    const base = {
      groupId: 10,
      groupName: '우리',
      groupCode: 'teamcode',
      name: '처음 만난 날',
      label: '300일',
      date: '2026-11-12',
    };
    expect(anniversaryPayload({ ...base, offsetDays: 1 })).toMatchObject({
      title: '처음 만난 날 300일',
      body: '내일은 처음 만난 날 300일이에요',
      expiration: kst('2026-11-12T00:00:00').getTime() / 1000,
    });
    expect(anniversaryPayload({ ...base, offsetDays: 7 })).toMatchObject({
      title: '처음 만난 날 300일',
      body: '처음 만난 날 300일이 일주일 남았어요',
      expiration: kst('2026-11-06T00:00:00').getTime() / 1000,
    });
    expect(
      anniversaryPayload({
        ...base,
        name: '하늘 생일',
        label: null,
        offsetDays: 1,
      }).body,
    ).toBe('내일은 하늘 생일이에요');
    expect(
      anniversaryPayload({
        ...base,
        name: '엄마 생신',
        label: null,
        offsetDays: 7,
      }).body,
    ).toBe('엄마 생신이 일주일 남았어요');
    expect(
      anniversaryPayload({
        ...base,
        name: '우리 데이트',
        label: null,
        offsetDays: 7,
      }).body,
    ).toBe('우리 데이트가 일주일 남았어요');
  });

  it('이/가: 받침 있으면 이, 없거나 한글이 아니면 가', () => {
    expect(subjectParticle('1주년')).toBe('1주년이');
    expect(subjectParticle('하루')).toBe('하루가');
    expect(subjectParticle('BTS')).toBe('BTS가');
  });

  it("합류: '{이름}님이 '{팀}' 에 들어왔어요', 팀 이름을 따로 붙이지 않는다", () => {
    expect(joinPayload('teamcode', '우리 가족', '지훈', NOW)).toMatchObject({
      title: "지훈님이 '우리 가족' 에 들어왔어요",
      subtitle: null,
      body: null,
      url: '/calendar?team=teamcode',
    });
  });
});

describe('toExpoMessage (IOS / ANDROID 모양, D-95, D-98)', () => {
  const payload = {
    title: '저녁 약속',
    subtitle: '우리',
    body: '1시간 뒤 오후 6:00',
    url: '/g/10/calendar',
    expiration: 0,
  };

  it('IOS 는 subtitle, ANDROID 는 제목 앞 [팀 이름]', () => {
    const ios = toExpoMessage(
      'CHANGE',
      7,
      { ...payload, expiration: 123 },
      { token: 'ExponentPushToken[a]', platform: 'IOS' },
      NOW,
    );
    expect(ios).toEqual({
      to: 'ExponentPushToken[a]',
      title: '저녁 약속',
      subtitle: '우리',
      body: '1시간 뒤 오후 6:00',
      sound: 'default',
      priority: 'high',
      channelId: 'default',
      data: { url: '/g/10/calendar', kind: 'CHANGE', nid: 7 },
      expiration: 123,
    });
    const android = toExpoMessage(
      'CHANGE',
      7,
      payload,
      { token: 'ExponentPushToken[b]', platform: 'ANDROID' },
      NOW,
    );
    expect(android.title).toBe('[우리] 저녁 약속');
    expect(android).not.toHaveProperty('subtitle');
  });

  it('합류처럼 subtitle 이 없으면 앞머리도 없고, 본문이 없으면 body 를 뺀다', () => {
    const message = toExpoMessage(
      'JOIN',
      7,
      { ...payload, subtitle: null, body: null },
      { token: 't', platform: 'ANDROID' },
      NOW,
    );
    expect(message.title).toBe('저녁 약속');
    expect(message).not.toHaveProperty('body');
  });

  it('일정 알림 만료는 보내는 때 기준 최소 10분 뒤 (늦게 보낸 알림)', () => {
    const late = toExpoMessage(
      'REMINDER',
      7,
      { ...payload, expiration: NOW.getTime() / 1000 - 60 },
      { token: 't', platform: 'IOS' },
      NOW,
    );
    expect(late.expiration).toBe(NOW.getTime() / 1000 + 600);
    const future = NOW.getTime() / 1000 + 3600;
    expect(
      toExpoMessage(
        'REMINDER',
        7,
        { ...payload, expiration: future },
        { token: 't', platform: 'IOS' },
        NOW,
      ).expiration,
    ).toBe(future);
  });
});

describe('importPayload (#279)', () => {
  it('가져오기 한 번에 한 건: 새 소식과 같은 문장, 팀 이름은 subtitle, 달력으로', () => {
    const now = new Date('2026-11-11T03:00:00Z');
    expect(importPayload('teamcode', '우리', '민지', 1234, now)).toEqual({
      title: '민지님이 일정 1,234개를 가져왔어요',
      subtitle: '우리',
      body: null,
      url: '/calendar?team=teamcode',
      expiration: Math.floor(now.getTime() / 1000) + 86_400,
    });
  });
});

describe('약속 투표 문구 (#189, 설계 약속-투표.md 6장)', () => {
  const now = new Date('2026-11-13T03:00:00Z');
  const base = {
    groupName: '우리',
    groupCode: 'teamcode',
    pollCode: 'poll2345',
    title: '저녁 약속',
  };
  const sec = (ms: number) => Math.floor(ms / 1000);

  it('열림: 연 사람 이름, 후보 수와 마감, 투표 화면. 만료는 24시간과 마감 중 이른 쪽(최소 10분)', () => {
    const deadline = new Date('2026-11-13T12:00:00Z');
    expect(
      pollOpenedPayload(
        { ...base, actorName: '민지', optionCount: 3, deadline },
        now,
      ),
    ).toEqual({
      title: "민지님이 '저녁 약속' 시간을 묻고 있어요",
      subtitle: '우리',
      body: '후보 3개, 마감 11월 13일 (금) 오후 9:00',
      url: '/polls/poll2345?team=teamcode',
      expiration: sec(deadline.getTime()),
    });
    expect(
      pollOpenedPayload(
        { ...base, actorName: '민지', optionCount: 2, deadline: null },
        now,
      ),
    ).toMatchObject({
      body: '후보 2개',
      expiration: sec(now.getTime()) + 86_400,
    });
    expect(
      pollOpenedPayload(
        {
          ...base,
          actorName: '민지',
          optionCount: 2,
          deadline: new Date(now.getTime() + 1000),
        },
        now,
      ).expiration,
    ).toBe(sec(now.getTime()) + 600);
  });

  it('마감과 정함', () => {
    expect(pollDeadlinePayload(base, now)).toMatchObject({
      title: "'저녁 약속' 투표가 끝났어요",
      body: '시간을 정해 주세요',
      url: '/polls/poll2345?team=teamcode',
    });
    const option = {
      startsAt: new Date('2026-11-22T10:00:00Z'),
      allDay: false,
    };
    expect(
      pollClosedPayload(
        { ...base, actorName: '지훈', eventCode: 'evnt2345', option },
        now,
      ),
    ).toMatchObject({
      title: "지훈님이 '저녁 약속' 시간을 정했어요",
      body: '11월 22일 (일) 오후 7:00',
      url: '/events/evnt2345?team=teamcode',
    });
    expect(
      pollTimeLabel(
        { startsAt: new Date('2027-01-01T15:00:00Z'), allDay: true },
        '2026-11-13',
      ),
    ).toBe('2027년 1월 2일 (토) 종일');
  });
});

describe('주간 알림 문구 (#277, 설계 6장 WEEKLY)', () => {
  const base = {
    groupName: '우리',
    groupCode: 'abcd2345',
    monday: '2026-11-16',
  };
  /** 그 주 월요일 KST 24:00 */
  const EXP = Math.floor(kst('2026-11-17T00:00:00').getTime() / 1000);
  const item = (title: string, at: string) => ({ title, startsAt: kst(at) });

  it.each([
    [
      '1개',
      1,
      [item('저녁 약속', '2026-11-18T19:00:00')],
      null,
      '이번 주 일정 1개',
      '수 저녁 약속',
    ],
    [
      '2개, 외 없음',
      2,
      [
        item('점심', '2026-11-16T12:00:00'),
        item('영화', '2026-11-22T20:00:00'),
      ],
      null,
      '이번 주 일정 2개',
      '월 점심, 일 영화',
    ],
    [
      '3개, 외 1개',
      3,
      [
        item('점심', '2026-11-16T12:00:00'),
        item('저녁', '2026-11-18T19:00:00'),
      ],
      null,
      '이번 주 일정 3개',
      '월 점심, 수 저녁 외 1개',
    ],
    [
      '기념일 받침 있음',
      1,
      [item('저녁', '2026-11-18T19:00:00')],
      { date: '2026-11-20', title: '처음 만난 날 1주년' },
      '이번 주 일정 1개',
      '수 저녁. 금요일은 처음 만난 날 1주년이에요',
    ],
    [
      '기념일 받침 없음',
      1,
      [item('저녁', '2026-11-18T19:00:00')],
      { date: '2026-11-22', title: '하늘 생일 파티' },
      '이번 주 일정 1개',
      '수 저녁. 일요일은 하늘 생일 파티예요',
    ],
  ])('SUMMARY %s', (_name, count, items, anniversary, title, body) => {
    expect(
      weeklySummaryPayload({ ...base, count, items, anniversary }),
    ).toEqual({
      title,
      subtitle: '우리',
      body,
      url: '/upcoming?team=abcd2345',
      expiration: EXP,
      variant: 'SUMMARY',
    });
  });

  it('요일은 KST (UTC 로는 전날인 월요일 오전 8시도 월)', () => {
    const payload = weeklySummaryPayload({
      ...base,
      count: 1,
      items: [item('아침', '2026-11-16T08:00:00')],
      anniversary: null,
    });
    expect(payload.body).toBe('월 아침');
  });

  it('NUDGE: 첫 빈 시간과 나머지 수, 빈 시간 찾기로', () => {
    const slot = (a: string, b: string) => ({
      startsAt: kst(a),
      endsAt: kst(b),
    });
    expect(
      weeklyNudgePayload({
        ...base,
        slots: [slot('2026-11-18T19:00:00', '2026-11-18T23:00:00')],
      }),
    ).toEqual({
      title: '2주 동안 같이 잡은 일정이 없어요',
      subtitle: '우리',
      body: '이번 주 다 같이 비는 시간: 수 오후 7:00~오후 11:00',
      url: '/free?team=abcd2345',
      expiration: EXP,
      variant: 'NUDGE',
    });
    const many = weeklyNudgePayload({
      ...base,
      slots: [
        slot('2026-11-16T09:30:00', '2026-11-16T12:00:00'),
        slot('2026-11-17T09:00:00', '2026-11-17T23:00:00'),
        slot('2026-11-18T09:00:00', '2026-11-18T23:00:00'),
      ],
    });
    expect(many.body).toBe(
      '이번 주 다 같이 비는 시간: 월 오전 9:30~오후 12:00 외 2개',
    );
  });

  it('권유형 문구가 없다 (D-204 문구 규칙)', () => {
    const texts = [
      weeklyNudgePayload({
        ...base,
        slots: [
          {
            startsAt: kst('2026-11-18T19:00:00'),
            endsAt: kst('2026-11-18T23:00:00'),
          },
        ],
      }),
      weeklySummaryPayload({
        ...base,
        count: 3,
        items: [
          item('a', '2026-11-16T12:00:00'),
          item('b', '2026-11-17T12:00:00'),
        ],
        anniversary: null,
      }),
    ].flatMap((p) => [p.title, p.body ?? '']);
    for (const text of texts)
      expect(text).not.toMatch(/보세요|마세요|하세요|광고|이벤트|혜택/);
  });

  it('Expo 메시지에 variant 는 싣지 않는다', () => {
    const payload = weeklySummaryPayload({
      ...base,
      count: 1,
      items: [item('저녁', '2026-11-18T19:00:00')],
      anniversary: null,
    });
    const message = toExpoMessage(
      'WEEKLY',
      9,
      payload,
      { token: 't', platform: 'ANDROID' },
      NOW,
    );
    expect(message).toMatchObject({
      title: '[우리] 이번 주 일정 1개',
      body: '수 저녁',
      data: { url: '/upcoming?team=abcd2345', kind: 'WEEKLY', nid: 9 },
      expiration: EXP,
    });
    expect(JSON.stringify(message)).not.toContain('variant');
  });
});

describe('(#528) 공지 푸시 문구 (D-287)', () => {
  it('본문 첫 줄: 빈 줄과 앞뒤 공백을 건너뛰고, 80자를 넘으면 79자 + …, 글자는 코드 포인트로 센다', () => {
    expect(noticeBodyPreview('\n\n  첫 줄이에요  \n둘째 줄')).toBe(
      '첫 줄이에요',
    );
    expect(noticeBodyPreview('한 줄\r\n둘')).toBe('한 줄');
    expect(noticeBodyPreview('   \n  ')).toBeNull();
    const long = '가'.repeat(100);
    expect(noticeBodyPreview(long)).toBe(`${'가'.repeat(79)}…`);
    expect(noticeBodyPreview('가'.repeat(80))).toBe('가'.repeat(80));
    // 가족 이모지(여러 코드 포인트)도 한 글자로 센다
    const family = '👨‍👩‍👧';
    expect(noticeBodyPreview(family.repeat(81))).toBe(`${family.repeat(79)}…`);
  });

  it('noticePayload: 제목 그대로, 팀 이름 없음, /notices/{id}?from=push (#544), 24시간 뒤 만료. Android 도 앞머리가 붙지 않는다', () => {
    const now = new Date('2026-11-25T00:00:00.000Z');
    const payload = noticePayload(
      {
        id: 9,
        title: '새 기능: 볼까',
        body: '볼까에게 일정을 물어보세요\n...',
      },
      now,
    );
    expect(payload).toEqual({
      title: '새 기능: 볼까',
      subtitle: null,
      body: '볼까에게 일정을 물어보세요',
      url: '/notices/9?from=push',
      expiration: Math.floor(now.getTime() / 1000) + 86400,
    });
    const android = toExpoMessage(
      'NOTICE',
      3,
      payload,
      { token: 'ExponentPushToken[a]', platform: 'ANDROID' },
      now,
    );
    expect(android).toMatchObject({
      title: '새 기능: 볼까',
      body: '볼까에게 일정을 물어보세요',
      data: { url: '/notices/9?from=push', kind: 'NOTICE', nid: 3 },
    });
    expect(android).not.toHaveProperty('subtitle');
  });
});
