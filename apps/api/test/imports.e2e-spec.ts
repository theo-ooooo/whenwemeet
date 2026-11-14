import { vi } from 'vitest';
import { kstDate } from '../src/events/recurrence.js';
import { ImportsRepository } from '../src/imports/imports.repository.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PushScheduler } from '../src/push/push.scheduler.js';
import { FakeExpo } from './fake-expo.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

/**
 * (#279) ICS 파일로 일정 가져오기 (api.md 2.9). 미리보기는 아무것도 저장하지 않고, 넣기는 EventLog 없이
 * 새 소식 한 줄과 팀원 변경 푸시 한 건만 남긴다. 같은 파일을 다시 올리면 들어간 것은 건너뛴다
 */
describe('일정 가져오기 (e2e, #279)', () => {
  const fake = new FakeExpo();
  let app: TestApp;
  let prisma: PrismaService;
  let minji: Session;
  let jihun: Session;
  let outsider: Session;
  let groupId: number;
  let personalId: number;

  const DAY_MS = 86_400_000;
  /** 실제 오늘 기준 n 일 뒤 KST 날짜 'YYYYMMDD' */
  const dayAfter = (n: number) => kstDate(new Date(Date.now() + n * DAY_MS)).replace(/-/g, '');
  const vevent = (uid: string, date: string, title: string, extra: string[] = []) => [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART;TZID=Asia/Seoul:${date}T100000`,
    `DTEND;TZID=Asia/Seoul:${date}T110000`,
    `SUMMARY:${title}`,
    ...extra,
    'END:VEVENT',
  ];
  const ics = (...lines: string[]) => Buffer.from(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//KO', ...lines, 'END:VCALENDAR', ''].join('\r\n'));

  /** 한 번짜리 3개 + 매주 반복 1개(EXDATE 하나) + 지난 일정 1개 + 취소 1개 */
  const sample = () =>
    ics(
      ...vevent('one@test', dayAfter(2), '하나'),
      ...vevent('two@test', dayAfter(3), '둘', ['LOCATION:성수동', 'DESCRIPTION:메모']),
      ...vevent('three@test', dayAfter(4), '셋'),
      ...vevent('weekly@test', dayAfter(5), '매주', ['RRULE:FREQ=WEEKLY;COUNT=4', `EXDATE;TZID=Asia/Seoul:${dayAfter(12)}T100000`]),
      ...vevent('old@test', '20200101', '옛날'),
      ...vevent('cancel@test', dayAfter(6), '취소', ['STATUS:CANCELLED']),
    );

  const preview = (who: Session, group: number, file: Buffer | null, fields: Record<string, string> = {}) => {
    let req = api(app).post(`/v1/groups/${group}/imports/preview`).set(auth(who));
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
    return file ? req.attach('file', file, 'calendar.ics') : req;
  };
  const importFile = (who: Session, group: number, file: Buffer | null, fields: Record<string, string> = {}) => {
    let req = api(app).post(`/v1/groups/${group}/imports`).set(auth(who));
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
    return file ? req.attach('file', file, 'calendar.ics') : req;
  };
  const counts = async () => ({
    events: await prisma.event.count(),
    imports: await prisma.eventImport.count(),
    items: await prisma.eventImportItem.count(),
    activities: await prisma.groupActivity.count({ where: { type: 'EVENTS_IMPORTED' } }),
    logs: await prisma.eventLog.count(),
    pushes: await prisma.pushNotification.count({ where: { dedupeKey: { startsWith: 'I:' } } }),
  });

  beforeAll(async () => {
    await fake.start();
    process.env.EXPO_PUSH_URL = fake.url;
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
    await fake.stop();
  });

  beforeEach(async () => {
    await resetDb(app);
    fake.reset();
    vi.restoreAllMocks();
    minji = await devLogin(app, '민지');
    jihun = await devLogin(app, '지훈');
    outsider = await devLogin(app, '남');
    const team = await api(app).post('/v1/groups').set(auth(minji)).send({ name: '우리' }).expect(201);
    groupId = team.body.data.id as number;
    await api(app).post('/v1/groups/join').set(auth(jihun)).send({ code: team.body.data.inviteCode }).expect(200);
    const groups = await api(app).get('/v1/groups').set(auth(minji)).expect(200);
    personalId = (groups.body.data as { id: number; type: string }[]).find((group) => group.type === 'PERSONAL')!.id;
    await api(app)
      .put('/v1/me/push-devices')
      .set(auth(jihun))
      .send({ token: 'ExponentPushToken[jihun]', platform: 'IOS', appVersion: '1.1.0' })
      .expect(200);
    // 합류 알림은 대상이 아니다
    await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
  });

  it('미리보기는 수와 이유, 예시를 돌려주고 아무것도 저장하지 않는다', async () => {
    const before = await counts();
    const res = await preview(minji, groupId, sample()).expect(200);
    expect(res.body.data).toMatchObject({
      total: 6,
      toCreate: 4,
      recurringKept: 1,
      expanded: 0,
      skipped: [
        { reason: 'CANCELLED', count: 1 },
        { reason: 'TOO_OLD', count: 1 },
      ],
      warnings: [],
    });
    expect(res.body.data.sample.map((item: { title: string }) => item.title)).toEqual(['하나', '둘', '셋', '매주']);
    expect(await counts()).toEqual(before);
  });

  it('넣기: 팀은 넣는 시각 멤버 전원(#444, D-263), 알림 없음, EventLog 없이 새 소식 한 줄 + 푸시 한 건', async () => {
    const res = await importFile(minji, groupId, sample()).expect(201);
    expect(res.body.data).toMatchObject({ created: 4, skipped: [{ reason: 'CANCELLED', count: 1 }, { reason: 'TOO_OLD', count: 1 }] });
    expect(typeof res.body.data.importId).toBe('number');

    const events = await prisma.event.findMany({ where: { groupId }, include: { exceptions: true, participants: true }, orderBy: { startsAt: 'asc' } });
    expect(events).toHaveLength(4);
    expect(events.every((event) => !event.allMembers && event.reminder === 'NONE' && event.remindAt === null && event.creatorId === minji.userId)).toBe(true);
    const everyone = [minji.userId, jihun.userId].sort((a, b) => a - b);
    expect(events.every((event) => event.participants.map((row) => row.userId).sort((a, b) => a - b).join() === everyone.join())).toBe(true);
    // (#343) 가져온 일정의 색은 자동 (D-215)
    expect(events.every((event) => event.color === null)).toBe(true);
    expect(events.find((event) => event.title === '둘')!.memo).toBe('장소: 성수동\n메모');
    const weekly = events.find((event) => event.title === '매주')!;
    expect(weekly.repeat).toBe('WEEKLY');
    expect(weekly.exceptions).toEqual([expect.objectContaining({ cancelled: true })]);

    const after = await counts();
    expect(after).toMatchObject({ imports: 1, items: 4, activities: 1, logs: 0, pushes: 1 });
    expect(await prisma.eventImport.findFirstOrThrow()).toMatchObject({ created: 4, doneAt: expect.any(Date) });
    expect(await prisma.groupActivity.findFirstOrThrow({ where: { type: 'EVENTS_IMPORTED' } })).toMatchObject({ actorId: minji.userId, payload: { count: 4 } });

    // 지훈의 새 소식에 한 줄, 일정 줄은 없다
    const news = await api(app).get(`/v1/groups/${groupId}/news`).query({ v: '2' }).set(auth(jihun)).expect(200);
    expect(news.body.data.items).toEqual([expect.objectContaining({ kind: 'ACTIVITY', type: 'EVENTS_IMPORTED', payload: { count: 4 } })]);

    // 푸시는 지훈에게 한 건
    await app.get(PushScheduler).tick(new Date(Date.now() + 5_000));
    expect(fake.messages).toEqual([expect.objectContaining({ to: 'ExponentPushToken[jihun]', title: '민지님이 일정 4개를 가져왔어요', subtitle: '우리' })]);

    // 반복 회차 조회: EXDATE 회차는 빠진다
    const from = new Date(Date.now()).toISOString();
    const to = new Date(Date.now() + 40 * DAY_MS).toISOString();
    const list = await api(app).get(`/v1/groups/${groupId}/events`).query({ from, to }).set(auth(minji)).expect(200);
    expect((list.body.data as { title: string }[]).filter((event) => event.title === '매주')).toHaveLength(3);
  });

  it('같은 파일을 다시 올리면 모두 건너뛰고, 지운 일정도 다시 들어가지 않는다', async () => {
    await importFile(minji, groupId, sample()).expect(201);
    const one = await prisma.event.findFirstOrThrow({ where: { title: '하나' } });
    await api(app).delete(`/v1/groups/${groupId}/events/${one.id}`).set(auth(minji)).expect(200);

    const again = await importFile(minji, groupId, sample()).expect(201);
    expect(again.body.data).toMatchObject({ importId: null, created: 0 });
    expect(again.body.data.skipped).toContainEqual({ reason: 'DUPLICATE', count: 4 });
    expect(await prisma.event.count({ where: { groupId } })).toBe(3);
    expect(await prisma.eventImportItem.findFirst({ where: { eventId: null } })).not.toBeNull();

    // 다른 팀(개인 달력)에는 다시 넣을 수 있다
    const personal = await preview(minji, personalId, sample()).expect(200);
    expect(personal.body.data.toCreate).toBe(4);
  });

  it('TimeTree 1.0.0 모양(VALUE=DATE 없는 날짜, LF 줄 끝)은 종일로 들어가고 다시 올리면 0개 (#309)', async () => {
    const allDay = (uid: string, start: number, end: number | null, title: string) => [
      'BEGIN:VEVENT',
      `SUMMARY:${title}`,
      `DTSTART:${dayAfter(start)}`,
      ...(end === null ? [] : [`DTEND:${dayAfter(end)}`]),
      'DTSTAMP:20261112T010203Z',
      `UID:${uid}`,
      'COLOR:#2ecc87',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15H',
      'END:VALARM',
      'END:VEVENT',
    ];
    const file = Buffer.from(
      ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TimeTree Exporter 1.0.0//EN', ...allDay('tt1', 2, 3, '하루'), ...allDay('tt2', 3, 6, '사흘'), ...allDay('tt3', 4, 4, '끝같음'), ...allDay('tt4', 5, null, '끝없음'), 'END:VCALENDAR', ''].join('\n'),
    );
    const res = await preview(minji, groupId, file).expect(200);
    expect(res.body.data).toMatchObject({ total: 4, toCreate: 4, skipped: [] });

    await importFile(minji, groupId, file).expect(201);
    const events = await prisma.event.findMany({ where: { groupId }, orderBy: { startsAt: 'asc' } });
    expect(events.map((event) => [event.title, event.allDay, kstDate(event.startsAt), (event.endsAt.getTime() - event.startsAt.getTime()) / DAY_MS])).toEqual([
      ['하루', true, kstDate(new Date(Date.now() + 2 * DAY_MS)), 1],
      ['사흘', true, kstDate(new Date(Date.now() + 3 * DAY_MS)), 3],
      ['끝같음', true, kstDate(new Date(Date.now() + 4 * DAY_MS)), 1],
      ['끝없음', true, kstDate(new Date(Date.now() + 5 * DAY_MS)), 1],
    ]);

    const again = await importFile(minji, groupId, file).expect(201);
    expect(again.body.data).toMatchObject({ importId: null, created: 0, skipped: [{ reason: 'DUPLICATE', count: 4 }] });
  });

  it('[나만] 은 참여자 행, 개인 달력은 기본 나이고 푸시를 만들지 않는다', async () => {
    await importFile(minji, groupId, ics(...vevent('me@test', dayAfter(2), '나만')), { participants: 'ME' }).expect(201);
    const mine = await prisma.event.findFirstOrThrow({ where: { title: '나만' }, include: { participants: true } });
    expect(mine.allMembers).toBe(false);
    expect(mine.participants.map((row) => row.userId)).toEqual([minji.userId]);

    await importFile(minji, personalId, ics(...vevent('p@test', dayAfter(2), '개인'))).expect(201);
    const personal = await prisma.event.findFirstOrThrow({ where: { title: '개인' }, include: { participants: true } });
    expect(personal.allMembers).toBe(false);
    expect(await prisma.pushNotification.count({ where: { groupId: personalId } })).toBe(0);
  });

  it('지난 1년을 고르면 1년 안 지난 일정도 넣는다', async () => {
    const file = ics(...vevent('past@test', dayAfter(-30), '지난달'));
    expect((await preview(minji, groupId, file).expect(200)).body.data.toCreate).toBe(0);
    expect((await preview(minji, groupId, file, { range: 'year' }).expect(200)).body.data.toCreate).toBe(1);
  });

  it('전체(#314)를 고르면 몇 년 전 일정도 넣는다', async () => {
    const file = ics(...vevent('ancient@test', '20180505', '옛날'), ...vevent('soon@test', dayAfter(2), '곧'));
    expect((await preview(minji, groupId, file, { range: 'year' }).expect(200)).body.data).toMatchObject({ toCreate: 1, skipped: [{ reason: 'TOO_OLD', count: 1 }] });
    expect((await preview(minji, groupId, file, { range: 'all' }).expect(200)).body.data).toMatchObject({ toCreate: 2, skipped: [] });
    const res = await importFile(minji, groupId, file, { range: 'all' }).expect(201);
    expect(res.body.data.created).toBe(2);
    expect((await prisma.event.findFirstOrThrow({ where: { title: '옛날' } })).startsAt.toISOString()).toBe('2018-05-05T01:00:00.000Z');
  });

  it('중간에 실패하면 넣은 묶음은 남고, 다시 올리면 나머지만 들어간다', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 250; i += 1) lines.push(...vevent(`bulk-${i}@test`, dayAfter(2 + (i % 20)), `묶음 ${i}`));
    const file = ics(...lines);
    const repo = app.get(ImportsRepository);
    const original = repo.insertBatchTx.bind(repo);
    let calls = 0;
    vi.spyOn(repo, 'insertBatchTx').mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('db down');
      return original(...args);
    });

    const failed = await importFile(minji, groupId, file).expect(500);
    expect(failed.body.error).toEqual({ code: 'IMPORT_INCOMPLETE', details: { created: 200, total: 250 } });
    expect(failed.body.message).toBe('250개 중 200개 넣었어요. 같은 파일을 다시 올리면 나머지만 들어가요');
    expect(await prisma.event.count({ where: { groupId } })).toBe(200);
    expect(await prisma.eventImport.findFirstOrThrow()).toMatchObject({ created: 200, doneAt: null });

    vi.restoreAllMocks();
    const retried = await importFile(minji, groupId, file).expect(201);
    expect(retried.body.data).toMatchObject({ created: 50, skipped: [{ reason: 'DUPLICATE', count: 200 }] });
    expect(await prisma.event.count({ where: { groupId } })).toBe(250);
  });

  describe('골라서 넣기 (#314)', () => {
    type Item = { key: string; title: string; startsAt: string; endsAt: string; allDay: boolean; repeat: string | null };
    const itemsOf = async (group = groupId) => (await preview(minji, group, sample()).expect(200)).body.data.items as Item[];

    it('미리보기 items 는 넣을 일정 전부와 표시용 필드', async () => {
      const items = await itemsOf();
      expect(items.map((item) => item.title)).toEqual(['하나', '둘', '셋', '매주']);
      expect(items.every((item) => /^[0-9a-f]{64}$/.test(item.key))).toBe(true);
      expect(items.find((item) => item.title === '매주')).toMatchObject({ allDay: false, repeat: 'WEEKLY' });
    });

    it('고른 것만 넣고, 다시 올리면 뺀 일정(만) 다시 넣을 일정으로 나온다', async () => {
      const items = await itemsOf();
      const picked = items.filter((item) => item.title !== '둘' && item.title !== '매주');
      const res = await importFile(minji, groupId, sample(), { include: JSON.stringify(picked.map((item) => item.key)) }).expect(201);
      // 뺀 것은 건너뜀으로 세지 않는다
      expect(res.body.data).toMatchObject({ created: 2, skipped: [{ reason: 'CANCELLED', count: 1 }, { reason: 'TOO_OLD', count: 1 }] });
      expect((await prisma.event.findMany({ where: { groupId }, orderBy: { startsAt: 'asc' } })).map((event) => event.title)).toEqual(['하나', '셋']);
      expect(await counts()).toMatchObject({ items: 2, activities: 1, pushes: 1 });
      expect(await prisma.groupActivity.findFirstOrThrow({ where: { type: 'EVENTS_IMPORTED' } })).toMatchObject({ payload: { count: 2 } });

      const again = (await preview(minji, groupId, sample()).expect(200)).body.data;
      expect(again.toCreate).toBe(2);
      expect((again.items as Item[]).map((item) => item.title)).toEqual(['둘', '매주']);
      expect(again.skipped).toContainEqual({ reason: 'DUPLICATE', count: 2 });

      // 남은 것을 include 없이 넣으면 그 둘만
      const rest = await importFile(minji, groupId, sample()).expect(201);
      expect(rest.body.data.created).toBe(2);
      expect(await prisma.event.count({ where: { groupId } })).toBe(4);
    });

    it('이번 파일에 없는 키는 무시한다. 모두 모르는 키면 아무것도 넣지 않는다', async () => {
      const items = await itemsOf();
      const unknown = 'f'.repeat(64);
      const res = await importFile(minji, groupId, sample(), { include: JSON.stringify([items[0].key, unknown]) }).expect(201);
      expect(res.body.data.created).toBe(1);
      const none = await importFile(minji, groupId, sample(), { include: JSON.stringify([unknown]) }).expect(201);
      expect(none.body.data).toMatchObject({ importId: null, created: 0 });
      expect(await counts()).toMatchObject({ events: 1, imports: 1, items: 1 });
    });

    it('이미 넣은 키를 다시 고르면 DUPLICATE 로 건너뛰고 다른 팀에는 같은 키로 넣는다', async () => {
      const items = await itemsOf();
      const include = JSON.stringify([items[0].key]);
      await importFile(minji, groupId, sample(), { include }).expect(201);
      const twice = await importFile(minji, groupId, sample(), { include }).expect(201);
      expect(twice.body.data).toMatchObject({ created: 0 });
      expect(twice.body.data.skipped).toContainEqual({ reason: 'DUPLICATE', count: 1 });
      const personal = await importFile(minji, personalId, sample(), { include }).expect(201);
      expect(personal.body.data.created).toBe(1);
    });

    it('전부 해제(빈 배열)와 형식이 틀린 include 는 400, 미리보기에 include 는 400', async () => {
      const before = await counts();
      const empty = await importFile(minji, groupId, sample(), { include: '[]' }).expect(400);
      expect(empty.body.error).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ field: 'include', message: '넣을 일정을 하나 이상 골라 주세요' }] });
      for (const include of ['abc', '"abc"', JSON.stringify(['xyz']), JSON.stringify([1]), JSON.stringify(Array.from({ length: 1001 }, () => 'a'.repeat(64)))]) {
        const res = await importFile(minji, groupId, sample(), { include }).expect(400);
        expect(res.body.error.details[0].field).toBe('include');
      }
      await preview(minji, groupId, sample(), { include: '[]' }).expect(400);
      expect(await counts()).toEqual(before);
    });
  });

  describe('오류', () => {
    it('파일 없음, 캘린더 아님, 2MB 초과는 400 VALIDATION_FAILED(file)', async () => {
      for (const res of [
        await preview(minji, groupId, null).expect(400),
        await preview(minji, groupId, Buffer.from('hello')).expect(400),
        await preview(minji, groupId, Buffer.alloc(2 * 1024 * 1024 + 10, 'a')).expect(400),
      ]) {
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.details[0].field).toBe('file');
      }
    });

    it('range, participants 형식이 틀리면 400, 다른 필드는 400', async () => {
      expect((await preview(minji, groupId, sample(), { range: 'ever' }).expect(400)).body.error.details[0].field).toBe('range');
      expect((await importFile(minji, groupId, sample(), { participants: 'YOU' }).expect(400)).body.error.details[0].field).toBe('participants');
      await preview(minji, groupId, sample(), { extra: '1' }).expect(400);
    });

    it('멤버가 아니면 403, 로그인하지 않으면 401', async () => {
      await preview(outsider, groupId, sample()).expect(403);
      await importFile(outsider, groupId, sample()).expect(403);
      await api(app).post(`/v1/groups/${groupId}/imports/preview`).attach('file', sample(), 'a.ics').expect(401);
    });

    it('VEVENT 가 3,000개를 넘으면 400 IMPORT_TOO_LARGE', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 3001; i += 1) lines.push('BEGIN:VEVENT', `UID:${i}`, 'DTSTART:20261201T000000Z', 'END:VEVENT');
      expect((await preview(minji, groupId, ics(...lines)).expect(400)).body.error.code).toBe('IMPORT_TOO_LARGE');
    });
  });
});
