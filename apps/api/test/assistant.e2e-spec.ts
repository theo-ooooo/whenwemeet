import { UnavailableAssistantModel } from '../src/assistant/assistant-model.js';
import { addDays, kstDate, kstMidnight } from '../src/events/recurrence.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  api,
  auth,
  createTestApp,
  devLogin,
  resetDb,
  type Session,
  type TestApp,
} from './helpers.js';

/**
 * (#450) AI 비서 볼까 e2e (설계 AI-비서.md 10장). 실제 MySQL + 가짜 모델(ASSISTANT_FAKE=1, 실제 OpenAI 를 부르지 않는다).
 * 401/403, 동의 전 409, 동의 멱등, 하루 30번(동시 요청에서 정확히), 실패 되돌림, 다른 팀 일정과 멤버가 안 섞임,
 * 빈 시간이 공개 API 와 같음, 탈퇴 Cascade, 분당 10, 키 없음
 */
describe('AI 비서 볼까 (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let minji: Session;
  let sky: Session;
  let carol: Session;
  let team: number;
  let otherTeam: number;
  const today = () => kstDate(new Date());
  const messages = (groupId = team) =>
    `/v1/groups/${groupId}/assistant/messages`;
  const send = (who: Session, text: string, groupId = team) =>
    api(app).post(messages(groupId)).set(auth(who)).send({ text });
  const consent = (who: Session) =>
    api(app).post('/v1/me/assistant-consent').set(auth(who)).expect(200);
  const usedToday = async (who: Session) =>
    (await api(app).get('/v1/me').set(auth(who)).expect(200)).body.data
      .assistant.usedToday as number;
  const setCount = (who: Session, count: number) =>
    prisma.assistantUsage.upsert({
      where: {
        userId_day: {
          userId: who.userId,
          day: new Date(`${today()}T00:00:00.000Z`),
        },
      },
      create: {
        userId: who.userId,
        day: new Date(`${today()}T00:00:00.000Z`),
        count,
      },
      update: { count },
    });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    minji = await devLogin(app, '민지');
    sky = await devLogin(app, '하늘');
    carol = await devLogin(app, '캐롤');
    const created = await api(app)
      .post('/v1/groups')
      .set(auth(minji))
      .send({ name: '우리' })
      .expect(201);
    team = created.body.data.id;
    await api(app)
      .post('/v1/groups/join')
      .set(auth(sky))
      .send({ code: created.body.data.inviteCode })
      .expect(200);
    otherTeam = (
      await api(app)
        .post('/v1/groups')
        .set(auth(carol))
        .send({ name: '다른 팀' })
        .expect(201)
    ).body.data.id;
  });

  it('GET /me 의 assistant, 동의는 멱등(처음 값 그대로)', async () => {
    expect(
      (await api(app).get('/v1/me').set(auth(minji)).expect(200)).body.data
        .assistant,
    ).toEqual({
      available: true,
      consented: false,
      dailyLimit: 30,
      usedToday: 0,
    });
    const first = (await consent(minji)).body.data.consentedAt as string;
    expect(new Date(first).toISOString()).toBe(first);
    expect((await consent(minji)).body.data.consentedAt).toBe(first);
    expect(
      (await api(app).get('/v1/me').set(auth(minji)).expect(200)).body.data
        .assistant.consented,
    ).toBe(true);
  });

  it('401 토큰 없음, 403 멤버 아님, 409 동의 전, 400 300자 초과 — 모두 세지 않는다', async () => {
    await api(app).post(messages()).send({ text: '안녕' }).expect(401);
    await consent(carol);
    expect((await send(carol, '안녕').expect(403)).body.error.code).toBe(
      'FORBIDDEN',
    );
    const conflict = await send(minji, '안녕').expect(409);
    expect(conflict.body).toMatchObject({
      message: '먼저 안내를 확인해 주세요',
      error: { code: 'ASSISTANT_CONSENT_REQUIRED' },
    });
    await consent(minji);
    const tooLong = await send(minji, '가'.repeat(301)).expect(400);
    expect(tooLong.body).toMatchObject({
      message: '300자까지 보낼 수 있어요',
      error: { code: 'VALIDATION_FAILED', details: [{ field: 'text' }] },
    });
    await api(app)
      .post(messages())
      .set(auth(minji))
      .send({ text: '안녕', history: [{ role: 'system', text: 'x' }] })
      .expect(400);
    expect(await usedToday(minji)).toBe(0);
    expect(await usedToday(carol)).toBe(0);
  });

  it('일정 초안: 참여자 이름은 이 팀 멤버만 찾는다 (다른 팀 멤버 이름은 되묻기). 일정을 만들지 않는다', async () => {
    await consent(minji);
    const ok = (await send(minji, '내일 하늘이랑 저녁 잡아 줘').expect(200))
      .body.data;
    expect(ok.reply).toBe('이렇게 넣을까요?');
    expect(ok.cards[0].type).toBe('eventDraft');
    expect(ok.cards[0].draft).toMatchObject({
      title: '약속',
      startsAt: new Date(`${addDays(today(), 1)}T19:00:00+09:00`).toISOString(),
      participants: [minji.userId, sky.userId],
      allDay: false,
      place: null,
    });
    expect(ok.usage).toEqual({ used: 1, limit: 30 });

    const other = (await send(minji, '캐롤이랑 저녁 잡아 줘').expect(200)).body
      .data;
    expect(other).toMatchObject({
      reply: "'캐롤'님을 이 팀에서 찾지 못했어요. 누구를 말하는지 알려 주세요",
      cards: [{ type: 'clarify', field: 'participant', choices: [] }],
    });
    expect(await prisma.event.count()).toBe(0);
    expect(await prisma.poll.count()).toBe(0);
  });

  it('범위 밖 질문은 거절 문구 (가짜 모델의 글 답은 나가지 않는다), 그래도 센다', async () => {
    await consent(minji);
    const res = (await send(minji, '내일 서울 날씨 어때?').expect(200)).body
      .data;
    expect(res).toEqual({
      reply: '볼까는 일정 만들기, 빈 시간 찾기, 투표, 일정 묻기만 도와 드려요',
      cards: [{ type: 'refusal' }],
      historyText: '[거절]',
      usage: { used: 1, limit: 30 },
    });
  });

  it('일정 찾기: 이 팀 일정만 (다른 팀 일정은 안 나온다)', async () => {
    await consent(minji);
    const at = (h: string) =>
      new Date(`${today()}T${h}:00+09:00`).toISOString();
    await api(app)
      .post(`/v1/groups/${team}/events`)
      .set(auth(minji))
      .set('X-Client-Source', 'assistant')
      .send({
        title: '우리 저녁',
        startsAt: at('12:00'),
        endsAt: at('13:00'),
        allDay: false,
      })
      .expect(201);
    await api(app)
      .post(`/v1/groups/${otherTeam}/events`)
      .set(auth(carol))
      .send({
        title: '다른 팀 비밀',
        startsAt: at('12:00'),
        endsAt: at('13:00'),
        allDay: false,
      })
      .expect(201);
    const res = (await send(minji, '이번 주에 뭐 있어?').expect(200)).body.data;
    expect(res.reply).toBe('이번 주에 일정이 1개 있어요');
    expect(res.cards[0].events.map((e: { title: string }) => e.title)).toEqual([
      '우리 저녁',
    ]);
    expect(JSON.stringify(res)).not.toContain('다른 팀 비밀');
  });

  it('빈 시간: 공개 빈 시간 API(전원, 09:00~23:00, 120분)와 같은 결과', async () => {
    await consent(minji);
    const t = today();
    await api(app)
      .post(`/v1/groups/${team}/events`)
      .set(auth(sky))
      .send({
        title: '하늘 일',
        startsAt: new Date(`${addDays(t, 2)}T10:00:00+09:00`).toISOString(),
        endsAt: new Date(`${addDays(t, 2)}T15:00:00+09:00`).toISOString(),
        allDay: false,
        participants: [sky.userId],
      })
      .expect(201);
    const pub = (
      await api(app)
        .get(`/v1/groups/${team}/free-slots`)
        .set(auth(minji))
        .query({
          from: kstMidnight(t).toISOString(),
          to: kstMidnight(addDays(t, 7)).toISOString(),
        })
        .expect(200)
    ).body.data;
    const res = (await send(minji, '이번 주 다 같이 빈 시간').expect(200)).body
      .data;
    expect(res.cards[0].type).toBe('freeSlots');
    expect(res.cards[0].total).toBe(pub.slots.length);
    expect(res.cards[0].slots).toEqual(
      pub.slots.slice(0, 5).map((s: { startsAt: string; endsAt: string }) => ({
        startsAt: s.startsAt,
        endsAt: s.endsAt,
      })),
    );
    expect(res.cards[0].query).toMatchObject({
      participants: [minji.userId, sky.userId],
      dayStart: '09:00',
      dayEnd: '23:00',
      minMinutes: 120,
      days: 'all',
    });

    const poll = (await send(minji, '이번 주 빈 시간으로 투표').expect(200))
      .body.data;
    expect(poll.cards.map((c: { type: string }) => c.type)).toEqual([
      'freeSlots',
      'pollDraft',
    ]);
  });

  it('하루 30번: 동시 첫 요청 5개를 정확히 세고, 30번째는 통과, 31번째는 429 (넘친 요청은 세지 않음)', async () => {
    await consent(minji);
    const first = await Promise.all(
      Array.from({ length: 5 }, () => send(minji, '안녕')),
    );
    expect(first.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(
      first
        .map((r) => r.body.data.usage.used)
        .sort((a: number, b: number) => a - b),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(await usedToday(minji)).toBe(5);

    await setCount(minji, 28);
    const race = await Promise.all(
      Array.from({ length: 5 }, () => send(minji, '안녕')),
    );
    expect(race.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 200, 429, 429, 429,
    ]);
    expect(await usedToday(minji)).toBe(30);
    const limited = await send(minji, '안녕').expect(429);
    expect(limited.headers['retry-after']).toBeUndefined();
    expect(limited.body).toMatchObject({
      message: '오늘은 볼까를 30번 다 썼어요. 내일 다시 불러 주세요',
      error: {
        code: 'ASSISTANT_DAILY_LIMIT',
        details: {
          limit: 30,
          resetAt: kstMidnight(addDays(today(), 1)).toISOString(),
        },
      },
    });
    expect(await usedToday(minji)).toBe(30);
    // 다른 사용자는 따로 센다
    await consent(sky);
    expect((await send(sky, '안녕').expect(200)).body.data.usage.used).toBe(1);
  });

  it('우리 쪽 실패(504 시간 초과, 503 모델 오류)는 되돌린다', async () => {
    await consent(minji);
    await send(minji, '안녕').expect(200);
    const slow = await send(minji, '느려').expect(504);
    expect(slow.body).toMatchObject({
      message: '답이 늦어지고 있어요. 다시 보내 주세요',
      error: { code: 'ASSISTANT_TIMEOUT' },
    });
    expect((await send(minji, '고장').expect(503)).body.error.code).toBe(
      'ASSISTANT_UNAVAILABLE',
    );
    expect(await usedToday(minji)).toBe(1);
  });

  it('탈퇴하면 하루 횟수 행도 지워진다 (Cascade)', async () => {
    await consent(minji);
    await send(minji, '안녕').expect(200);
    expect(
      await prisma.assistantUsage.count({ where: { userId: minji.userId } }),
    ).toBe(1);
    await api(app).delete('/v1/me').set(auth(minji)).expect(200);
    expect(
      await prisma.assistantUsage.count({ where: { userId: minji.userId } }),
    ).toBe(0);
  });
});

