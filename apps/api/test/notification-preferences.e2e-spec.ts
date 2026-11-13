import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addDays } from '../src/events/recurrence.js';
import { MeService } from '../src/me/me.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  planAnniversaries,
  planBirthdays,
} from '../src/push/anniversary-planner.js';
import { PushDevicesService } from '../src/push/push-devices.service.js';
import {
  type AnniversaryPlanRow,
  type BirthdayPlanRow,
  type NotificationSettings,
  PushRepository,
  type SettingKind,
} from '../src/push/push.repository.js';
import { createTestApp, devLogin, resetDb, type TestApp } from './helpers.js';

/**
 * (#369, D-249) 반복 그룹 칸 → 자식 행 이전의 동치 증명. 실제 MySQL.
 * 1. 옛 칸(User.notify*, User.birthdayRemind*, Anniversary.remind*)에 여러 조합을 넣는다
 * 2. 이번 마이그레이션의 데이터 이전 SQL 을 그대로 돌린다
 * 3. 옛 의미(칸 = 1)를 SQL 로 계산한 받는 사람, 예약, 설정 값 == 새 Repository / Service 결과
 * 옛 칸은 다음 릴리스에서 DROP 한다. 그때 이 파일의 1, 2 단계(옛 칸 쓰기)는 지운다
 */

/** 옛 칸 이름 ↔ 설정 API 키 ↔ 알림 종류 */
const SETTINGS: {
  column: string;
  key: keyof NotificationSettings;
  kind: SettingKind;
  fallback: boolean;
}[] = [
  {
    column: 'notifyReminder',
    key: 'reminder',
    kind: 'REMINDER',
    fallback: true,
  },
  { column: 'notifyChange', key: 'change', kind: 'CHANGE', fallback: true },
  {
    column: 'notifyAnniversary',
    key: 'anniversary',
    kind: 'ANNIVERSARY',
    fallback: true,
  },
  { column: 'notifyJoin', key: 'join', kind: 'JOIN', fallback: true },
  { column: 'notifyWeekly', key: 'weekly', kind: 'WEEKLY', fallback: true },
  {
    column: 'notifyWeeklyNudge',
    key: 'weeklyNudge',
    kind: 'WEEKLY_NUDGE',
    fallback: false,
  },
  { column: 'notifyPoll', key: 'poll', kind: 'POLL', fallback: true },
];
const BIRTHDAY_COLUMNS = [
  'birthdayRemindDayOf',
  'birthdayRemindDayBefore',
  'birthdayRemindWeekBefore',
] as const;
const OFFSET_NAMES = ['DAY_OF', 'DAY_BEFORE', 'WEEK_BEFORE'] as const;

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

/** 이번 마이그레이션의 SQL 에서 데이터 이전 문장(DELETE, INSERT)만 */
function migrationCopyStatements(): string[] {
  const dir = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
  const name = readdirSync(dir).find((entry) =>
    entry.endsWith('_notification_preferences'),
  );
  if (!name) throw new Error('notification_preferences 마이그레이션이 없어요');
  const sql = readFileSync(`${dir}${name}/migration.sql`, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => /^(DELETE|INSERT)/.test(statement));
}

