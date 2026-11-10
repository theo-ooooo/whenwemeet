import sharp from 'sharp';
import { KAKAO_ME_URL, KAKAO_TOKEN_URL } from '../src/auth/providers/kakao.provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { urlOf } from '../src/testing/fetch-url.js';
import { sampleImage } from '../src/testing/images.js';
import { api, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';
import { E2E_PUBLIC_BASE_URL, MemoryStorage } from './memory-storage.js';

/** 내 정보: 닉네임 변경, 프로필 사진 (#32, 결정기록 D-36~D-38) */
describe('내 정보 (e2e)', () => {
  describe('저장소 미설정', () => {
    let app: TestApp;
    let alice: Session;

    beforeAll(async () => {
      app = await createTestApp();
      await resetDb(app);
      alice = await devLogin(app, '앨리스');
    });

    afterAll(async () => {
      await resetDb(app);
      await app.close();
    });

    it('POST /me/avatar 는 503 STORAGE_NOT_CONFIGURED, 서버와 다른 엔드포인트는 정상', async () => {
      const png = await sampleImage('png');
      const res = await api(app).post('/v1/me/avatar').set(auth(alice)).attach('file', png, 'a.png').expect(503);
      expect(res.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
      expect(res.body.message).toBe('사진 업로드를 지금 사용할 수 없어요');
      await api(app).get('/v1/me').set(auth(alice)).expect(200);
    });

    it('DELETE /me/avatar 는 사진이 없어도 200 (멱등)', async () => {
      const res = await api(app).delete('/v1/me/avatar').set(auth(alice)).expect(200);
      expect(res.body.data).toEqual({ profileImageUrl: null });
    });

    it('인증 없으면 401', async () => {
      await api(app).patch('/v1/me').send({ nickname: 'x' }).expect(401);
      await api(app).post('/v1/me/avatar').expect(401);
      await api(app).delete('/v1/me/avatar').expect(401);
    });
  });

  describe('저장소 있음 (MemoryStorage)', () => {
    let app: TestApp;
    let prisma: PrismaService;
    let alice: Session;
    let bob: Session;
    let groupId: number;
    const storage = new MemoryStorage();
    const originalFetch = globalThis.fetch;

    beforeAll(async () => {
      app = await createTestApp({ storage, publicBaseUrl: `${E2E_PUBLIC_BASE_URL}/` });
      prisma = app.get(PrismaService);
      await resetDb(app);
      alice = await devLogin(app, '앨리스');
      bob = await devLogin(app, '밥');
      const team = await api(app).post('/v1/groups').set(auth(alice)).send({ name: '우리' }).expect(201);
      groupId = team.body.data.id;
      await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: team.body.data.inviteCode }).expect(200);
      await api(app)
        .post(`/v1/groups/${groupId}/events`)
        .set(auth(alice))
        .send({ title: '저녁', startsAt: '2026-12-10T10:00:00.000Z', endsAt: '2026-12-10T11:00:00.000Z', allDay: false })
        .expect(201);
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      storage.failDelete = false;
    });

    afterAll(async () => {
      await resetDb(app);
      await app.close();
    });

    it('PATCH /me 는 앞뒤 공백을 자르고 저장, 팀 멤버 표시 이름에도 반영된다', async () => {
      const res = await api(app).patch('/v1/me').set(auth(alice)).send({ nickname: '  새 앨리스 ' }).expect(200);
      expect(res.body.data).toMatchObject({ id: alice.userId, nickname: '새 앨리스', profileImageUrl: null });
      expect(Object.keys(res.body.data).sort()).toEqual(['createdAt', 'id', 'nickname', 'profileImageUrl']);
      expect((await api(app).get('/v1/me').set(auth(alice)).expect(200)).body.data.nickname).toBe('새 앨리스');

      const group = await api(app).get(`/v1/groups/${groupId}`).set(auth(bob)).expect(200);
      expect(group.body.data.members.find((m: { userId: number }) => m.userId === alice.userId).displayName).toBe('새 앨리스');
      const events = await api(app)
        .get(`/v1/groups/${groupId}/events`)
        .set(auth(bob))
        .query({ from: '2026-12-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' })
        .expect(200);
      expect(events.body.data[0].creator.displayName).toBe('새 앨리스');
    });

    it('PATCH /me 검증: 공백만, 21자, 누락, 문자열 아님, 모르는 필드는 400', async () => {
      const cases: unknown[] = [{ nickname: '   ' }, { nickname: '가'.repeat(21) }, {}, { nickname: 3 }, { nickname: '닉', profileImageUrl: 'x' }];
      for (const body of cases) {
        const res = await api(app).patch('/v1/me').set(auth(alice)).send(body as object).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      const blank = await api(app).patch('/v1/me').set(auth(alice)).send({ nickname: '   ' }).expect(400);
      expect(blank.body.error.details).toEqual([{ field: 'nickname', message: '닉네임은 1~20자여야 해요' }]);
      expect((await api(app).patch('/v1/me').set(auth(alice)).send({ nickname: '가'.repeat(20) }).expect(200)).body.data.nickname).toHaveLength(20);
      await api(app).patch('/v1/me').set(auth(alice)).send({ nickname: '새 앨리스' }).expect(200);
    });

    it('재로그인(dev-login) 해도 바꾼 닉네임을 덮지 않는다 (D-36)', async () => {
      await devLogin(app, '앨리스');
      expect((await api(app).get('/v1/me').set(auth(alice)).expect(200)).body.data.nickname).toBe('새 앨리스');
    });

    it('POST /me/avatar: 512 webp 로 저장, File 행 생성, me/멤버/일정 작성자에 같은 URL', async () => {
      const jpeg = await sampleImage('jpeg', 1600, 900);
      const res = await api(app).post('/v1/me/avatar').set(auth(alice)).attach('file', jpeg, { filename: 'p.jpg', contentType: 'image/jpeg' }).expect(200);
      const url = res.body.data.profileImageUrl as string;
      expect(res.body.data).toEqual({ profileImageUrl: url });
      expect(url).toMatch(new RegExp(`^https://img\\.e2e\\.example/avatars/${alice.userId}/[0-9A-Z]{26}\\.webp$`));

      const object = storage.objects.get(storage.keyOf(url))!;
      expect(object.contentType).toBe('image/webp');
      expect(await sharp(object.body).metadata()).toMatchObject({ format: 'webp', width: 512, height: 512 });

      const files = await prisma.file.findMany({ where: { ownerId: alice.userId } });
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({
        provider: 'R2',
        bucket: 'e2e-bucket',
        key: storage.keyOf(url),
        // 도메인은 DB 에 저장하지 않는다 (D-49). 응답 URL = 공개 주소 + key
        publicUrl: null,
        mimeType: 'image/webp',
        size: object.body.length,
        width: 512,
        height: 512,
        kind: 'AVATAR',
        sourceUrl: null,
      });
      expect(url).toBe(`${E2E_PUBLIC_BASE_URL}/${files[0].key}`);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.userId } })).avatarFileId).toBe(files[0].id);

      expect((await api(app).get('/v1/me').set(auth(alice)).expect(200)).body.data.profileImageUrl).toBe(url);
      const group = await api(app).get(`/v1/groups/${groupId}`).set(auth(bob)).expect(200);
      expect(group.body.data.members.find((m: { userId: number }) => m.userId === alice.userId).profileImageUrl).toBe(url);
      const events = await api(app)
        .get(`/v1/groups/${groupId}/events`)
        .set(auth(bob))
        .query({ from: '2026-12-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' })
        .expect(200);
      expect(events.body.data[0].creator.profileImageUrl).toBe(url);
      const news = await api(app).get(`/v1/groups/${groupId}/news`).set(auth(bob)).expect(200);
      expect(news.body.data.items[0].actor.profileImageUrl).toBe(url);
      const anniversary = await api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(alice)).send({ name: '처음', date: '2026-01-01' }).expect(201);
      expect(anniversary.body.data.creator.profileImageUrl).toBe(url);
    });

    it('다시 올리면 새 File 로 교체되고 이전 행과 객체는 삭제', async () => {
      const before = await prisma.file.findFirstOrThrow({ where: { ownerId: alice.userId } });
      const res = await api(app).post('/v1/me/avatar').set(auth(alice)).attach('file', await sampleImage('png'), 'p.png').expect(200);
      const files = await prisma.file.findMany({ where: { ownerId: alice.userId } });
      expect(files).toHaveLength(1);
      expect(files[0].id).not.toBe(before.id);
      expect(res.body.data.profileImageUrl).toBe(`${E2E_PUBLIC_BASE_URL}/${files[0].key}`);
      expect(storage.objects.has(before.key)).toBe(false);
      expect(storage.objects.has(files[0].key)).toBe(true);
    });

    it('이전 객체 삭제가 실패해도 교체는 성공', async () => {
      storage.failDelete = true;
      const before = await prisma.file.findFirstOrThrow({ where: { ownerId: alice.userId } });
      await api(app).post('/v1/me/avatar').set(auth(alice)).attach('file', await sampleImage('webp'), 'p.webp').expect(200);
      expect(await prisma.file.count({ where: { ownerId: alice.userId } })).toBe(1);
      expect(storage.objects.has(before.key)).toBe(true);
      storage.objects.delete(before.key);
    });

    it('형식 오류, 10MB 초과, 파일 없음, 다른 필드 이름은 400 (기존 사진 유지)', async () => {
      const current = await prisma.file.findFirstOrThrow({ where: { ownerId: alice.userId } });
      const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
      const huge = Buffer.concat([await sampleImage('jpeg'), Buffer.alloc(10 * 1024 * 1024)]);
      const requests = [
        api(app).post('/v1/me/avatar').set(auth(alice)).attach('file', gif, { filename: 'fake.png', contentType: 'image/png' }),
        api(app).post('/v1/me/avatar').set(auth(alice)).attach('file', huge, 'huge.jpg'),
        api(app).post('/v1/me/avatar').set(auth(alice)),
        api(app).post('/v1/me/avatar').set(auth(alice)).attach('photo', await sampleImage('png'), 'p.png'),
      ];
      for (const request of requests) {
        const res = await request.expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      const tooBig = await api(app).post('/v1/me/avatar').set(auth(alice)).attach('file', huge, 'huge.jpg').expect(400);
      expect(tooBig.body.message).toBe('jpg, png, webp 10MB 까지 올릴 수 있어요');
      expect(tooBig.body.error.details).toEqual([{ field: 'file', message: 'jpg, png, webp 10MB 까지 올릴 수 있어요' }]);
      expect((await prisma.file.findFirstOrThrow({ where: { ownerId: alice.userId } })).id).toBe(current.id);
    });

    it('DELETE /me/avatar 는 행과 객체를 지우고 기본 아바타로', async () => {
      const current = await prisma.file.findFirstOrThrow({ where: { ownerId: alice.userId } });
      const res = await api(app).delete('/v1/me/avatar').set(auth(alice)).expect(200);
      expect(res.body.data).toEqual({ profileImageUrl: null });
      expect(await prisma.file.count({ where: { ownerId: alice.userId } })).toBe(0);
      expect(storage.objects.has(current.key)).toBe(false);
      expect((await api(app).get('/v1/me').set(auth(alice)).expect(200)).body.data.profileImageUrl).toBeNull();
    });

    it('옛 행에 남은 publicUrl(도메인 포함) 은 무시하고 지금 공개 주소 + key 로 응답한다 (#98)', async () => {
      const legacy = await prisma.file.create({
        data: { bucket: 'e2e-bucket', key: 'avatars/legacy/old.webp', publicUrl: 'https://old-domain.example/avatars/legacy/old.webp', mimeType: 'image/webp', size: 1, kind: 'AVATAR', ownerId: bob.userId },
      });
      await prisma.user.update({ where: { id: bob.userId }, data: { avatarFileId: legacy.id } });
      const expected = `${E2E_PUBLIC_BASE_URL}/avatars/legacy/old.webp`;
      expect((await api(app).get('/v1/me').set(auth(bob)).expect(200)).body.data.profileImageUrl).toBe(expected);
      const group = await api(app).get(`/v1/groups/${groupId}`).set(auth(alice)).expect(200);
      expect(group.body.data.members.find((m: { userId: number }) => m.userId === bob.userId).profileImageUrl).toBe(expected);
    });

    it('회원 탈퇴 시 내 File 객체와 행을 전부 정리', async () => {
      await api(app).post('/v1/me/avatar').set(auth(bob)).attach('file', await sampleImage('png'), 'b.png').expect(200);
      const bobFile = await prisma.file.findFirstOrThrow({ where: { ownerId: bob.userId } });
      // 다른 용도의 파일도 같이 지워지는지 (EVENT_PHOTO 는 아직 엔드포인트가 없어 직접 넣는다)
      await storage.put('events/x.webp', Buffer.from('x'), 'image/webp');
      await prisma.file.create({
        data: { bucket: 'e2e-bucket', key: 'events/x.webp', mimeType: 'image/webp', size: 1, kind: 'EVENT_PHOTO', ownerId: bob.userId },
      });

      await api(app).delete('/v1/me').set(auth(bob)).expect(200);
      expect(await prisma.file.count({ where: { ownerId: bob.userId } })).toBe(0);
      expect(storage.objects.has(bobFile.key)).toBe(false);
      expect(storage.objects.has('events/x.webp')).toBe(false);
    });

    it('카카오 가입 시 소셜 프로필 사진을 R2 로 복사하고 sourceUrl 을 남긴다. 실패해도 가입은 진행', async () => {
      const jpeg = await sampleImage('jpeg');
      const kakaoFetch = (image: string) =>
        vi.fn<typeof fetch>(async (input) => {
          const url = urlOf(input);
          if (url === KAKAO_TOKEN_URL) return Response.json({ access_token: 't' });
          if (url === KAKAO_ME_URL) return Response.json({ id: 77, kakao_account: { profile: { nickname: '카카오', profile_image_url: image } } });
          if (url === 'https://k.kakaocdn.example/ok.jpg') return new Response(new Uint8Array(jpeg), { status: 200 });
          return new Response('nope', { status: 404 });
        });
      const login = async (): Promise<string> => {
        const start = await api(app).get('/v1/auth/kakao').expect(302);
        const cookie = (start.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
        const state = new URL(start.headers.location).searchParams.get('state')!;
        const cb = await api(app).get('/v1/auth/kakao/callback').set('Cookie', cookie).query({ code: 'c', state }).expect(302);
        return new URL(cb.headers.location).searchParams.get('token')!;
      };

      globalThis.fetch = kakaoFetch('https://k.kakaocdn.example/ok.jpg');
      const token = await login();
      const me = await api(app).get('/v1/me').set({ Authorization: `Bearer ${token}` }).expect(200);
      expect(me.body.data.nickname).toBe('카카오');
      expect(me.body.data.profileImageUrl).toMatch(/^https:\/\/img\.e2e\.example\/avatars\/\d+\/[0-9A-Z]{26}\.webp$/);
      const file = await prisma.file.findFirstOrThrow({ where: { ownerId: me.body.data.id } });
      expect(file).toMatchObject({ kind: 'AVATAR', sourceUrl: 'https://k.kakaocdn.example/ok.jpg', width: 512, height: 512 });

      // 재로그인은 사진을 다시 받지 않는다
      globalThis.fetch = kakaoFetch('https://k.kakaocdn.example/changed.jpg');
      await login();
      expect(await prisma.file.count({ where: { ownerId: me.body.data.id } })).toBe(1);

      // 사진 받기가 실패해도 가입은 된다
      await prisma.authAccount.deleteMany({ where: { provider: 'KAKAO' } });
      globalThis.fetch = kakaoFetch('https://k.kakaocdn.example/missing.jpg');
      const token2 = await login();
      const me2 = await api(app).get('/v1/me').set({ Authorization: `Bearer ${token2}` }).expect(200);
      expect(me2.body.data).toMatchObject({ nickname: '카카오', profileImageUrl: null });
    });
  });
});
