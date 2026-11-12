import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import type { Member, MemberResolver } from '../common/member.js';
import { parsePublicCode } from '../common/public-code.js';
import { MembershipService } from '../groups/membership.service.js';
import type { TodoItemCreateDto, TodoItemPatchDto, TodoListInputDto } from './dto/todo.dto.js';
import { sortTodoItems } from './todo-order.js';
import { type TodoItemChange, type TodoItemRow, type TodoListRow, TodosRepository } from './todos.repository.js';

/** (#276, D-208) 팀당 목록, 목록당 항목 상한 */
export const TODO_LIST_LIMIT = 20;
export const TODO_ITEM_LIMIT = 300;

export interface TodoListSummaryView {
  id: number;
  publicCode: string;
  name: string;
  openCount: number;
  doneCount: number;
  /** 마지막으로 바꾼 사람. 탈퇴했으면 "탈퇴한 멤버" */
  editor: Member;
  updatedAt: Date;
}

export interface TodoListView {
  id: number;
  publicCode: string;
  groupId: number;
  groupCode: string;
  name: string;
  creator: Member;
  editor: Member;
  createdAt: Date;
  updatedAt: Date;
}

export interface TodoItemView {
  id: number;
  listId: number;
  text: string;
  done: boolean;
  doneAt: Date | null;
  /** 완료한 사람. 미완료면 null, 완료인데 탈퇴했으면 "탈퇴한 멤버" */
  doneBy: Member | null;
  creator: Member;
  createdAt: Date;
  updatedAt: Date;
}