describe('AI 비서 볼까: 분당 10회 (e2e, 요청 제한 켬)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ rateLimit: {} });
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('사용자당 1분 10회, 11번째는 RATE_LIMITED 이고 하루 횟수는 세지 않는다', async () => {
    await resetDb(app);
    const minji = await devLogin(app, '민지');
    const team = (
      await api(app)
        .post('/v1/groups')
        .set(auth(minji))
        .send({ name: '우리' })
        .expect(201)
    ).body.data.id;
    await api(app)
      .post('/v1/me/assistant-consent')
      .set(auth(minji))
      .expect(200);
    for (let i = 0; i < 10; i++)
      await api(app)
        .post(`/v1/groups/${team}/assistant/messages`)
        .set(auth(minji))
        .send({ text: '안녕' })
        .expect(200);
    const limited = await api(app)
      .post(`/v1/groups/${team}/assistant/messages`)
      .set(auth(minji))
      .send({ text: '안녕' })
      .expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(
      (await api(app).get('/v1/me').set(auth(minji)).expect(200)).body.data
        .assistant.usedToday,
    ).toBe(10);
  });
});

describe('AI 비서 볼까: 키 없음 (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      assistantModel: new UnavailableAssistantModel(),
    });
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('/me 의 available false, 메시지는 503 이고 세지 않는다', async () => {
    await resetDb(app);
    const minji = await devLogin(app, '민지');
    const team = (
      await api(app)
        .post('/v1/groups')
        .set(auth(minji))
        .send({ name: '우리' })
        .expect(201)
    ).body.data.id;
    await api(app)
      .post('/v1/me/assistant-consent')
      .set(auth(minji))
      .expect(200);
    const res = await api(app)
      .post(`/v1/groups/${team}/assistant/messages`)
      .set(auth(minji))
      .send({ text: '안녕' })
      .expect(503);
    expect(res.body).toMatchObject({
      message: '지금은 볼까를 쓸 수 없어요. 잠시 후 다시 해 주세요',
      error: { code: 'ASSISTANT_UNAVAILABLE' },
    });
    expect(
      (await api(app).get('/v1/me').set(auth(minji)).expect(200)).body.data
        .assistant,
    ).toEqual({
      available: false,
      consented: true,
      dailyLimit: 30,
      usedToday: 0,
    });
  });
});
