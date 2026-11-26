import { addDays } from '../src/events/recurrence.js';
import { MeService } from '../src/me/me.service.js';
import { PREFERENCE_DEFAULTS } from '../src/notification-preferences/notification-preferences.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  planAnniversaries,
  planBirthdays,
} from '../src/push/anniversary-planner.js';
import { PushDevicesService } from '../src/push/push-devices.service.js';
import type { NotificationSettings } from '../src/push/push-devices.repository.js';
import {
  type AnniversaryPlanRow,
  type BirthdayPlanRow,
  PushPlanningRepository,
} from '../src/push/push-planning.repository.js';
import {
  PushRecipientsRepository,
  type SettingKind,
} from '../src/push/push-recipients.repository.js';
import { createTestApp, devLogin, resetDb, type TestApp } from './helpers.js';

/**
 * (#369, D-249) 알림 설정과 알림 시점 자식 행의 동치. 실제 MySQL.
 * 1. 자식 행(NotificationPreference, BirthdayReminder, AnniversaryReminder)에 여러 조합을 넣는다
 *    (기본값과 다른 행, 기본값과 같은 값을 고른 행, 행 없음)
 * 2. 자식 행을 raw SQL 로 따로 읽어 계산한 받는 사람, 예약 == Repository 결과 (Prisma 의 none/some 조건과 다른 길)
 * 3. 설정 GET, 내 생일 시점 == 넣은 값(행 없으면 기본값)
 * (#376, D-253) 옛 칸 13개를 DROP 하면서 옛 칸 쓰기와 이전 SQL 단계는 지웠다. 옛 칸이 없는지도 여기서 본다
 */

/** 설정 API 키 ↔ 알림 종류 */
const SETTINGS: { key: keyof NotificationSettings; kind: SettingKind }[] = [
  { key: 'reminder', kind: 'REMINDER' },
  { key: 'change', kind: 'CHANGE' },
  { key: 'anniversary', kind: 'ANNIVERSARY' },
  { key: 'join', kind: 'JOIN' },
  { key: 'weekly', kind: 'WEEKLY' },
  { key: 'weeklyNudge', kind: 'WEEKLY_NUDGE' },
  { key: 'poll', kind: 'POLL' },
  { key: 'notice', kind: 'NOTICE' },
];
const OFFSET_NAMES = ['DAY_OF', 'DAY_BEFORE', 'WEEK_BEFORE'] as const;
type OffsetName = (typeof OFFSET_NAMES)[number];

/** (#376) 지운 옛 칸 */
const DROPPED_USER_COLUMNS = [
  'notifyReminder',
  'notifyChange',
  'notifyAnniversary',
  'notifyJoin',
  'notifyWeekly',
  'notifyWeeklyNudge',
  'notifyPoll',
  'birthdayRemindDayOf',
  'birthdayRemindDayBefore',
  'birthdayRemindWeekBefore',
];
const DROPPED_ANNIVERSARY_COLUMNS = [
  'remindDayOf',
  'remindDayBefore',
  'remindWeekBefore',
];

/** 결정적 의사 난수 (mulberry32) */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 칸 모양 (계획 행의 remindDayOf 등. DB 칸이 아니라 메모리 안 모양) */
const flags = (offsets: readonly OffsetName[]) => ({
  remindDayOf: offsets.includes('DAY_OF'),
  remindDayBefore: offsets.includes('DAY_BEFORE'),
  remindWeekBefore: offsets.includes('WEEK_BEFORE'),
});