export function toTodoListView(row: TodoListRow, resolver: MemberResolver): TodoListView {
  return {
    id: row.id,
    publicCode: row.publicCode,
    groupId: row.groupId,
    groupCode: row.groupCode,
    name: row.name,
    creator: resolver.resolve(row.creatorId, row.creator),
    editor: resolver.resolve(row.editorId, row.editor),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toTodoItemView(row: TodoItemRow, resolver: MemberResolver): TodoItemView {
  return {
    id: row.id,
    listId: row.listId,
    text: row.text,
    done: row.done,
    doneAt: row.done ? row.doneAt : null,
    doneBy: row.done ? resolver.resolve(row.doneById, row.doneBy) : null,
    creator: resolver.resolve(row.creatorId, row.creator),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const LIST_NOT_FOUND = () => new ApiException('NOT_FOUND', '할 일 목록을 찾을 수 없어요');
const ITEM_NOT_FOUND = () => new ApiException('NOT_FOUND', '이미 삭제된 항목이에요');

/**
 * (#276) 팀 공유 할 일 목록 (설계 할일-목록.md, D-206 ~ D-210). 멤버 누구나 모든 목록과 항목을 고친다 (D-18).
 * 새 소식과 푸시에는 남기지 않는다 (D-210)
 */
@Injectable()
export class TodosService {
  constructor(
    private readonly todos: TodosRepository,
    private readonly memberships: MembershipService,
  ) {}

  async listLists(userId: number, groupId: number): Promise<{ items: TodoListSummaryView[] }> {
    await this.memberships.assertMember(userId, groupId);
    const rows = await this.todos.listSummaries(groupId);
    const resolver = await this.memberships.resolverFor(groupId);
    return {
      items: rows.map((row) => ({
        id: row.id,
        publicCode: row.publicCode,
        name: row.name,
        openCount: row.openCount,
        doneCount: row.doneCount,
        editor: resolver.resolve(row.editorId, row.editor),
        updatedAt: row.updatedAt,
      })),
    };
  }

  async createList(userId: number, groupId: number, dto: TodoListInputDto): Promise<TodoListView> {
    await this.memberships.assertMember(userId, groupId);
    const row = await this.todos.createListWithinLimit({ groupId, name: dto.name, creatorId: userId }, TODO_LIST_LIMIT);
    if (!row) throw new ApiException('TODO_LIMIT_REACHED', `목록은 ${TODO_LIST_LIMIT}개까지 만들 수 있어요`);
    return toTodoListView(row, await this.memberships.resolverFor(groupId));
  }

  /** 공개 코드로 목록과 항목. 틀린 코드, 없는 목록, 비멤버를 가리지 않고 404 (D-197 과 같은 예외, D-206) */
  async getByCode(userId: number, codeRaw: unknown): Promise<{ list: TodoListView; items: TodoItemView[] }> {
    const code = parsePublicCode(codeRaw);
    const row = code === null ? null : await this.todos.findListByCode(code);
    if (!row || !(await this.memberships.isMember(userId, row.groupId))) throw LIST_NOT_FOUND();
    const [items, resolver] = await Promise.all([this.todos.listItems(row.id), this.memberships.resolverFor(row.groupId)]);
    return { list: toTodoListView(row, resolver), items: sortTodoItems(items).map((item) => toTodoItemView(item, resolver)) };
  }

  async renameList(userId: number, groupId: number, listId: number, dto: TodoListInputDto): Promise<TodoListView> {
    await this.memberships.assertMember(userId, groupId);
    const list = await this.todos.findListInGroup(groupId, listId);
    if (!list) throw LIST_NOT_FOUND();
    // 같은 이름이면 쓰지 않는다 (정렬이 흔들리지 않게, D-207)
    const row = list.name === dto.name ? await this.todos.getList(listId) : await this.todos.renameList(listId, dto.name, userId);
    return toTodoListView(row, await this.memberships.resolverFor(groupId));
  }

  async deleteList(userId: number, groupId: number, listId: number): Promise<{ ok: true }> {
    await this.memberships.assertMember(userId, groupId);
    if (!(await this.todos.findListInGroup(groupId, listId))) throw LIST_NOT_FOUND();
    await this.todos.deleteList(listId);
    return { ok: true };
  }

  /** 항목 추가. `done: true` 는 삭제 되돌리기에서 완료 상태를 같이 되살릴 때 (완료 시각은 지금, D-207) */
  async createItem(userId: number, groupId: number, listId: number, dto: TodoItemCreateDto, now: Date = new Date()): Promise<TodoItemView> {
    await this.memberships.assertMember(userId, groupId);
    if (!(await this.todos.findListInGroup(groupId, listId))) throw LIST_NOT_FOUND();
    const done = dto.done === true;
    const row = await this.todos.createItemWithinLimit(
      listId,
      { text: dto.text, done, doneAt: done ? now : null, doneById: done ? userId : null, creatorId: userId },
      TODO_ITEM_LIMIT,
    );
    if (row === 'GONE') throw LIST_NOT_FOUND();
    if (!row) throw new ApiException('TODO_LIMIT_REACHED', `항목은 ${TODO_ITEM_LIMIT}개까지 넣을 수 있어요`);
    return toTodoItemView(row, await this.memberships.resolverFor(groupId));
  }

  /** 글, 완료 고치기. 지금 값과 같은 칸은 쓰지 않고, 바뀐 칸이 없으면 그대로 돌려준다 (멱등, D-207) */
  async updateItem(userId: number, groupId: number, itemId: number, dto: TodoItemPatchDto, now: Date = new Date()): Promise<TodoItemView> {
    await this.memberships.assertMember(userId, groupId);
    const item = await this.todos.findItemInGroup(groupId, itemId);
    if (!item) throw ITEM_NOT_FOUND();
    const change = itemChange(item, dto, userId, now);
    const row = change ? await this.todos.updateItem(itemId, item.listId, change, userId) : await this.todos.getItem(itemId);
    if (!row) throw ITEM_NOT_FOUND();
    return toTodoItemView(row, await this.memberships.resolverFor(groupId));
  }

  async deleteItem(userId: number, groupId: number, itemId: number): Promise<{ ok: true }> {
    await this.memberships.assertMember(userId, groupId);
    const item = await this.todos.findItemInGroup(groupId, itemId);
    if (!item || !(await this.todos.deleteItem(itemId, item.listId, userId))) throw ITEM_NOT_FOUND();
    return { ok: true };
  }

  /** 완료 항목 지우기. 쿼리 `done=true` 만 받는다 (나중에 다른 조건이 생겨도 실수로 전부 지우지 않게) */
  async clearDone(userId: number, groupId: number, listId: number, doneParam: unknown): Promise<{ ok: true; count: number }> {
    await this.memberships.assertMember(userId, groupId);
    if (doneParam !== 'true') {
      const message = '완료 항목만 지울 수 있어요 (done=true)';
      throw new ApiException('VALIDATION_FAILED', message, [{ field: 'done', message }]);
    }
    if (!(await this.todos.findListInGroup(groupId, listId))) throw LIST_NOT_FOUND();
    const count = await this.todos.clearDone(listId, userId);
    return { ok: true, count };
  }
}

/** 실제로 바뀌는 칸만. 없으면 null */
export function itemChange(
  current: { text: string; done: boolean },
  dto: { text?: string; done?: boolean },
  userId: number,
  now: Date,
): TodoItemChange | null {
  const change: TodoItemChange = {};
  if (dto.text !== undefined && dto.text !== current.text) change.text = dto.text;
  if (dto.done !== undefined && dto.done !== current.done) {
    change.done = dto.done;
    change.doneAt = dto.done ? now : null;
    change.doneById = dto.done ? userId : null;
  }
  return Object.keys(change).length > 0 ? change : null;
}
