import { JwtService } from '@nestjs/jwt';
import {
  api,
  auth,
  createTestApp,
  devLogin,
  resetDb,
  Session,
  TestApp,
} from './helpers.js';

/**
 * (#196) 초대 미리보기의 초대한 사람(`?by=`, D-157)과 선택 인증의 이미 멤버 여부(D-158)
 */
describe('초대 미리보기 초대한 사람, 이미 멤버 (e2e)', () => {
  let app: TestApp;
  let alice: Session;
  let bob: Session;
  let carol: Session;
  let groupId: number;
  let code: string;
  let aliceBy: string;
  let bobBy: string;

  const byOf = (shareUrl: string) => new URL(shareUrl).searchParams.get('by')!;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    carol = await devLogin(app, '캐럴');
    const team = await api(app)
      .post('/v1/groups')
      .set(auth(alice))
      .send({ name: '우리 팀' })
      .expect(201);
    groupId = team.body.data.id;
    code = team.body.data.inviteCode;
    aliceBy = byOf(team.body.data.inviteShareUrl);
    await api(app)
      .post('/v1/groups/join')
      .set(auth(bob))
      .send({ code })
      .expect(200);
    const detail = await api(app)
      .get(`/v1/groups/${groupId}`)
      .set(auth(bob))
      .expect(200);
    bobBy = byOf(detail.body.data.inviteShareUrl);
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('GroupDetail.inviteShareUrl 은 inviteUrl?by=<표식>, 요청자마다 다르고 PERSONAL 은 null', async () => {
    const a = await api(app)
      .get(`/v1/groups/${groupId}`)
      .set(auth(alice))
      .expect(200);
    expect(a.body.data.inviteShareUrl).toBe(
      `${a.body.data.inviteUrl}?by=${aliceBy}`,
    );
    expect(aliceBy).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(aliceBy).not.toBe(bobBy);
    expect(aliceBy).not.toContain(String(alice.userId));

    const groups = await api(app)
      .get('/v1/groups')
      .set(auth(alice))
      .expect(200);
    const personal = groups.body.data.find(
      (g: { type: string }) => g.type === 'PERSONAL',
    );
    const p = await api(app)
      .get(`/v1/groups/${personal.id}`)
      .set(auth(alice))
      .expect(200);
    expect(p.body.data.inviteShareUrl).toBeNull();
  });

  it('by 맞음 → 팀 표시 이름, 표시 이름을 바꾸면 그 이름', async () => {
    const res = await api(app)
      .get(`/v1/invites/${code}?by=${aliceBy}`)
      .expect(200);
    expect(res.body.data).toEqual({
      groupName: '우리 팀',
      memberCount: 2,
      inviter: { nickname: '앨리스' },
      isMember: false,
      groupId: null,
      groupCode: null,
    });

    await api(app)
      .patch(`/v1/groups/${groupId}/me`)
      .set(auth(bob))
      .send({ displayName: '밥밥' })
      .expect(200);
    const bobRes = await api(app)
      .get(`/v1/invites/${code.toLowerCase()}?by=${bobBy}`)
      .expect(200);
    expect(bobRes.body.data.inviter).toEqual({ nickname: '밥밥' });
  });

  it('by 틀림, 형식 오류, 여러 개, 없음 → inviter null (오류 아님)', async () => {
    for (const q of [
      '?by=AAAAAAAAAA',
      '?by=short',
      `?by=${aliceBy}x`,
      '?by=',
      `?by=${aliceBy}&by=${bobBy}`,
      '',
    ]) {
      const res = await api(app).get(`/v1/invites/${code}${q}`).expect(200);
      expect(res.body.data).toEqual({
        groupName: '우리 팀',
        memberCount: 2,
        inviter: null,
        isMember: false,
        groupId: null,
        groupCode: null,
      });
    }
    const missing = await api(app)
      .get(`/v1/invites/ZZZZZZ?by=${aliceBy}`)
      .expect(404);
    expect(missing.body.error.code).toBe('INVITE_NOT_FOUND');
  });

  it('다른 팀의 표식은 이 팀에서 통하지 않는다', async () => {
    const other = await api(app)
      .post('/v1/groups')
      .set(auth(alice))
      .send({ name: '다른 팀' })
      .expect(201);
    const otherBy = byOf(other.body.data.inviteShareUrl);
    expect(otherBy).not.toBe(aliceBy);
    const res = await api(app)
      .get(`/v1/invites/${code}?by=${otherBy}`)
      .expect(200);
    expect(res.body.data.inviter).toBeNull();
  });

  it('isMember: 토큰 없음/만료/틀림 → false, 유효+비멤버 → false, 유효+멤버 → true + groupId', async () => {
    const expired = app
      .get(JwtService)
      .sign({ sub: String(alice.userId) }, { expiresIn: -60 });
    for (const headers of [
      {},
      { Authorization: `Bearer ${expired}` },
      { Authorization: 'Bearer not-a-jwt' },
      auth(carol),
    ]) {
      const res = await api(app)
        .get(`/v1/invites/${code}`)
        .set(headers)
        .expect(200);
      expect(res.body.data).toMatchObject({ isMember: false, groupId: null });
    }
    const member = await api(app)
      .get(`/v1/invites/${code}?by=${bobBy}`)
      .set(auth(alice))
      .expect(200);
    // (#311) 멤버면 팀 공개 코드도 (웹이 `/calendar?team=` 로 간다)
    expect(member.body.data).toEqual({
      groupName: '우리 팀',
      memberCount: 2,
      inviter: { nickname: '밥밥' },
      isMember: true,
      groupId,
      groupCode: expect.stringMatching(/^[a-z0-9]{8}$/),
    });
  });

  it('나간 멤버의 표식 → inviter null, 재발급하면 새 코드에도 같은 표식', async () => {
    await api(app)
      .delete(`/v1/groups/${groupId}/me`)
      .set(auth(bob))
      .expect(200);
    const left = await api(app)
      .get(`/v1/invites/${code}?by=${bobBy}`)
      .expect(200);
    expect(left.body.data).toMatchObject({ memberCount: 1, inviter: null });

    const rotated = await api(app)
      .post(`/v1/groups/${groupId}/invite-code`)
      .set(auth(alice))
      .expect(200);
    expect(rotated.body.data.inviteShareUrl).toBe(
      `${rotated.body.data.inviteUrl}?by=${aliceBy}`,
    );
    await api(app).get(`/v1/invites/${code}?by=${aliceBy}`).expect(404);
    const fresh = await api(app)
      .get(`/v1/invites/${rotated.body.data.inviteCode}?by=${aliceBy}`)
      .expect(200);
    expect(fresh.body.data.inviter).toEqual({ nickname: '앨리스' });
  });
});
