import request from 'supertest';
import { assertEnvelope, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';

/**
 * 입력 규칙 (QA #6 결함, api.md 1장)
 * - #60 잘못된 JSON 은 400 VALIDATION_FAILED, 본문 크기 초과는 413 PAYLOAD_TOO_LARGE. 둘 다 한국어 문구
 */
describe('입력 규칙 (e2e)', () => {
  let app: TestApp;
  let alice: Session;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
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
});
