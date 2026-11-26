import {
  mockRepository,
  type RepositoryMock,
} from '../testing/repository-mock.js';
import { PushLeaseRepository } from './push-lease.repository.js';
import { PushNotificationsRepository } from './push-notifications.repository.js';
import {
  PushPlanningRepository,
  type WeeklyEventRow,
  type WeeklyGroup,
  type WeeklySeriesRow,
} from './push-planning.repository.js';
import {
  decideWeekly,
  mondayOfKey,
  type NudgeFacts,
  nudgeEligible,
  nudgeSlots,
  planWeekly,
  summaryItems,
  weekAnniversary,
  weekOccurrences,
  weekRange,
  weeklyDue,
  WeeklyPlanner,
} from './weekly-planner.js';

const kst = (value: string) => new Date(`${value}+09:00`);
const DAY_MS = 86_400_000;
/** 2026-11-16 은 월요일 */
const MONDAY = '2026-11-16';
const NOW = kst('2026-11-16T09:03:00');
const { from: FROM, to: TO } = weekRange(MONDAY);

const once = (
  title: string,
  start: string,
  end: string,
  allDay = false,
): WeeklyEventRow => ({
  title,
  startsAt: kst(start),
  endsAt: kst(end),
  allDay,
});
const weekly = (
  title: string,
  start: string,
  end: string,
  extra: Partial<WeeklySeriesRow> = {},
): WeeklySeriesRow => ({
  ...once(title, start, end),
  repeat: 'WEEKLY',
  repeatUntil: null,
  repeatAnchor: null,
  exceptions: [],
  ...extra,
});

describe('주간 알림 시각 (설계 5-9, D-203)', () => {
  it('월요일 09:00 ~ 12:00 KST 이고 그 월요일을 아직 안 했을 때만', () => {
    expect(weeklyDue(kst('2026-11-16T09:00:00'), null)).toBe(MONDAY);
    expect(weeklyDue(kst('2026-11-16T11:59:59'), '2026-11-09')).toBe(MONDAY);
    expect(weeklyDue(kst('2026-11-16T08:59:59'), null)).toBeNull();
    expect(weeklyDue(kst('2026-11-16T12:00:00'), null)).toBeNull();
    expect(weeklyDue(kst('2026-11-16T09:30:00'), MONDAY)).toBeNull();
    expect(weeklyDue(kst('2026-11-17T09:30:00'), null)).toBeNull();
    // 일요일 밤 UTC 로는 월요일 00:30 이지만 KST 로는 월요일 09:30
    expect(weeklyDue(new Date('2026-11-16T00:30:00.000Z'), null)).toBe(MONDAY);
  });

  it('이번 주 = 월요일 00:00 ~ 다음 월요일 00:00 KST', () => {
    expect(FROM.toISOString()).toBe('2026-11-15T15:00:00.000Z');
    expect(TO.toISOString()).toBe('2026-11-22T15:00:00.000Z');
  });

  it('팀마다 1건, 키 W:{groupId}:{월요일}, 09:00 + groupId % 600 초', () => {
    const rows = planWeekly([7, 601], MONDAY);
    expect(rows).toEqual([
      {
        kind: 'WEEKLY',
        dedupeKey: 'W:7:2026-11-16',
        groupId: 7,
        scheduledAt: new Date('2026-11-16T00:00:07.000Z'),
      },
      {
        kind: 'WEEKLY',
        dedupeKey: 'W:601:2026-11-16',
        groupId: 601,
        scheduledAt: new Date('2026-11-16T00:00:01.000Z'),
      },
    ]);
    expect(mondayOfKey('W:7:2026-11-16')).toBe(MONDAY);
    expect(mondayOfKey('R:1:-:0')).toBeNull();
  });
});

