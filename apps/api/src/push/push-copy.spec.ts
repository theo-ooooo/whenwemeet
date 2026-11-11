import {
  anniversaryPayload,
  changePayload,
  changePhrase,
  copula,
  eventUrl,
  joinPayload,
  kstDateLabel,
  kstTimeLabel,
  reminderPayload,
  type ReminderTarget,
  toExpoMessage,
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

  it('일정 상세 경로는 calendarEventHref 모양, 오늘이어도 date', () => {
    expect(eventUrl(10, 5, '2026-11-12', null)).toBe('/g/10/calendar?date=2026-11-12&day=1&event=5');
    expect(eventUrl(10, 5, '2026-11-19', '2026-11-18')).toBe('/g/10/calendar?date=2026-11-19&day=1&event=5&occurrence=2026-11-18');
  });
});

describe('일정 알림 문구', () => {
  const timed: ReminderTarget = {
    groupId: 10,
    groupName: '우리',
    eventId: 5,
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
    expect(reminderPayload({ ...timed, reminder }, TODAY)).toMatchObject({ title: '저녁 약속', subtitle: '우리', body });
  });

  it('경로와 만료 (회차 시작)', () => {
    const payload = reminderPayload(timed, TODAY);
    expect(payload.url).toBe('/g/10/calendar?date=2026-11-12&day=1&event=5');
    expect(payload.expiration).toBe(kst('2026-11-12T18:00:00').getTime() / 1000);
  });

  it('반복 회차는 occurrence 를 붙인다 (옮긴 회차는 date 가 옮긴 날)', () => {
    const payload = reminderPayload({ ...timed, occurrence: '2026-11-11' }, TODAY);
    expect(payload.url).toBe('/g/10/calendar?date=2026-11-12&day=1&event=5&occurrence=2026-11-11');
  });

  it('종일 하루짜리: 오늘 종일 / 내일 종일, 만료는 그날 끝 KST 24:00', () => {
    const allDay = { ...timed, allDay: true, startsAt: kst('2026-11-12T00:00:00'), endsAt: kst('2026-11-13T00:00:00') };
    expect(reminderPayload({ ...allDay, reminder: 'DAY_OF_0900' }, TODAY).body).toBe('오늘 종일');
    expect(reminderPayload({ ...allDay, reminder: 'DAY_BEFORE_0900' }, TODAY).body).toBe('내일 종일');
    expect(reminderPayload({ ...allDay, reminder: 'DAY_OF_0900' }, TODAY).expiration).toBe(kst('2026-11-13T00:00:00').getTime() / 1000);
  });

  it('종일 여러 날: 오늘부터 / 내일부터 {끝 날짜}까지, 올해가 아니면 연도', () => {
    const multi = { ...timed, allDay: true, startsAt: kst('2026-12-30T00:00:00'), endsAt: kst('2027-01-02T00:00:00') };
    expect(reminderPayload({ ...multi, reminder: 'DAY_OF_0900' }, '2026-12-30').body).toBe('오늘부터 2027년 1월 1일 (금)까지');
    expect(reminderPayload({ ...multi, reminder: 'DAY_BEFORE_0900' }, '2026-12-29').body).toBe('내일부터 2027년 1월 1일 (금)까지');
  });
});

