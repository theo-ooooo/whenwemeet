import request from 'supertest';
import { api, assertEnvelope, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';

/**
 * 입력 규칙 (QA #6 결함, api.md 1장)
 * - #58 빈 시간 dayEnd 는 24:00 (그날 자정 끝) 까지 받는다. dayStart 는 23:59 까지
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
});
