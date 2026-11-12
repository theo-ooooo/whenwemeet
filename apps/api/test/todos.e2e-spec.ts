import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';

/**
 * (#276) 팀 공유 할 일 목록 (api.md 2.11, 설계 할일-목록.md, D-203 ~ D-207).
 * 멤버 검사(403), 다른 팀 번호(404), 코드 조회(비멤버 404), 상한, 완료 멱등, 목록 정렬, Cascade, 나가기와 탈퇴, 개인 팀
 */
describe('할 일 목록 (e2e, #276)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let alice: Session;
  let bob: Session;
  let carol: Session;
  let groupId: number;
  let otherGroupId: number;
  let inviteCode: string;

  const lists = async (who: Session, gid = groupId) => {
    const res = await api(app).get(`/v1/groups/${gid}/todo-lists`).set(auth(who)).expect(200);
    return res.body.data.items as Record<string, unknown>[];
  };
  const createList = async (who: Session, name: string, gid = groupId) =>
    (await api(app).post(`/v1/groups/${gid}/todo-lists`).set(auth(who)).send({ name }).expect(201)).body.data as { id: number; publicCode: string };
  const addItem = async (who: Session, listId: number, text: string, done?: boolean) =>
    (await api(app).post(`/v1/groups/${groupId}/todo-lists/${listId}/items`).set(auth(who)).send(done === undefined ? { text } : { text, done }).expect(201)).body
      .data as { id: number; done: boolean };
  const detail = async (who: Session, code: string) => (await api(app).get(`/v1/todo-lists/${code}`).set(auth(who)).expect(200)).body.data as {
    list: Record<string, unknown>;
    items: Record<string, unknown>[];
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    carol = await devLogin(app, '캐롤');
    const team = await api(app).post('/v1/groups').set(auth(alice)).send({ name: '우리집' }).expect(201);
    groupId = team.body.data.id;
    inviteCode = team.body.data.inviteCode;
    await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: inviteCode }).expect(200);
    const other = await api(app).post('/v1/groups').set(auth(carol)).send({ name: '캐롤네' }).expect(201);
    otherGroupId = other.body.data.id;
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('인증 없으면 401, 멤버가 아니면 403 (모든 팀 경로)', async () => {
    await api(app).get(`/v1/groups/${groupId}/todo-lists`).expect(401);
    await api(app).get(`/v1/groups/${groupId}/todo-lists`).set(auth(carol)).expect(403);
    await api(app).post(`/v1/groups/${groupId}/todo-lists`).set(auth(carol)).send({ name: '몰래' }).expect(403);
    await api(app).patch(`/v1/groups/${groupId}/todo-lists/1`).set(auth(carol)).send({ name: 'x' }).expect(403);
    await api(app).delete(`/v1/groups/${groupId}/todo-lists/1`).set(auth(carol)).expect(403);
    await api(app).post(`/v1/groups/${groupId}/todo-lists/1/items`).set(auth(carol)).send({ text: 'x' }).expect(403);
    await api(app).delete(`/v1/groups/${groupId}/todo-lists/1/items?done=true`).set(auth(carol)).expect(403);
    await api(app).patch(`/v1/groups/${groupId}/todo-items/1`).set(auth(carol)).send({ done: true }).expect(403);
    await api(app).delete(`/v1/groups/${groupId}/todo-items/1`).set(auth(carol)).expect(403);
  });

  it('목록 만들기, 항목 추가, 체크, 코드 조회. 응답 모양과 정렬', async () => {
    const list = await createList(alice, '  장보기  ');
    expect(list).toMatchObject({ name: '장보기', groupId, creator: { userId: alice.userId, displayName: '앨리스' }, editor: { userId: alice.userId } });
    expect(list.publicCode).toMatch(/^[a-z0-9]{8}$/);

    const milk = await addItem(alice, list.id, '우유');
    const bread = await addItem(bob, list.id, '빵');
    await addItem(bob, list.id, '계란');
    const checked = await api(app).patch(`/v1/groups/${groupId}/todo-items/${milk.id}`).set(auth(bob)).send({ done: true }).expect(200);
    expect(checked.body.data).toMatchObject({ done: true, doneBy: { userId: bob.userId, displayName: '밥' }, creator: { userId: alice.userId } });
    expect(checked.body.data.doneAt).toEqual(expect.any(String));

    const res = await detail(bob, list.publicCode);
    expect(res.list).toMatchObject({ id: list.id, publicCode: list.publicCode, groupId, name: '장보기', editor: { userId: bob.userId } });
    expect(typeof res.list.groupCode).toBe('string');
    // 미완료 추가순, 그 아래 완료
    expect(res.items.map((i) => i.text)).toEqual(['빵', '계란', '우유']);
    expect(res.items[0]).toMatchObject({ done: false, doneAt: null, doneBy: null, creator: { displayName: '밥' } });

    // 대문자 코드도 같은 목록 (열 비교와 맞춤)
    expect((await detail(alice, list.publicCode.toUpperCase())).list.id).toBe(list.id);

    const summary = await lists(alice);
    expect(summary).toEqual([expect.objectContaining({ id: list.id, name: '장보기', openCount: 2, doneCount: 1, editor: expect.objectContaining({ userId: bob.userId }) })]);

    // 체크 해제는 둘 다 null
    const unchecked = await api(app).patch(`/v1/groups/${groupId}/todo-items/${milk.id}`).set(auth(alice)).send({ done: false }).expect(200);
    expect(unchecked.body.data).toMatchObject({ done: false, doneAt: null, doneBy: null });
    const row = await prisma.todoItem.findUniqueOrThrow({ where: { id: milk.id } });
    expect(row).toMatchObject({ doneAt: null, doneById: null });

    // 글 수정 (공백 자름)
    const edited = await api(app).patch(`/v1/groups/${groupId}/todo-items/${bread.id}`).set(auth(alice)).send({ text: '  식빵 ' }).expect(200);
    expect(edited.body.data.text).toBe('식빵');
  });

  it('코드 조회: 틀린 모양, 없는 코드, 비멤버 모두 404', async () => {
    const list = await createList(alice, '여행 준비물');
    await api(app).get('/v1/todo-lists/bad').set(auth(alice)).expect(404);
    await api(app).get('/v1/todo-lists/zzzzzzzz').set(auth(alice)).expect(404);
    const res = await api(app).get(`/v1/todo-lists/${list.publicCode}`).set(auth(carol)).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    await api(app).get(`/v1/todo-lists/${list.publicCode}`).expect(401);
  });

  it('다른 팀 목록, 항목 번호는 404 (멤버인 팀 경로로 남의 번호를 가리켜도)', async () => {
    const theirs = await createList(carol, '캐롤 목록', otherGroupId);
    const theirItem = (await api(app).post(`/v1/groups/${otherGroupId}/todo-lists/${theirs.id}/items`).set(auth(carol)).send({ text: '비밀' }).expect(201)).body.data;
    await api(app).patch(`/v1/groups/${groupId}/todo-lists/${theirs.id}`).set(auth(alice)).send({ name: 'x' }).expect(404);
    await api(app).delete(`/v1/groups/${groupId}/todo-lists/${theirs.id}`).set(auth(alice)).expect(404);
    await api(app).post(`/v1/groups/${groupId}/todo-lists/${theirs.id}/items`).set(auth(alice)).send({ text: 'x' }).expect(404);
    await api(app).delete(`/v1/groups/${groupId}/todo-lists/${theirs.id}/items?done=true`).set(auth(alice)).expect(404);
    await api(app).patch(`/v1/groups/${groupId}/todo-items/${theirItem.id}`).set(auth(alice)).send({ done: true }).expect(404);
    await api(app).delete(`/v1/groups/${groupId}/todo-items/${theirItem.id}`).set(auth(alice)).expect(404);
    expect(await prisma.todoItem.findUniqueOrThrow({ where: { id: theirItem.id } })).toMatchObject({ done: false });
    // 잘못된 번호 형식은 400
    await api(app).patch(`/v1/groups/${groupId}/todo-items/abc`).set(auth(alice)).send({ done: true }).expect(400);
  });

  it('검증: 공백만, 길이 초과, done 형식, null', async () => {
    const list = await createList(alice, '검증');
    const bad = async (path: string, method: 'post' | 'patch', body: object, field: string) => {
      const res = await api(app)[method](path).set(auth(alice)).send(body).expect(400);
      expect(res.body.error).toMatchObject({ code: 'VALIDATION_FAILED', details: [expect.objectContaining({ field })] });
    };
    await bad(`/v1/groups/${groupId}/todo-lists`, 'post', { name: '   ' }, 'name');
    await bad(`/v1/groups/${groupId}/todo-lists`, 'post', { name: 'a'.repeat(31) }, 'name');
    await bad(`/v1/groups/${groupId}/todo-lists/${list.id}/items`, 'post', { text: 'a'.repeat(101) }, 'text');
    await bad(`/v1/groups/${groupId}/todo-lists/${list.id}/items`, 'post', { text: '우유', done: 'yes' }, 'done');
    const it1 = await addItem(alice, list.id, 'a'.repeat(100));
    await bad(`/v1/groups/${groupId}/todo-items/${it1.id}`, 'patch', { done: null }, 'done');
    await bad(`/v1/groups/${groupId}/todo-items/${it1.id}`, 'patch', { text: ' ' }, 'text');
    // 모르는 필드는 거부 (forbidNonWhitelisted)
    await api(app).post(`/v1/groups/${groupId}/todo-lists/${list.id}/items`).set(auth(alice)).send({ text: 'x', doneAt: '2026-01-01T00:00:00Z' }).expect(400);
    // 완료 지우기는 done=true 만
    await api(app).delete(`/v1/groups/${groupId}/todo-lists/${list.id}/items`).set(auth(alice)).expect(400);
  });

  it('완료 멱등: 같은 값 PATCH 는 쓰지 않아 항목과 목록 updatedAt 이 그대로 (D-204)', async () => {
    const list = await createList(alice, '멱등');
    const it1 = await addItem(alice, list.id, '우유');
    await api(app).patch(`/v1/groups/${groupId}/todo-items/${it1.id}`).set(auth(alice)).send({ done: true }).expect(200);
    const before = await prisma.todoItem.findUniqueOrThrow({ where: { id: it1.id } });
    const listBefore = await prisma.todoList.findUniqueOrThrow({ where: { id: list.id } });
    await new Promise((r) => setTimeout(r, 20));
    const again = await api(app).patch(`/v1/groups/${groupId}/todo-items/${it1.id}`).set(auth(bob)).send({ done: true, text: '우유' }).expect(200);
    expect(again.body.data.doneBy.userId).toBe(alice.userId);
    const after = await prisma.todoItem.findUniqueOrThrow({ where: { id: it1.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.doneAt?.getTime()).toBe(before.doneAt?.getTime());
    expect((await prisma.todoList.findUniqueOrThrow({ where: { id: list.id } })).updatedAt.getTime()).toBe(listBefore.updatedAt.getTime());
    // 빈 본문도 그대로
    await api(app).patch(`/v1/groups/${groupId}/todo-items/${it1.id}`).set(auth(alice)).send({}).expect(200);
  });

  it('목록 정렬: 항목을 바꾼 목록이 맨 위로 (updatedAt 내림차순), 이름이 같으면 쓰지 않는다', async () => {
    await resetLists();
    const a = await createList(alice, 'A');
    await new Promise((r) => setTimeout(r, 15));
    const b = await createList(alice, 'B');
    expect((await lists(alice)).map((l) => l.name)).toEqual(['B', 'A']);
    await new Promise((r) => setTimeout(r, 15));
    await addItem(bob, a.id, '하나');
    const after = await lists(alice);
    expect(after.map((l) => l.name)).toEqual(['A', 'B']);
    expect(after[0].editor).toMatchObject({ userId: bob.userId });
    await new Promise((r) => setTimeout(r, 15));
    await api(app).patch(`/v1/groups/${groupId}/todo-lists/${b.id}`).set(auth(alice)).send({ name: 'B' }).expect(200);
    expect((await lists(alice)).map((l) => l.name)).toEqual(['A', 'B']);
    const renamed = await api(app).patch(`/v1/groups/${groupId}/todo-lists/${b.id}`).set(auth(bob)).send({ name: ' 마트 ' }).expect(200);
    expect(renamed.body.data).toMatchObject({ name: '마트', editor: { userId: bob.userId } });
    expect((await lists(alice)).map((l) => l.name)).toEqual(['마트', 'A']);
  });

  it('완료 지우기, 항목 삭제, 되돌리기(같은 글 + done 으로 다시 POST)', async () => {
    const list = await createList(alice, '정리');
    const x = await addItem(alice, list.id, 'x');
    const y = await addItem(alice, list.id, 'y');
    await addItem(alice, list.id, 'z');
    for (const id of [x.id, y.id]) await api(app).patch(`/v1/groups/${groupId}/todo-items/${id}`).set(auth(bob)).send({ done: true }).expect(200);
    const cleared = await api(app).delete(`/v1/groups/${groupId}/todo-lists/${list.id}/items?done=true`).set(auth(alice)).expect(200);
    expect(cleared.body.data).toEqual({ ok: true, count: 2 });
    expect((await api(app).delete(`/v1/groups/${groupId}/todo-lists/${list.id}/items?done=true`).set(auth(alice)).expect(200)).body.data).toEqual({ ok: true, count: 0 });

    const z = (await detail(alice, list.publicCode)).items[0] as { id: number; text: string };
    await api(app).delete(`/v1/groups/${groupId}/todo-items/${z.id}`).set(auth(bob)).expect(200);
    // 이미 지운 항목을 고치거나 지우면 404 (다른 멤버가 먼저 지운 경우)
    await api(app).patch(`/v1/groups/${groupId}/todo-items/${z.id}`).set(auth(alice)).send({ done: true }).expect(404);
    await api(app).delete(`/v1/groups/${groupId}/todo-items/${z.id}`).set(auth(alice)).expect(404);
    const restored = await addItem(bob, list.id, 'z', true);
    expect(restored).toMatchObject({ done: true, doneBy: expect.objectContaining({ userId: bob.userId }) });
    expect((await detail(alice, list.publicCode)).items).toHaveLength(1);
  });

  it('목록 삭제는 항목 Cascade', async () => {
    const list = await createList(alice, '지울 목록');
    await addItem(alice, list.id, '하나');
    await addItem(alice, list.id, '둘');
    await api(app).delete(`/v1/groups/${groupId}/todo-lists/${list.id}`).set(auth(bob)).expect(200);
    expect(await prisma.todoItem.count({ where: { listId: list.id } })).toBe(0);
    await api(app).get(`/v1/todo-lists/${list.publicCode}`).set(auth(alice)).expect(404);
    await api(app).post(`/v1/groups/${groupId}/todo-lists/${list.id}/items`).set(auth(alice)).send({ text: 'x' }).expect(404);
  });

  it('상한: 팀당 목록 20개, 목록당 항목 300개 → 400 TODO_LIMIT_REACHED (동시 요청도 넘지 않음)', async () => {
    await resetLists();
    for (let i = 0; i < 19; i += 1) await createList(alice, `목록 ${i}`);
    // 남은 자리 하나에 동시에 셋 → 하나만 성공
    const racers = await Promise.all([0, 1, 2].map((i) => api(app).post(`/v1/groups/${groupId}/todo-lists`).set(auth(alice)).send({ name: `경쟁 ${i}` })));
    expect(racers.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 400, 400]);
    const over = await api(app).post(`/v1/groups/${groupId}/todo-lists`).set(auth(bob)).send({ name: '21번째' }).expect(400);
    expect(over.body).toMatchObject({ message: '목록은 20개까지 만들 수 있어요', error: { code: 'TODO_LIMIT_REACHED' } });
    expect(await prisma.todoList.count({ where: { groupId } })).toBe(20);

    const target = (await lists(alice))[0] as { id: number };
    await prisma.todoItem.createMany({ data: Array.from({ length: 299 }, (_, i) => ({ listId: target.id, text: `항목 ${i}`, creatorId: alice.userId })) });
    const itemRacers = await Promise.all([0, 1].map((i) => api(app).post(`/v1/groups/${groupId}/todo-lists/${target.id}/items`).set(auth(alice)).send({ text: `마지막 ${i}` })));
    expect(itemRacers.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 400]);
    const full = await api(app).post(`/v1/groups/${groupId}/todo-lists/${target.id}/items`).set(auth(alice)).send({ text: '301' }).expect(400);
    expect(full.body).toMatchObject({ message: '항목은 300개까지 넣을 수 있어요', error: { code: 'TODO_LIMIT_REACHED' } });
    expect(await prisma.todoItem.count({ where: { listId: target.id } })).toBe(300);
    await resetLists();
  });

  it('개인 팀에서도 같은 기능 (서버 분기 없음)', async () => {
    const groups = (await api(app).get('/v1/groups').set(auth(alice)).expect(200)).body.data as { id: number; type: string }[];
    const personal = groups.find((g) => g.type === 'PERSONAL')!;
    const list = await createList(alice, '혼자 체크리스트', personal.id);
    await api(app).post(`/v1/groups/${personal.id}/todo-lists/${list.id}/items`).set(auth(alice)).send({ text: '운동' }).expect(201);
    expect((await lists(alice, personal.id))[0]).toMatchObject({ name: '혼자 체크리스트', openCount: 1 });
    await api(app).get(`/v1/groups/${personal.id}/todo-lists`).set(auth(bob)).expect(403);
    await api(app).get(`/v1/todo-lists/${list.publicCode}`).set(auth(bob)).expect(404);
  });

  it('멤버 합류: 기존 목록이 보인다. 나가기: 만든 것은 남고 닉네임(회색), 나간 사람은 403. 탈퇴: "탈퇴한 멤버"', async () => {
    const list = await createList(bob, '같이 할 일');
    const it1 = await addItem(bob, list.id, '영화');
    await api(app).patch(`/v1/groups/${groupId}/todo-items/${it1.id}`).set(auth(bob)).send({ done: true }).expect(200);

    // 캐롤 합류 → 기존 목록이 그대로 보인다
    await api(app).post('/v1/groups/join').set(auth(carol)).send({ code: inviteCode }).expect(200);
    expect((await lists(carol)).some((l) => l.id === list.id)).toBe(true);
    await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(carol)).expect(200);
    await api(app).get(`/v1/groups/${groupId}/todo-lists`).set(auth(carol)).expect(403);
    await api(app).get(`/v1/todo-lists/${list.publicCode}`).set(auth(carol)).expect(404);

    // 밥이 나감 → 목록과 항목은 남고 표시는 닉네임 + 회색
    await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(bob)).expect(200);
    const left = await detail(alice, list.publicCode);
    expect(left.list.creator).toMatchObject({ userId: bob.userId, displayName: '밥', color: '#9CA3AF' });
    expect(left.items[0]).toMatchObject({ creator: { userId: bob.userId, displayName: '밥' }, doneBy: { userId: bob.userId } });

    // 밥 탈퇴 → "탈퇴한 멤버"
    await api(app).delete('/v1/me').set(auth(bob)).expect(200);
    const gone = await detail(alice, list.publicCode);
    expect(gone.list.creator).toMatchObject({ userId: null, displayName: '탈퇴한 멤버' });
    expect(gone.list.editor).toMatchObject({ userId: null, displayName: '탈퇴한 멤버' });
    expect(gone.items[0]).toMatchObject({ done: true, creator: { userId: null, displayName: '탈퇴한 멤버' }, doneBy: { userId: null, displayName: '탈퇴한 멤버' } });
  });

  it('팀이 지워지면(마지막 멤버 나감) 목록과 항목도 Cascade', async () => {
    const dave = await devLogin(app, '데이브');
    const team = await api(app).post('/v1/groups').set(auth(dave)).send({ name: '혼자 팀' }).expect(201);
    const list = await createList(dave, '사라질 목록', team.body.data.id);
    await api(app).post(`/v1/groups/${team.body.data.id}/todo-lists/${list.id}/items`).set(auth(dave)).send({ text: '하나' }).expect(201);
    await api(app).delete(`/v1/groups/${team.body.data.id}/me`).set(auth(dave)).expect(200);
    expect(await prisma.todoList.count({ where: { id: list.id } })).toBe(0);
    expect(await prisma.todoItem.count({ where: { listId: list.id } })).toBe(0);
  });

  it('할 일은 새 소식(EventLog, GroupActivity)에 남지 않는다 (D-207)', async () => {
    const before = await prisma.groupActivity.count({ where: { groupId } });
    const list = await createList(alice, '소식 없음');
    await addItem(alice, list.id, '조용히');
    expect(await prisma.groupActivity.count({ where: { groupId } })).toBe(before);
    expect(await prisma.eventLog.count({ where: { groupId } })).toBe(0);
  });

  async function resetLists(): Promise<void> {
    await prisma.todoList.deleteMany({ where: { groupId } });
  }
});