describe('이번 주 회차 수 N (변형 판정 1)', () => {
  it('N = 0, 1, 3. 겹치지 않는 일정은 세지 않는다', () => {
    expect(weekOccurrences([], [], FROM, TO)).toHaveLength(0);
    expect(
      weekOccurrences(
        [once('저녁', '2026-11-18T19:00:00', '2026-11-18T21:00:00')],
        [],
        FROM,
        TO,
      ),
    ).toHaveLength(1);
    const three = [
      once('저녁', '2026-11-18T19:00:00', '2026-11-18T21:00:00'),
      once('점심', '2026-11-16T12:00:00', '2026-11-16T13:00:00'),
      once('영화', '2026-11-22T20:00:00', '2026-11-22T22:00:00'),
      once('다음 주', '2026-11-23T00:00:00', '2026-11-23T01:00:00'),
      once('지난주', '2026-11-15T22:00:00', '2026-11-16T00:00:00'),
    ];
    const list = weekOccurrences(three, [], FROM, TO);
    expect(list.map((o) => o.title)).toEqual(['점심', '저녁', '영화']);
  });

  it('여러 날 일정이 지난주부터 이어져도 1개, 문구의 요일은 월요일로 자른다', () => {
    const list = weekOccurrences(
      [once('여행', '2026-11-14T00:00:00', '2026-11-18T00:00:00', true)],
      [],
      FROM,
      TO,
    );
    expect(list).toHaveLength(1);
    const [item] = summaryItems(list, FROM);
    expect(item.startsAt.toISOString()).toBe(FROM.toISOString());
  });

  it('반복은 펼치고 취소 회차는 뺀다, 예외 제목은 그 회차 값', () => {
    const series = weekly(
      '운동',
      '2026-11-02T07:00:00',
      '2026-11-02T08:00:00',
      { repeat: 'WEEKLY' },
    );
    const daily = [
      series,
      weekly('스터디', '2026-11-03T20:00:00', '2026-11-03T21:00:00', {
        exceptions: [{ occurrence: '2026-11-17', cancelled: true }],
      }),
      weekly('회의', '2026-11-04T10:00:00', '2026-11-04T11:00:00', {
        exceptions: [
          { occurrence: '2026-11-18', cancelled: false, title: '회의 (본사)' },
        ],
      }),
    ];
    const list = weekOccurrences([], daily, FROM, TO);
    expect(list.map((o) => o.title)).toEqual(['운동', '회의 (본사)']);
  });
});

describe('이번 주 기념일 (요약 꼬리)', () => {
  it('가장 이른 날, 그날 안에서는 N주년 > N일 > 매년. 알림 시점과 무관', () => {
    const list = [
      { name: '하늘 생일', date: '2000-11-20', kind: 'YEARLY' as const },
      { name: '처음 만난 날', date: '2025-11-20', kind: 'COUNT_UP' as const },
      { name: '이사', date: '2026-02-01', kind: 'ONCE' as const },
    ];
    expect(weekAnniversary(list, MONDAY)).toEqual({
      date: '2026-11-20',
      title: '처음 만난 날 1주년',
    });
    expect(weekAnniversary([list[0]], MONDAY)).toEqual({
      date: '2026-11-20',
      title: '하늘 생일',
    });
    expect(weekAnniversary([list[2]], MONDAY)).toBeNull();
  });
});

describe('깨우기 조건 (변형 판정 3, D-205)', () => {
  const ok: NudgeFacts = {
    type: 'TEAM',
    memberCount: 2,
    groupCreatedAt: new Date(NOW.getTime() - 30 * DAY_MS),
    recentOccurrences: 0,
    recentCreated: 0,
    lastCreatedAt: new Date(NOW.getTime() - 40 * DAY_MS),
    nudgedRecently: false,
  };

  it.each<[string, Partial<NudgeFacts>, boolean]>([
    ['모두 만족', {}, true],
    ['개인 팀', { type: 'PERSONAL' }, false],
    ['멤버 1명', { memberCount: 1 }, false],
    [
      '생성 14일 미만',
      { groupCreatedAt: new Date(NOW.getTime() - 13 * DAY_MS) },
      false,
    ],
    ['지난 14일 회차 있음', { recentOccurrences: 1 }, false],
    ['지난 14일 추가 기록 있음', { recentCreated: 1 }, false],
    ['이전 3번의 월요일 안에 깨우기', { nudgedRecently: true }, false],
    [
      '마지막 일정 생성 90일 경과',
      { lastCreatedAt: new Date(NOW.getTime() - 91 * DAY_MS) },
      false,
    ],
    ['일정이 없으면 팀 생성 시각, 90일 안', { lastCreatedAt: null }, true],
    [
      '일정이 없고 팀 생성 90일 경과',
      {
        lastCreatedAt: null,
        groupCreatedAt: new Date(NOW.getTime() - 100 * DAY_MS),
      },
      false,
    ],
  ])('%s', (_name, patch, expected) => {
    expect(nudgeEligible({ ...ok, ...patch }, NOW)).toBe(expected);
  });

  it('decideWeekly: N >= 1 SUMMARY, N = 0 이면 깨우기 조건과 빈 시간 1개 이상일 때 NUDGE, 아니면 보내지 않음', () => {
    expect(decideWeekly(3, false, 0)).toBe('SUMMARY');
    expect(decideWeekly(0, true, 2)).toBe('NUDGE');
    expect(decideWeekly(0, true, 0)).toBeNull();
    expect(decideWeekly(0, false, 5)).toBeNull();
  });
});