describe('알림 설정 자식 행 이전 동치 (e2e, #369)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let push: PushRepository;
  const groupIds: number[] = [];
  const userIds: number[] = [];

  const sql = <T>(query: string) => prisma.$queryRawUnsafe<T[]>(query);
  const b = (value: unknown) => Number(value) === 1;

  /** 옛 의미: 지금 팀원 × 기기 중 그 칸과 팀 알림이 켜진 것 (`user: { notifyX: true }` 그대로) */
  const oldRecipients = async (groupId: number, column: string) =>
    (
      await sql<{ userId: number; token: string }>(
        `SELECT m.userId, d.token FROM Membership m JOIN \`User\` u ON u.id = m.userId JOIN PushDevice d ON d.userId = m.userId
         WHERE m.groupId = ${groupId} AND m.notify = 1 AND u.${column} = 1`,
      )
    )
      .map((row) => `${row.userId}:${row.token}`)
      .sort();
  const keys = (rows: { userId: number; token: string }[]) =>
    rows.map((row) => `${row.userId}:${row.token}`).sort();

  const oldWeeklyGroupIds = async () =>
    (
      await sql<{ id: number }>(
        `SELECT g.id FROM \`Group\` g WHERE EXISTS (SELECT 1 FROM Membership m JOIN \`User\` u ON u.id = m.userId
         WHERE m.groupId = g.id AND m.notify = 1 AND (u.notifyWeekly = 1 OR u.notifyWeeklyNudge = 1)
         AND EXISTS (SELECT 1 FROM PushDevice d WHERE d.userId = u.id)) ORDER BY g.id`,
      )
    ).map((row) => Number(row.id));

  /** 옛 listBirthdays (칸에서 읽은 시점) */
  const oldBirthdays = async (): Promise<BirthdayPlanRow[]> =>
    (
      await sql<Record<string, unknown>>(
        `SELECT m.userId, m.groupId, g.name AS groupName, g.publicCode AS groupCode, COALESCE(m.displayName, u.nickname) AS name, u.birthday,
         u.birthdayRemindDayOf, u.birthdayRemindDayBefore, u.birthdayRemindWeekBefore
         FROM Membership m JOIN \`Group\` g ON g.id = m.groupId JOIN \`User\` u ON u.id = m.userId
         WHERE m.showBirthday = 1 AND g.type = 'TEAM' AND u.birthday IS NOT NULL
         AND (u.birthdayRemindDayOf = 1 OR u.birthdayRemindDayBefore = 1 OR u.birthdayRemindWeekBefore = 1) ORDER BY m.id`,
      )
    ).map((row) => ({
      userId: Number(row.userId),
      groupId: Number(row.groupId),
      groupName: String(row.groupName),
      groupCode: String(row.groupCode),
      name: String(row.name),
      birthday: String(row.birthday),
      remindDayOf: b(row.birthdayRemindDayOf),
      remindDayBefore: b(row.birthdayRemindDayBefore),
      remindWeekBefore: b(row.birthdayRemindWeekBefore),
    }));

  /** 옛 listAnniversaries */
  const oldAnniversaries = async (): Promise<AnniversaryPlanRow[]> =>
    (
      await sql<Record<string, unknown>>(
        `SELECT a.id, a.groupId, a.name, DATE_FORMAT(a.date, '%Y-%m-%d') AS date, a.kind, a.remindDayOf, a.remindDayBefore, a.remindWeekBefore, a.updatedAt,
         g.name AS groupName, g.publicCode AS groupCode
         FROM Anniversary a JOIN \`Group\` g ON g.id = a.groupId
         WHERE a.remindDayOf = 1 OR a.remindDayBefore = 1 OR a.remindWeekBefore = 1 ORDER BY a.id`,
      )
    ).map((row) => ({
      id: Number(row.id),
      groupId: Number(row.groupId),
      name: String(row.name),
      date: String(row.date),
      kind: row.kind as AnniversaryPlanRow['kind'],
      remindDayOf: b(row.remindDayOf),
      remindDayBefore: b(row.remindDayBefore),
      remindWeekBefore: b(row.remindWeekBefore),
      updatedAt: row.updatedAt as Date,
      groupName: String(row.groupName),
      groupCode: String(row.groupCode),
    }));

  /** 2년(평년 + 윤년) 매일 예약 결과 */
  const days = Array.from({ length: 731 }, (_, i) => addDays('2027-01-01', i));
  const planAll = <T>(rows: T[], plan: (rows: T[], day: string) => unknown[]) =>
    days.flatMap((day) => plan(rows, day));

  async function expectSameAsColumns(): Promise<void> {
    for (const groupId of groupIds) {
      for (const { column, kind } of SETTINGS) {
        const expected = await oldRecipients(groupId, column);
        const actual =
          kind === 'POLL'
            ? await push.listPollRecipients(groupId, null, null, null)
            : await push.listRecipients(
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
    expect(await push.listWeeklyGroupIds()).toEqual(await oldWeeklyGroupIds());

    const settings = app.get(PushDevicesService);
    const me = app.get(MeService);
    const columns = await sql<Record<string, unknown>>(
      `SELECT * FROM \`User\` ORDER BY id`,
    );
    for (const row of columns) {
      const id = Number(row.id);
      expect({ id, settings: await settings.settings(id) }).toEqual({
        id,
        settings: Object.fromEntries(
          SETTINGS.map((s) => [s.key, b(row[s.column])]),
        ),
      });
      const profile = await me.getProfile({
        id,
        nickname: String(row.nickname),
        profileImageUrl: null,
        createdAt: row.createdAt as Date,
      });
      const reminders = OFFSET_NAMES.filter((_, i) =>
        b(row[BIRTHDAY_COLUMNS[i]]),
      );
      expect({ id, birthday: profile.birthday }).toEqual({
        id,
        birthday: { date: (row.birthday as string | null) ?? null, reminders },
      });
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    push = app.get(PushRepository);
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

    // 사용자 80명: 모두 기본값, 모두 반대, 칸 하나씩만 반대(10명), 나머지 무작위. 옛 칸에 직접 넣는다 (새 코드는 칸을 쓰지 않는다)
    const allColumns = [...SETTINGS.map((s) => s.column), ...BIRTHDAY_COLUMNS];
    const defaults = [...SETTINGS.map((s) => s.fallback), true, false, false];
    for (let i = 0; i < 80; i++) {
      let values: boolean[];
      if (i === 0) values = [...defaults];
      else if (i === 1) values = defaults.map((v) => !v);
      else if (i < 12) values = defaults.map((v, k) => (k === i - 2 ? !v : v));
      else values = allColumns.map(flip);
      const birthday =
        i % 3 === 0
          ? null
          : i === 4
            ? '02-29'
            : `${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
      const user = await prisma.user.create({
        data: {
          nickname: `u${i}`,
          birthday,
          ...Object.fromEntries(
            allColumns.map((column, k) => [column, values[k]]),
          ),
        },
      });
      userIds.push(user.id);
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
              remindDayOf: (combo & 1) !== 0,
              remindDayBefore: (combo & 2) !== 0,
              remindWeekBefore: (combo & 4) !== 0,
              updatedAt,
            },
          });
        }
      }
    }

    // 이번 마이그레이션의 데이터 이전을 그대로 (다시 돌려도 같은 결과인지도 본다)
    for (let round = 0; round < 2; round++) {
      for (const statement of migrationCopyStatements())
        await prisma.$executeRawUnsafe(statement);
    }
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('마이그레이션: 알림 종류는 기본값과 다른 칸만 행, 시점은 켜진 칸마다 행', async () => {
    const columns = await sql<Record<string, unknown>>(
      `SELECT * FROM \`User\``,
    );
    const expectedPrefs = columns.flatMap((row) =>
      SETTINGS.filter((s) => b(row[s.column]) !== s.fallback).map(
        (s) => `${Number(row.id)}:${s.kind}:${b(row[s.column])}`,
      ),
    );
    const prefs = await prisma.notificationPreference.findMany();
    expect(
      prefs.map((p) => `${p.userId}:${p.kind}:${p.enabled}`).sort(),
    ).toEqual(expectedPrefs.sort());
    expect(expectedPrefs.length).toBeGreaterThan(50);

    const expectedBirthday = columns.flatMap((row) =>
      OFFSET_NAMES.filter((_, i) => b(row[BIRTHDAY_COLUMNS[i]])).map(
        (o) => `${Number(row.id)}:${o}`,
      ),
    );
    expect(
      (await prisma.birthdayReminder.findMany())
        .map((r) => `${r.userId}:${r.offset}`)
        .sort(),
    ).toEqual(expectedBirthday.sort());

    const anniversaries = await sql<Record<string, unknown>>(
      `SELECT id, remindDayOf, remindDayBefore, remindWeekBefore FROM Anniversary`,
    );
    const expectedAnniversary = anniversaries.flatMap((row) =>
      OFFSET_NAMES.filter((_, i) =>
        b(row[['remindDayOf', 'remindDayBefore', 'remindWeekBefore'][i]]),
      ).map((o) => `${Number(row.id)}:${o}`),
    );
    expect(
      (await prisma.anniversaryReminder.findMany())
        .map((r) => `${r.anniversaryId}:${r.offset}`)
        .sort(),
    ).toEqual(expectedAnniversary.sort());
    expect(anniversaries).toHaveLength(48);
  });

  it('푸시 종류마다 받는 사람, 주간 알림 팀, 설정 GET, 내 생일 시점이 옛 칸과 같다', async () => {
    await expectSameAsColumns();
  });

  it('기념일 알림: 시점 8조합 모두 2년 매일 예약이 옛 칸과 같다', async () => {
    const actual = await push.listAnniversaries();
    const expected = await oldAnniversaries();
    expect(actual).toEqual(expected);
    const planned = planAll(actual, planAnniversaries);
    expect(planned).toEqual(planAll(expected, planAnniversaries));
    expect(planned.length).toBeGreaterThan(100);
  });

  it('생일 알림: 2년 매일 예약이 옛 칸과 같다', async () => {
    const actual = await push.listBirthdays();
    const expected = await oldBirthdays();
    expect(actual).toEqual(expected);
    const planned = planAll(actual, planBirthdays);
    expect(planned).toEqual(planAll(expected, planBirthdays));
    expect(planned.length).toBeGreaterThan(50);
  });

  it('설정 PATCH 로 바꾼 값(기본값과 같은 값을 고른 행 포함)도 같은 칸 값과 동치, GET 이 그대로 돌려준다', async () => {
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
      // 옛 칸도 같은 값으로 맞춰 두고 아래에서 옛 의미와 비교한다
      const assignments = SETTINGS.map(
        (s) => `${s.column} = ${after[s.key] ? 1 : 0}`,
      ).join(', ');
      await prisma.$executeRawUnsafe(
        `UPDATE \`User\` SET ${assignments} WHERE id = ${id}`,
      );

      const combo = id % 8;
      const reminders = OFFSET_NAMES.filter((_, i) => (combo & (1 << i)) !== 0);
      const saved = await me.updateBirthday(id, {
        date: '05-05',
        reminders: [...reminders].reverse(),
      });
      expect(saved).toEqual({ date: '05-05', reminders });
      const birthdayAssignments = BIRTHDAY_COLUMNS.map(
        (column, i) => `${column} = ${(combo & (1 << i)) !== 0 ? 1 : 0}`,
      ).join(', ');
      await prisma.$executeRawUnsafe(
        `UPDATE \`User\` SET birthday = '05-05', ${birthdayAssignments} WHERE id = ${id}`,
      );
    }
    // 시점 생략은 그대로, 생일을 지워도 시점은 남는다 (#305 그대로)
    const id = userIds[3];
    const kept = (
      await me.getProfile({
        id,
        nickname: 'u3',
        profileImageUrl: null,
        createdAt: new Date(),
      })
    ).birthday.reminders;
    expect((await me.updateBirthday(id, { date: null })).reminders).toEqual(
      kept,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE \`User\` SET birthday = NULL WHERE id = ${id}`,
    );

    await expectSameAsColumns();
    expect(await push.listBirthdays()).toEqual(await oldBirthdays());
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