describe('알림 설정 자식 행 동치 (e2e, #369, #376)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let planning: PushPlanningRepository;
  let recipients: PushRecipientsRepository;
  const groupIds: number[] = [];
  const userIds: number[] = [];
  /** 넣은 값 (행이 없으면 기본값) */
  const expectedSettings = new Map<number, NotificationSettings>();
  const expectedBirthday = new Map<
    number,
    {
      date: string | null;
      calendar: 'SOLAR' | 'LUNAR';
      isLeapMonth: boolean;
      reminders: OffsetName[];
    }
  >();

  const sql = <T>(query: string) => prisma.$queryRawUnsafe<T[]>(query);
  const b = (value: unknown) => Number(value) === 1;

  /** 그 종류가 켜짐: 행이 있으면 enabled, 없으면 기본값 (raw SQL) */
  const settingOn = (kind: SettingKind, user = 'u') =>
    `COALESCE((SELECT p.enabled FROM NotificationPreference p WHERE p.userId = ${user}.id AND p.kind = '${kind}'), ${PREFERENCE_DEFAULTS[kind] ? 1 : 0}) = 1`;
  const hasOffset = (
    table: string,
    parent: string,
    id: string,
    offset: OffsetName,
  ) =>
    `EXISTS (SELECT 1 FROM ${table} r WHERE r.${parent} = ${id} AND r.\`offset\` = '${offset}')`;

  /** 지금 팀원 × 기기 중 그 종류와 팀 알림이 켜진 것 */
  const sqlRecipients = async (groupId: number, kind: SettingKind) =>
    (
      await sql<{ userId: number; token: string }>(
        `SELECT m.userId, d.token FROM Membership m JOIN \`User\` u ON u.id = m.userId JOIN PushDevice d ON d.userId = m.userId
         WHERE m.groupId = ${groupId} AND m.notify = 1 AND ${settingOn(kind)}`,
      )
    )
      .map((row) => `${row.userId}:${row.token}`)
      .sort();
  const keys = (rows: { userId: number; token: string }[]) =>
    rows.map((row) => `${row.userId}:${row.token}`).sort();

  const sqlWeeklyGroupIds = async () =>
    (
      await sql<{ id: number }>(
        `SELECT g.id FROM \`Group\` g WHERE EXISTS (SELECT 1 FROM Membership m JOIN \`User\` u ON u.id = m.userId
         WHERE m.groupId = g.id AND m.notify = 1 AND (${settingOn('WEEKLY')} OR ${settingOn('WEEKLY_NUDGE')})
         AND EXISTS (SELECT 1 FROM PushDevice d WHERE d.userId = u.id)) ORDER BY g.id`,
      )
    ).map((row) => Number(row.id));

  /** 생일 알림 재료 (raw SQL) */
  const sqlBirthdays = async (): Promise<BirthdayPlanRow[]> =>
    (
      await sql<Record<string, unknown>>(
        `SELECT m.userId, m.groupId, g.name AS groupName, g.publicCode AS groupCode, COALESCE(m.displayName, u.nickname) AS name, u.birthday, u.birthdayCalendar, u.birthdayLeapMonth,
         ${OFFSET_NAMES.map((o) => `${hasOffset('BirthdayReminder', 'userId', 'u.id', o)} AS \`${o}\``).join(', ')}
         FROM Membership m JOIN \`Group\` g ON g.id = m.groupId JOIN \`User\` u ON u.id = m.userId
         WHERE m.showBirthday = 1 AND g.type = 'TEAM' AND u.birthday IS NOT NULL
         AND EXISTS (SELECT 1 FROM BirthdayReminder r WHERE r.userId = u.id) ORDER BY m.id`,
      )
    ).map((row) => ({
      userId: Number(row.userId),
      groupId: Number(row.groupId),
      groupName: String(row.groupName),
      groupCode: String(row.groupCode),
      name: String(row.name),
      birthday: {
        date: String(row.birthday),
        calendar: row.birthdayCalendar as 'SOLAR' | 'LUNAR',
        isLeapMonth: b(row.birthdayLeapMonth),
      },
      ...flags(OFFSET_NAMES.filter((o) => b(row[o]))),
    }));

  /** 기념일 알림 재료 (raw SQL) */
  const sqlAnniversaries = async (): Promise<AnniversaryPlanRow[]> =>
    (
      await sql<Record<string, unknown>>(
        `SELECT a.id, a.groupId, a.name, DATE_FORMAT(a.date, '%Y-%m-%d') AS date, a.kind, a.calendar, a.isLeapMonth, a.updatedAt,
         ${OFFSET_NAMES.map((o) => `${hasOffset('AnniversaryReminder', 'anniversaryId', 'a.id', o)} AS \`${o}\``).join(', ')},
         g.name AS groupName, g.publicCode AS groupCode
         FROM Anniversary a JOIN \`Group\` g ON g.id = a.groupId
         WHERE EXISTS (SELECT 1 FROM AnniversaryReminder r WHERE r.anniversaryId = a.id) ORDER BY a.id`,
      )
    ).map((row) => ({
      id: Number(row.id),
      groupId: Number(row.groupId),
      name: String(row.name),
      date: String(row.date),
      kind: row.kind as AnniversaryPlanRow['kind'],
      calendar: row.calendar as AnniversaryPlanRow['calendar'],
      isLeapMonth: b(row.isLeapMonth),
      ...flags(OFFSET_NAMES.filter((o) => b(row[o]))),
      updatedAt: row.updatedAt as Date,
      groupName: String(row.groupName),
      groupCode: String(row.groupCode),
    }));

  /** 2년(평년 + 윤년) 매일 예약 결과 */
  const days = Array.from({ length: 731 }, (_, i) => addDays('2027-01-01', i));
  const planAll = <T>(rows: T[], plan: (rows: T[], day: string) => unknown[]) =>
    days.flatMap((day) => plan(rows, day));

  async function expectSameAsRows(): Promise<void> {
    for (const groupId of groupIds) {
      for (const { kind } of SETTINGS) {
        const expected = await sqlRecipients(groupId, kind);
        const actual =
          kind === 'POLL'
            ? await recipients.listPollRecipients(groupId, null, null, null)
            : await recipients.listRecipients(
                groupId,
                kind === 'WEEKLY_NUDGE' ? 'WEEKLY' : kind,
                null,
                null,
                null,
                kind,
              );
        expect({ groupId, kind, recipients: keys(actual) }).toEqual({
          groupId,
          kind,
          recipients: expected,
        });
      }
    }
    expect(await planning.listWeeklyGroupIds()).toEqual(
      await sqlWeeklyGroupIds(),
    );

    const settings = app.get(PushDevicesService);
    const me = app.get(MeService);
    for (const id of userIds) {
      expect({ id, settings: await settings.settings(id) }).toEqual({
        id,
        settings: expectedSettings.get(id),
      });
      const profile = await me.getProfile({
        id,
        nickname: 'u',
        profileImageUrl: null,
        createdAt: new Date(),
      });
      expect({ id, birthday: profile.birthday }).toEqual({
        id,
        birthday: expectedBirthday.get(id),
      });
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    planning = app.get(PushPlanningRepository);
    recipients = app.get(PushRecipientsRepository);
    await resetDb(app);
    const random = rng(369);
    const flip = () => random() < 0.5;

    for (let g = 1; g <= 4; g++) {
      groupIds.push(
        (
          await prisma.group.create({
            data: { type: 'TEAM', name: `팀${g}`, publicCode: `nprf000${g}` },
          })
        ).id,
      );
    }
    groupIds.push(
      (
        await prisma.group.create({
          data: { type: 'PERSONAL', name: '나', publicCode: 'nprf0005' },
        })
      ).id,
    );

    // 사용자 80명: 모두 기본값(행 없음), 모두 반대, 종류나 시점 하나씩만 반대(10명), 나머지 무작위.
    // 무작위 사용자는 기본값과 같은 값도 절반쯤 행으로 남긴다 (PATCH 로 고른 값)
    const defaults = [
      ...SETTINGS.map((s) => PREFERENCE_DEFAULTS[s.kind]),
      true,
      false,
      false,
    ];
    for (let i = 0; i < 80; i++) {
      let values: boolean[];
      if (i === 0) values = [...defaults];
      else if (i === 1) values = defaults.map((v) => !v);
      else if (i < 12) values = defaults.map((v, k) => (k === i - 2 ? !v : v));
      else values = defaults.map(flip);
      const birthday =
        i % 3 === 0
          ? null
          : i === 4
            ? '02-29'
            : `${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
      const offsets = OFFSET_NAMES.filter(
        (_, k) => values[SETTINGS.length + k],
      );
      const preferences = SETTINGS.flatMap((s, k) =>
        values[k] !== PREFERENCE_DEFAULTS[s.kind] || (i >= 12 && flip())
          ? [{ kind: s.kind, enabled: values[k] }]
          : [],
      );
      const user = await prisma.user.create({
        data: {
          nickname: `u${i}`,
          birthday,
          notificationPreferences: { create: preferences },
          birthdayReminders: {
            create: offsets.map((offset) => ({ offset })),
          },
        },
      });
      userIds.push(user.id);
      expectedSettings.set(
        user.id,
        Object.fromEntries(
          SETTINGS.map((s, k) => [s.key, values[k]]),
        ) as unknown as NotificationSettings,
      );
      expectedBirthday.set(user.id, {
        date: birthday,
        calendar: 'SOLAR',
        isLeapMonth: false,
        reminders: offsets,
      });

      const mine = new Set([groupIds[i % 4]]);
      if (i % 2 === 0) mine.add(groupIds[(i * 3) % 4]);
      if (i % 11 === 0) mine.add(groupIds[4]);
      for (const groupId of mine) {
        await prisma.membership.create({
          data: {
            userId: user.id,
            groupId,
            color: '#3B82F6',
            notify: (i + groupId) % 5 !== 0,
            showBirthday: (i + groupId) % 7 !== 0,
            displayName: i % 4 === 0 ? `표시${i}` : null,
          },
        });
      }
      if (i % 7 !== 0)
        await prisma.pushDevice.create({
          data: {
            userId: user.id,
            token: `ExponentPushToken[np${i}a]`,
            platform: 'IOS',
            appVersion: '1.0.0',
          },
        });
      if (i % 9 === 0)
        await prisma.pushDevice.create({
          data: {
            userId: user.id,
            token: `ExponentPushToken[np${i}b]`,
            platform: 'ANDROID',
            appVersion: '1.0.0',
          },
        });
    }

    // 기념일: 시점 8조합 × 종류 3 × 날짜 2 (2월 29일 포함)
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    for (const kind of ['COUNT_UP', 'YEARLY', 'ONCE'] as const) {
      for (let combo = 0; combo < 8; combo++) {
        for (const date of ['2024-02-29', '2026-08-03']) {
          await prisma.anniversary.create({
            data: {
              groupId: groupIds[combo % 4],
              name: `${kind}-${combo}`,
              date: new Date(
                `${kind === 'ONCE' ? date.replace(/^\d{4}/, '2027') : date}T00:00:00.000Z`,
              ),
              kind,
              reminders: {
                create: OFFSET_NAMES.filter(
                  (_, k) => (combo & (1 << k)) !== 0,
                ).map((offset) => ({ offset })),
              },
              updatedAt,
            },
          });
        }
      }
    }
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('(#376) User, Anniversary 에 옛 알림 칸 13개가 없다', async () => {
    const columns = await sql<{ table: string; column: string }>(
      `SELECT TABLE_NAME AS \`table\`, COLUMN_NAME AS \`column\` FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('User', 'Anniversary')`,
    );
    const names = (table: string) =>
      columns.filter((c) => c.table === table).map((c) => c.column);
    expect(names('User')).toContain('birthday');
    expect(names('Anniversary')).toContain('kind');
    expect(
      names('User').filter((c) => DROPPED_USER_COLUMNS.includes(c)),
    ).toEqual([]);
    expect(
      names('Anniversary').filter((c) =>
        DROPPED_ANNIVERSARY_COLUMNS.includes(c),
      ),
    ).toEqual([]);
  });

  it('넣은 행: 기본값과 다른 종류, 기본값과 같은 값을 고른 종류, 기념일 시점 8조합이 다 있다', async () => {
    const prefs = await prisma.notificationPreference.findMany();
    expect(
      prefs.filter((p) => p.enabled !== PREFERENCE_DEFAULTS[p.kind]).length,
    ).toBeGreaterThan(50);
    expect(
      prefs.filter((p) => p.enabled === PREFERENCE_DEFAULTS[p.kind]).length,
    ).toBeGreaterThan(20);
    const anniversaries = await prisma.anniversary.findMany({
      select: { reminders: { select: { offset: true } } },
    });
    expect(anniversaries).toHaveLength(48);
    expect(
      new Set(
        anniversaries.map((a) =>
          a.reminders
            .map((r) => r.offset)
            .sort()
            .join(','),
        ),
      ).size,
    ).toBe(8);
  });

  it('푸시 종류마다 받는 사람, 주간 알림 팀, 설정 GET, 내 생일 시점이 행과 같다', async () => {
    await expectSameAsRows();
  });

  it('기념일 알림: 시점 8조합 모두 2년 매일 예약이 행과 같다', async () => {
    const actual = await planning.listAnniversaries();
    const expected = await sqlAnniversaries();
    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(42);
    const planned = planAll(actual, planAnniversaries);
    expect(planned).toEqual(planAll(expected, planAnniversaries));
    expect(planned.length).toBeGreaterThan(100);
  });

  it('생일 알림: 2년 매일 예약이 행과 같다', async () => {
    const actual = await planning.listBirthdays();
    const expected = await sqlBirthdays();
    expect(actual).toEqual(expected);
    const planned = planAll(actual, planBirthdays);
    expect(planned).toEqual(planAll(expected, planBirthdays));
    expect(planned.length).toBeGreaterThan(50);
  });

  it('설정 PATCH(기본값과 같은 값 포함)와 생일 시점 PATCH 뒤에도 GET 왕복, 받는 사람, 예약이 행과 같다', async () => {
    const settings = app.get(PushDevicesService);
    const me = app.get(MeService);
    const random = rng(2026);
    for (const id of userIds.slice(0, 40)) {
      const patch = Object.fromEntries(
        SETTINGS.filter(() => random() < 0.6).map((s) => [
          s.key,
          random() < 0.5,
        ]),
      ) as Partial<NotificationSettings>;
      const before = await settings.settings(id);
      const after = await settings.updateSettings(id, patch);
      expect(after).toEqual({ ...before, ...patch });
      expect(await settings.settings(id)).toEqual(after);
      expectedSettings.set(id, after);
      // 고른 값은 기본값과 같아도 행으로 남는다
      for (const s of SETTINGS.filter((s) => s.key in patch))
        expect(
          await prisma.notificationPreference.findUnique({
            where: { userId_kind: { userId: id, kind: s.kind } },
            select: { enabled: true },
          }),
        ).toEqual({ enabled: patch[s.key] });

      const combo = id % 8;
      const reminders = OFFSET_NAMES.filter((_, i) => (combo & (1 << i)) !== 0);
      const saved = await me.updateBirthday(id, {
        date: '05-05',
        reminders: [...reminders].reverse(),
      });
      expect(saved).toEqual({
        date: '05-05',
        calendar: 'SOLAR',
        isLeapMonth: false,
        reminders,
      });
      expectedBirthday.set(id, {
        date: '05-05',
        calendar: 'SOLAR',
        isLeapMonth: false,
        reminders,
      });
    }
    // 시점 생략은 그대로, 생일을 지워도 시점은 남는다 (#305 그대로)
    const id = userIds[3];
    const kept = expectedBirthday.get(id)!.reminders;
    expect((await me.updateBirthday(id, { date: null })).reminders).toEqual(
      kept,
    );
    expectedBirthday.set(id, {
      date: null,
      calendar: 'SOLAR',
      isLeapMonth: false,
      reminders: kept,
    });

    await expectSameAsRows();
    expect(await planning.listBirthdays()).toEqual(await sqlBirthdays());
  });

  it('가입하면 생일 알림 시점은 당일 하나, 알림 종류는 행 없이 기본값', async () => {
    const res = await devLogin(app, '새사람');
    expect(
      await prisma.birthdayReminder.findMany({
        where: { userId: res.userId },
        select: { offset: true },
      }),
    ).toEqual([{ offset: 'DAY_OF' }]);
    expect(
      await prisma.notificationPreference.count({
        where: { userId: res.userId },
      }),
    ).toBe(0);
    expect(await app.get(PushDevicesService).settings(res.userId)).toEqual({
      reminder: true,
      change: true,
      anniversary: true,
      join: true,
      weekly: true,
      weeklyNudge: false,
      poll: true,
      notice: true,
    });
  });

  it('탈퇴하면 설정, 생일 시점 행이 같이 지워진다 (Cascade)', async () => {
    const id = userIds[1];
    expect(
      await prisma.notificationPreference.count({ where: { userId: id } }),
    ).toBeGreaterThan(0);
    await prisma.membership.deleteMany({ where: { userId: id } });
    await prisma.pushDevice.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });
    expect(
      await prisma.notificationPreference.count({ where: { userId: id } }),
    ).toBe(0);
    expect(await prisma.birthdayReminder.count({ where: { userId: id } })).toBe(
      0,
    );
  });
});