describe('깨우기 빈 시간 (빈 시간 찾기 규칙)', () => {
  it('09:00 ~ 23:00, 최소 2시간, 종일 제외, 다른 팀 일정과 #248 참여자', () => {
    const from = kst('2026-11-16T09:30:00');
    const to = kst('2026-11-17T00:00:00');
    const slots = nudgeSlots(
      {
        once: [
          // 멤버 1 의 다른 팀 일정 (모두) → 바쁨
          {
            startsAt: kst('2026-11-16T10:00:00'),
            endsAt: kst('2026-11-16T20:00:00'),
            allMembers: true,
            participantIds: [],
          },
          // 멤버가 아닌 사람만 참여 → 바쁘지 않음
          {
            startsAt: kst('2026-11-16T20:00:00'),
            endsAt: kst('2026-11-16T23:00:00'),
            allMembers: false,
            participantIds: [99],
          },
        ],
        series: [],
      },
      [1, 2],
      from,
      to,
    );
    expect(slots).toEqual([
      {
        startsAt: kst('2026-11-16T20:00:00'),
        endsAt: kst('2026-11-16T23:00:00'),
      },
    ]);
  });

  it('반복 바쁨은 펼친다. 종일 회차는 바쁨이 아니다', () => {
    const from = kst('2026-11-16T09:00:00');
    const to = kst('2026-11-17T00:00:00');
    const series = {
      startsAt: kst('2026-11-02T09:00:00'),
      endsAt: kst('2026-11-02T22:00:00'),
      allDay: false,
      repeat: 'WEEKLY' as const,
      repeatUntil: null,
      repeatAnchor: null,
      exceptions: [],
      allMembers: true,
      participantIds: [],
    };
    expect(
      nudgeSlots({ once: [], series: [series] }, [1, 2], from, to),
    ).toEqual([]);
    const allDay = {
      ...series,
      allDay: true,
      startsAt: kst('2026-11-02T00:00:00'),
      endsAt: kst('2026-11-03T00:00:00'),
    };
    expect(
      nudgeSlots({ once: [], series: [allDay] }, [1, 2], from, to),
    ).toHaveLength(1);
  });
});

