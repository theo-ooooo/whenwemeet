import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { TodoItemCreateDto, TodoItemPatchDto, TodoListInputDto } from './dto/todo.dto.js';
import { sortTodoItems } from './todo-order.js';
import type { TodoItemRow, TodoListRow } from './todos.repository.js';
import { TodosRepository } from './todos.repository.js';
import { itemChange, TODO_ITEM_LIMIT, TODO_LIST_LIMIT, TodosService } from './todos.service.js';

const config = { getOrThrow: () => 'http://web' } as never;
const NOW = new Date('2026-11-12T03:00:00.000Z');
const ALICE = { nickname: '앨리스', profileImageUrl: null };

const LIST: TodoListRow = {
  id: 7,
  groupId: 10,
  groupCode: 'team1234',
  publicCode: 'abcd2345',
  name: '장보기',
  creatorId: 1,
  editorId: 1,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-02T00:00:00.000Z'),
  creator: ALICE,
  editor: ALICE,
};

const item = (over: Partial<TodoItemRow> = {}): TodoItemRow => ({
  id: 1,
  listId: 7,
  text: '우유',
  done: false,
  doneAt: null,
  doneById: null,
  creatorId: 1,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  creator: ALICE,
  doneBy: null,
  ...over,
});

describe('sortTodoItems (D-207)', () => {
  it('미완료는 추가순(같은 시각이면 id), 그 아래 완료는 완료 시각 최신순', () => {
    const t = (iso: string) => new Date(iso);
    const rows = [
      { id: 1, done: true, doneAt: t('2026-11-03T00:00:00Z'), createdAt: t('2026-11-01T00:00:00Z') },
      { id: 2, done: false, doneAt: null, createdAt: t('2026-11-02T00:00:00Z') },
      { id: 3, done: false, doneAt: null, createdAt: t('2026-11-01T00:00:00Z') },
      { id: 4, done: true, doneAt: t('2026-11-05T00:00:00Z'), createdAt: t('2026-11-01T00:00:00Z') },
      { id: 5, done: false, doneAt: null, createdAt: t('2026-11-01T00:00:00Z') },
    ];
    expect(sortTodoItems(rows).map((r) => r.id)).toEqual([3, 5, 2, 4, 1]);
  });
});

describe('itemChange (멱등, D-207)', () => {
  it('같은 값은 null, 바뀐 칸만, 완료는 시각과 사람을 같이', () => {
    const current = { text: '우유', done: false };
    expect(itemChange(current, {}, 1, NOW)).toBeNull();
    expect(itemChange(current, { text: '우유', done: false }, 1, NOW)).toBeNull();
    expect(itemChange(current, { text: '두유' }, 1, NOW)).toEqual({ text: '두유' });
    expect(itemChange(current, { done: true }, 2, NOW)).toEqual({ done: true, doneAt: NOW, doneById: 2 });
    expect(itemChange({ text: '우유', done: true }, { done: false }, 2, NOW)).toEqual({ done: false, doneAt: null, doneById: null });
  });
});

describe('할 일 DTO', () => {
  const errorsOf = async (cls: new () => object, body: object) => (await validate(plainToInstance(cls, body))).map((e) => e.property);

  it('앞뒤 공백을 자르고 길이 검사 (이름 1~30, 글 1~100)', async () => {
    expect(await errorsOf(TodoListInputDto, { name: '  장보기  ' })).toEqual([]);
    expect(plainToInstance(TodoListInputDto, { name: '  장보기  ' }).name).toBe('장보기');
    expect(await errorsOf(TodoListInputDto, { name: '   ' })).toEqual(['name']);
    expect(await errorsOf(TodoListInputDto, { name: 'a'.repeat(31) })).toEqual(['name']);
    expect(await errorsOf(TodoListInputDto, { name: 3 })).toEqual(['name']);
    expect(await errorsOf(TodoItemCreateDto, { text: 'a'.repeat(100) })).toEqual([]);
    expect(await errorsOf(TodoItemCreateDto, { text: 'a'.repeat(101) })).toEqual(['text']);
    expect(await errorsOf(TodoItemCreateDto, { text: '우유', done: 'yes' })).toEqual(['done']);
  });

  it('고치기: 생략은 허용, null 은 거부', async () => {
    expect(await errorsOf(TodoItemPatchDto, {})).toEqual([]);
    expect(await errorsOf(TodoItemPatchDto, { done: null })).toEqual(['done']);
    expect(await errorsOf(TodoItemPatchDto, { text: null })).toEqual(['text']);
    expect(await errorsOf(TodoItemPatchDto, { text: '' })).toEqual(['text']);
  });
});

