import request from 'supertest';
import { api, assertEnvelope, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';

/**
 * 입력 규칙 (QA #6 결함, api.md 1장)
 * - #58 빈 시간 dayEnd 는 24:00 (그날 자정 끝) 까지 받는다. dayStart 는 23:59 까지
 * - #59 이름/제목은 앞뒤 공백을 잘라 검증하고 저장. 공백만이면 400 VALIDATION_FAILED
 * - #60 잘못된 JSON 은 400 VALIDATION_FAILED, 본문 크기 초과는 413 PAYLOAD_TOO_LARGE. 둘 다 한국어 문구
 */
describe('입력 규칙 (e2e)', () => {
  let app: TestApp;
  let alice: Session;
  let groupId: number;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    const team = await api(app).post('/v1/groups').set(auth(alice)).send({ name: '입력 규칙' }).expect(201);
    groupId = team.body.data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /** 문자열 본문을 그대로 보내야 해서 supertest 를 직접 쓰고 봉투 검사만 붙인다 */
  function rawPost(path: string, body: string) {
    return request(app.getHttpServer()).post(path).set(auth(alice)).set('Content-Type', 'application/json').send(body).expect(assertEnvelope);
  }

  describe('본문 파싱 실패 (#60)', () => {
    it('잘못된 JSON 은 400 VALIDATION_FAILED + 한국어 문구', async () => {
      const res = await rawPost('/v1/groups', 'garbage').expect(400);
      expect(res.body).toEqual({ status: 400, data: null, message: '요청 형식이 올바르지 않아요', error: { code: 'VALIDATION_FAILED' } });
    });

    it('본문 크기 초과는 413 PAYLOAD_TOO_LARGE + 한국어 문구', async () => {
      const res = await rawPost('/v1/groups', JSON.stringify({ name: 'x'.repeat(2_000_000) })).expect(413);
      expect(res.body).toEqual({ status: 413, data: null, message: '요청 내용이 너무 커요', error: { code: 'PAYLOAD_TOO_LARGE' } });
    });
  });

  describe('빈 시간 dayEnd=24:00 (#58)', () => {
    const range = { from: '2026-12-01T00:00:00.000Z', to: '2026-12-01T15:00:00.000Z', dayStart: '20:00', minMinutes: 60 };

    it('dayEnd=24:00 이면 KST 자정까지 빈 시간', async () => {
      const res = await api(app).get(`/v1/groups/${groupId}/free-slots`).set(auth(alice)).query({ ...range, dayEnd: '24:00' }).expect(200);
      // 12/01 KST 20:00~24:00 = 11:00Z~15:00Z
      expect(res.body.data.slots).toEqual([{ startsAt: '2026-12-01T11:00:00.000Z', endsAt: '2026-12-01T15:00:00.000Z' }]);
    });

    it('dayStart=24:00, dayEnd=24:30 은 400 VALIDATION_FAILED', async () => {
      const start = await api(app).get(`/v1/groups/${groupId}/free-slots`).set(auth(alice)).query({ ...range, dayStart: '24:00', dayEnd: '24:00' }).expect(400);
      expect(start.body.error.details[0].field).toBe('dayStart');
      const end = await api(app).get(`/v1/groups/${groupId}/free-slots`).set(auth(alice)).query({ ...range, dayEnd: '24:30' }).expect(400);
      expect(end.body.error.details[0].field).toBe('dayEnd');
    });
  });

  describe('이름/제목 trim (#59)', () => {
    const event = { startsAt: '2026-12-02T10:00:00.000Z', endsAt: '2026-12-02T11:00:00.000Z', allDay: false };

    it('공백만인 팀 이름, 일정 제목, 기념일 이름, 표시 이름은 400 VALIDATION_FAILED', async () => {
      const cases = [
        api(app).post('/v1/groups').set(auth(alice)).send({ name: '   ' }),
        api(app).patch(`/v1/groups/${groupId}`).set(auth(alice)).send({ name: '   ' }),
        api(app).post(`/v1/groups/${groupId}/events`).set(auth(alice)).send({ ...event, title: '   ' }),
        api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(alice)).send({ name: '   ', date: '2024-03-16' }),
        api(app).patch(`/v1/groups/${groupId}/me`).set(auth(alice)).send({ displayName: '   ' }),
      ];
      for (const res of await Promise.all(cases)) {
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('앞뒤 공백은 잘라서 저장한다', async () => {
      const team = await api(app).post('/v1/groups').set(auth(alice)).send({ name: '  새 팀  ' }).expect(201);
      expect(team.body.data.name).toBe('새 팀');
      const renamed = await api(app).patch(`/v1/groups/${team.body.data.id}`).set(auth(alice)).send({ name: ' 바뀐 팀 ' }).expect(200);
      expect(renamed.body.data.name).toBe('바뀐 팀');

      const created = await api(app).post(`/v1/groups/${groupId}/events`).set(auth(alice)).send({ ...event, title: ' 저녁 ' }).expect(201);
      expect(created.body.data.title).toBe('저녁');
      const patched = await api(app).patch(`/v1/groups/${groupId}/events/${created.body.data.id}`).set(auth(alice)).send({ title: ' 점심 ' }).expect(200);
      expect(patched.body.data.title).toBe('점심');

      const anniversary = await api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(alice)).send({ name: ' 첫 만남 ', date: '2024-03-16' }).expect(201);
      expect(anniversary.body.data.name).toBe('첫 만남');

      const member = await api(app).patch(`/v1/groups/${groupId}/me`).set(auth(alice)).send({ displayName: ' 앨 ' }).expect(200);
      expect(member.body.data.displayName).toBe('앨');
    });
  });
});