describe('WeeklyPlanner', () => {
  let push: RepositoryMock<PushPlanningRepository> &
    RepositoryMock<PushNotificationsRepository> &
    RepositoryMock<PushLeaseRepository>;
  let planner: WeeklyPlanner;
  const group: WeeklyGroup = {
    name: '우리',
    publicCode: 'abcd2345',
    type: 'TEAM',
    createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
    memberIds: [1, 2],
  };

  beforeEach(() => {
    push = {
      ...mockRepository(PushPlanningRepository),
      ...mockRepository(PushNotificationsRepository),
      ...mockRepository(PushLeaseRepository),
    };
    planner = new WeeklyPlanner(push as never, push as never, push as never);
    push.createNotifications.mockImplementation(async (rows) => rows.length);
    push.setWeeklyDoneOn.mockResolvedValue(undefined);
    push.listWeeklyGroupIds.mockResolvedValue([3, 4]);
    push.findWeeklyGroup.mockResolvedValue(group);
    push.listWeeklyEvents.mockResolvedValue({ once: [], series: [] });
    push.listGroupAnniversaries.mockResolvedValue([]);
    push.countCreatedLogsSince.mockResolvedValue(0);
    push.lastEventCreatedAt.mockResolvedValue(
      new Date(NOW.getTime() - 30 * DAY_MS),
    );
    push.hasNudgeSince.mockResolvedValue(false);
    push.listWeeklyBusy.mockResolvedValue({ once: [], series: [] });
  });

  it('plan: 월요일 09:00 ~ 12:00 에 한 번. 예약하고 그 월요일을 적는다', async () => {
    push.getWeeklyDoneOn.mockResolvedValue('2026-11-09');
    expect(await planner.plan(NOW)).toBe(2);
    expect(
      push.createNotifications.mock.calls[0][0].map((row) => row.dedupeKey),
    ).toEqual(['W:3:2026-11-16', 'W:4:2026-11-16']);
    expect(push.setWeeklyDoneOn).toHaveBeenCalledWith(MONDAY);
  });

  it('plan: 이미 한 주, 월요일이 아닌 날은 아무것도 안 한다', async () => {
    push.getWeeklyDoneOn.mockResolvedValue(MONDAY);
    expect(await planner.plan(NOW)).toBe(0);
    push.getWeeklyDoneOn.mockResolvedValue(null);
    expect(await planner.plan(kst('2026-11-17T09:03:00'))).toBe(0);
    expect(push.createNotifications).not.toHaveBeenCalled();
  });

  it('build: 회차가 있으면 SUMMARY (기념일 꼬리 포함)', async () => {
    push.listWeeklyEvents.mockResolvedValue({
      once: [
        once('저녁 약속', '2026-11-18T19:00:00', '2026-11-18T21:00:00'),
        once('점심', '2026-11-16T12:00:00', '2026-11-16T13:00:00'),
      ],
      series: [],
    });
    push.listGroupAnniversaries.mockResolvedValue([
      { name: '처음 만난 날', date: '2025-11-20', kind: 'COUNT_UP' },
    ]);
    const built = await planner.build(3, MONDAY, NOW);
    expect(built?.variant).toBe('SUMMARY');
    expect(built?.payload).toMatchObject({
      title: '이번 주 일정 2개',
      body: '월 점심, 수 저녁 약속. 금요일은 처음 만난 날 1주년이에요',
      url: '/upcoming?team=abcd2345',
      variant: 'SUMMARY',
    });
    expect(push.hasNudgeSince).not.toHaveBeenCalled();
  });

  it('build: 조건을 만족하는 조용한 팀은 NUDGE (빈 시간은 지금을 30분 경계로 올린 시각부터)', async () => {
    const built = await planner.build(3, MONDAY, NOW);
    expect(built?.variant).toBe('NUDGE');
    expect(built?.payload).toMatchObject({
      title: '2주 동안 같이 잡은 일정이 없어요',
      body: '이번 주 다 같이 비는 시간: 월 오전 9:30~오후 11:00 외 6개',
      url: '/free?team=abcd2345',
    });
    // 4주 간격: 이전 3번의 월요일 00:00 KST 부터
    expect(push.hasNudgeSince).toHaveBeenCalledWith(
      3,
      kst('2026-10-26T00:00:00'),
    );
    expect(push.listWeeklyBusy).toHaveBeenCalledWith(
      [1, 2],
      kst('2026-11-16T09:30:00'),
      TO,
    );
  });

  it('build: 깨우기 조건이 아니면 null, 개인 팀과 멤버 1명은 쿼리 없이 null', async () => {
    push.hasNudgeSince.mockResolvedValue(true);
    expect(await planner.build(3, MONDAY, NOW)).toBeNull();
    push.findWeeklyGroup.mockResolvedValue({
      ...group,
      type: 'PERSONAL',
      memberIds: [1],
    });
    push.countCreatedLogsSince.mockClear();
    expect(await planner.build(3, MONDAY, NOW)).toBeNull();
    expect(push.countCreatedLogsSince).not.toHaveBeenCalled();
  });

  it('build: 빈 시간이 0개면 null, 팀이 지워졌으면 null', async () => {
    push.listWeeklyBusy.mockResolvedValue({
      once: [
        {
          startsAt: kst('2026-11-16T09:00:00'),
          endsAt: kst('2026-11-23T00:00:00'),
          allMembers: true,
          participantIds: [],
        },
      ],
      series: [],
    });
    expect(await planner.build(3, MONDAY, NOW)).toBeNull();
    push.findWeeklyGroup.mockResolvedValue(null);
    expect(await planner.build(3, MONDAY, NOW)).toBeNull();
  });

  it('build: 지난 14일에 회차가 있으면 깨우지 않는다 (지난 14일 구간을 읽는다)', async () => {
    push.listWeeklyEvents.mockImplementation(async (_groupId, from) =>
      from.getTime() < FROM.getTime()
        ? {
            once: [
              once('지난 약속', '2026-11-10T19:00:00', '2026-11-10T20:00:00'),
            ],
            series: [],
          }
        : { once: [], series: [] },
    );
    expect(await planner.build(3, MONDAY, NOW)).toBeNull();
    expect(push.listWeeklyEvents).toHaveBeenCalledWith(
      3,
      kst('2026-11-02T00:00:00'),
      FROM,
    );
  });

  it('build: 월요일 끝까지 늦어 남은 주가 없으면 null (방어)', async () => {
    expect(
      await planner.build(3, MONDAY, kst('2026-11-23T00:10:00')),
    ).toBeNull();
  });
});