describe('TodosService', () => {
  let todos: RepositoryMock<TodosRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let service: TodosService;

  beforeEach(() => {
    todos = mockRepository(TodosRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, config);
    service = new TodosService(todos as never, memberships);
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
    todos.findListInGroup.mockResolvedValue({ id: 7, name: '장보기' });
    todos.findItemInGroup.mockResolvedValue({ id: 1, listId: 7, text: '우유', done: false });
  });

  it('멤버가 아니면 FORBIDDEN, 저장소를 부르지 않는다', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    await expect(service.listLists(9, 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.createList(9, 10, { name: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.renameList(9, 10, 7, { name: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.deleteList(9, 10, 7)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.createItem(9, 10, 7, { text: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.updateItem(9, 10, 1, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.deleteItem(9, 10, 1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.clearDone(9, 10, 7, 'true')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(todos.findListInGroup).not.toHaveBeenCalled();
    expect(todos.listSummaries).not.toHaveBeenCalled();
  });

  it('목록 화면: 개수와 마지막으로 바꾼 사람 (탈퇴했으면 "탈퇴한 멤버")', async () => {
    todos.listSummaries.mockResolvedValue([
      { id: 7, publicCode: 'abcd2345', name: '장보기', editorId: 1, editor: ALICE, updatedAt: NOW, openCount: 2, doneCount: 1 },
      { id: 8, publicCode: 'efgh2345', name: '여행', editorId: null, editor: null, updatedAt: NOW, openCount: 0, doneCount: 0 },
    ]);
    const { items } = await service.listLists(1, 10);
    expect(items[0]).toMatchObject({ name: '장보기', openCount: 2, doneCount: 1, editor: { userId: 1, displayName: '앨리스' } });
    expect(items[1].editor).toMatchObject({ userId: null, displayName: '탈퇴한 멤버' });
  });

  it('목록 상한: 저장소가 null 이면 TODO_LIMIT_REACHED (20개)', async () => {
    todos.createListWithinLimit.mockResolvedValue(null);
    await expect(service.createList(1, 10, { name: '장보기' })).rejects.toMatchObject({ code: 'TODO_LIMIT_REACHED', message: '목록은 20개까지 만들 수 있어요' });
    expect(todos.createListWithinLimit).toHaveBeenCalledWith({ groupId: 10, name: '장보기', creatorId: 1 }, TODO_LIST_LIMIT);
    expect(TODO_LIST_LIMIT).toBe(20);
  });

  it('목록 만들기: 응답에 공개 코드와 팀 코드', async () => {
    todos.createListWithinLimit.mockResolvedValue(LIST);
    expect(await service.createList(1, 10, { name: '장보기' })).toMatchObject({ id: 7, publicCode: 'abcd2345', groupId: 10, groupCode: 'team1234', creator: { displayName: '앨리스' } });
  });

  it('항목 상한: TODO_LIMIT_REACHED (300개), 목록이 그사이 지워졌으면 NOT_FOUND', async () => {
    todos.createItemWithinLimit.mockResolvedValue(null);
    await expect(service.createItem(1, 10, 7, { text: '우유' })).rejects.toMatchObject({ code: 'TODO_LIMIT_REACHED', message: '항목은 300개까지 넣을 수 있어요' });
    expect(todos.createItemWithinLimit.mock.calls[0][2]).toBe(TODO_ITEM_LIMIT);
    expect(TODO_ITEM_LIMIT).toBe(300);
    todos.createItemWithinLimit.mockResolvedValue('GONE');
    await expect(service.createItem(1, 10, 7, { text: '우유' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('항목 추가: done=true(되돌리기)면 완료 시각은 지금, 완료한 사람은 나', async () => {
    todos.createItemWithinLimit.mockResolvedValue(item({ done: true, doneAt: NOW, doneById: 1, doneBy: ALICE }));
    const view = await service.createItem(1, 10, 7, { text: '우유', done: true }, NOW);
    expect(todos.createItemWithinLimit).toHaveBeenCalledWith(7, { text: '우유', done: true, doneAt: NOW, doneById: 1, creatorId: 1 }, 300);
    expect(view).toMatchObject({ done: true, doneAt: NOW, doneBy: { userId: 1 } });
    await service.createItem(1, 10, 7, { text: '빵' }, NOW);
    expect(todos.createItemWithinLimit).toHaveBeenLastCalledWith(7, { text: '빵', done: false, doneAt: null, doneById: null, creatorId: 1 }, 300);
  });

  it('다른 팀 목록, 항목은 NOT_FOUND (D-31)', async () => {
    todos.findListInGroup.mockResolvedValue(null);
    todos.findItemInGroup.mockResolvedValue(null);
    await expect(service.renameList(1, 10, 99, { name: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.deleteList(1, 10, 99)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.createItem(1, 10, 99, { text: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.clearDone(1, 10, 99, 'true')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.updateItem(1, 10, 99, { done: true })).rejects.toMatchObject({ code: 'NOT_FOUND', message: '이미 삭제된 항목이에요' });
    await expect(service.deleteItem(1, 10, 99)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('이름 바꾸기: 같은 이름이면 쓰지 않는다', async () => {
    todos.getList.mockResolvedValue(LIST);
    todos.renameList.mockResolvedValue({ ...LIST, name: '마트' });
    await service.renameList(1, 10, 7, { name: '장보기' });
    expect(todos.renameList).not.toHaveBeenCalled();
    expect((await service.renameList(1, 10, 7, { name: '마트' })).name).toBe('마트');
    expect(todos.renameList).toHaveBeenCalledWith(7, '마트', 1);
  });

  it('항목 고치기: 같은 값이면 쓰지 않고 그대로, 바뀌면 바뀐 칸만. 그사이 지워졌으면 NOT_FOUND', async () => {
    todos.getItem.mockResolvedValue(item());
    await service.updateItem(1, 10, 1, { done: false, text: '우유' }, NOW);
    expect(todos.updateItem).not.toHaveBeenCalled();

    todos.updateItem.mockResolvedValue(item({ done: true, doneAt: NOW, doneById: 1, doneBy: ALICE }));
    const view = await service.updateItem(1, 10, 1, { done: true }, NOW);
    expect(todos.updateItem).toHaveBeenCalledWith(1, 7, { done: true, doneAt: NOW, doneById: 1 }, 1);
    expect(view.doneBy).toMatchObject({ userId: 1 });

    todos.updateItem.mockResolvedValue(null);
    await expect(service.updateItem(1, 10, 1, { text: '두유' }, NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('미완료 항목은 doneAt, doneBy 를 싣지 않는다. 완료인데 탈퇴했으면 "탈퇴한 멤버"', async () => {
    todos.getItem.mockResolvedValue(item({ doneAt: NOW }));
    expect(await service.updateItem(1, 10, 1, {})).toMatchObject({ doneAt: null, doneBy: null });
    todos.findItemInGroup.mockResolvedValue({ id: 1, listId: 7, text: '우유', done: true });
    todos.getItem.mockResolvedValue(item({ done: true, doneAt: NOW, doneById: null, doneBy: null }));
    expect((await service.updateItem(1, 10, 1, {})).doneBy).toMatchObject({ userId: null, displayName: '탈퇴한 멤버' });
  });

  it('항목 삭제: 이미 없으면 NOT_FOUND', async () => {
    todos.deleteItem.mockResolvedValue(true);
    expect(await service.deleteItem(1, 10, 1)).toEqual({ ok: true });
    todos.deleteItem.mockResolvedValue(false);
    await expect(service.deleteItem(1, 10, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('완료 지우기: done=true 만, 지운 개수', async () => {
    await expect(service.clearDone(1, 10, 7, undefined)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(service.clearDone(1, 10, 7, 'false')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    todos.clearDone.mockResolvedValue(3);
    expect(await service.clearDone(1, 10, 7, 'true')).toEqual({ ok: true, count: 3 });
  });

  it('코드 조회: 틀린 모양, 없는 코드, 비멤버 모두 NOT_FOUND. 항목은 정렬해서', async () => {
    await expect(service.getByCode(1, 'bad')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(todos.findListByCode).not.toHaveBeenCalled();
    todos.findListByCode.mockResolvedValue(null);
    await expect(service.getByCode(1, 'abcd2345')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    todos.findListByCode.mockResolvedValue(LIST);
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    await expect(service.getByCode(9, 'ABCD2345')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(todos.findListByCode).toHaveBeenLastCalledWith('abcd2345');

    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    todos.listItems.mockResolvedValue([item({ id: 1, done: true, doneAt: NOW, doneById: 1, doneBy: ALICE }), item({ id: 2 })]);
    const res = await service.getByCode(1, 'abcd2345');
    expect(res.list).toMatchObject({ id: 7, name: '장보기' });
    expect(res.items.map((i) => i.id)).toEqual([2, 1]);
  });
});