describe('팀원 변경 문구', () => {
  const log = {
    eventId: 5,
    title: '저녁 약속',
    startsAt: kst('2026-11-12T18:00:00'),
    endsAt: kst('2026-11-12T20:00:00'),
    allDay: false,
    repeat: null,
    scope: null,
    occurrence: null,
  };
  const target = { groupId: 10, groupName: '우리', actorName: '민지', action: 'CREATED' as const, eventId: 5, log };

  it('추가: 제목, 날짜 시각. 메모는 넣지 않는다', () => {
    expect(changePayload(target, NOW)).toEqual({
      title: '민지님이 일정을 추가했어요',
      subtitle: '우리',
      body: '저녁 약속, 11월 12일 (목) 오후 6:00',
      url: '/g/10/calendar?date=2026-11-12&day=1&event=5',
      expiration: Math.floor((NOW.getTime() + 86_400_000) / 1000),
    });
  });

  it('반복 추가, 종일, 올해 아닌 날짜', () => {
    const payload = changePayload({ ...target, log: { ...log, repeat: 'WEEKLY', allDay: true, startsAt: kst('2027-01-05T00:00:00') } }, NOW);
    expect(payload.title).toBe('민지님이 매주 반복 일정을 추가했어요');
    expect(payload.body).toBe('저녁 약속, 2027년 1월 5일 (화) 종일');
    expect(payload.url).toBe('/g/10/calendar?date=2027-01-05&day=1&event=5&occurrence=2027-01-05');
  });

  it('수정 문장은 웹 newsPhrase 와 같다', () => {
    expect(changePhrase('UPDATED', { repeat: null, scope: null, occurrence: null })).toBe('일정을 수정했어요');
    expect(changePhrase('UPDATED', { repeat: 'WEEKLY', scope: 'THIS', occurrence: '2026-11-18' })).toBe('11월 18일 일정만 수정했어요');
    expect(changePhrase('UPDATED', { repeat: 'WEEKLY', scope: 'FOLLOWING', occurrence: '2026-11-18' })).toBe('11월 18일부터 반복 일정을 수정했어요');
    expect(changePhrase('DELETED', { repeat: 'WEEKLY', scope: 'THIS', occurrence: '2026-11-18' })).toBe('11월 18일 일정을 삭제했어요');
    expect(changePhrase('DELETED', { repeat: 'WEEKLY', scope: 'FOLLOWING', occurrence: '2026-11-18' })).toBe('11월 18일부터 반복을 삭제했어요');
    expect(changePhrase('DELETED', { repeat: null, scope: null, occurrence: null })).toBe('일정을 삭제했어요');
  });

  it('"이 일정만" 수정 경로는 그 회차, 삭제는 새 소식', () => {
    const thisLog = { ...log, repeat: 'WEEKLY' as const, scope: 'THIS' as const, occurrence: '2026-11-11', startsAt: kst('2026-11-12T18:00:00') };
    expect(changePayload({ ...target, action: 'UPDATED', log: thisLog }, NOW).url).toBe('/g/10/calendar?date=2026-11-12&day=1&event=5&occurrence=2026-11-11');
    expect(changePayload({ ...target, action: 'DELETED', log: { ...log, eventId: null } }, NOW).url).toBe('/g/10/news');
  });
});

describe('기념일, 합류 문구', () => {
  it('기념일: 이름 + 라벨, "오늘은 …이에요", 만료는 그날 KST 24:00', () => {
    const payload = anniversaryPayload({ groupId: 10, groupName: '우리', name: '처음 만난 날', label: '300일', date: '2026-11-12' });
    expect(payload).toEqual({
      title: '처음 만난 날 300일',
      subtitle: '우리',
      body: '오늘은 처음 만난 날 300일이에요',
      url: '/g/10/anniversaries',
      expiration: kst('2026-11-13T00:00:00').getTime() / 1000,
    });
    expect(anniversaryPayload({ groupId: 10, groupName: '우리', name: '엄마 생신', label: null, date: '2026-11-12' }).title).toBe('엄마 생신');
  });

  it("합류: '{이름}님이 '{팀}' 에 들어왔어요', 팀 이름을 따로 붙이지 않는다", () => {
    expect(joinPayload(10, '우리 가족', '지훈', NOW)).toMatchObject({ title: "지훈님이 '우리 가족' 에 들어왔어요", subtitle: null, body: null, url: '/g/10/calendar' });
  });
});

describe('toExpoMessage (IOS / ANDROID 모양, D-95, D-98)', () => {
  const payload = { title: '저녁 약속', subtitle: '우리', body: '1시간 뒤 오후 6:00', url: '/g/10/calendar', expiration: 0 };

  it('IOS 는 subtitle, ANDROID 는 제목 앞 [팀 이름]', () => {
    const ios = toExpoMessage('CHANGE', 7, { ...payload, expiration: 123 }, { token: 'ExponentPushToken[a]', platform: 'IOS' }, NOW);
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
    const android = toExpoMessage('CHANGE', 7, payload, { token: 'ExponentPushToken[b]', platform: 'ANDROID' }, NOW);
    expect(android.title).toBe('[우리] 저녁 약속');
    expect(android).not.toHaveProperty('subtitle');
  });

  it('합류처럼 subtitle 이 없으면 앞머리도 없고, 본문이 없으면 body 를 뺀다', () => {
    const message = toExpoMessage('JOIN', 7, { ...payload, subtitle: null, body: null }, { token: 't', platform: 'ANDROID' }, NOW);
    expect(message.title).toBe('저녁 약속');
    expect(message).not.toHaveProperty('body');
  });

  it('일정 알림 만료는 보내는 때 기준 최소 10분 뒤 (늦게 보낸 알림)', () => {
    const late = toExpoMessage('REMINDER', 7, { ...payload, expiration: NOW.getTime() / 1000 - 60 }, { token: 't', platform: 'IOS' }, NOW);
    expect(late.expiration).toBe(NOW.getTime() / 1000 + 600);
    const future = NOW.getTime() / 1000 + 3600;
    expect(toExpoMessage('REMINDER', 7, { ...payload, expiration: future }, { token: 't', platform: 'IOS' }, NOW).expiration).toBe(future);
  });
});
