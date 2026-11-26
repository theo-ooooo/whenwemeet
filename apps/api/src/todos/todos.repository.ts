import { Injectable } from '@nestjs/common';
import {
  toUserRowOrNull,
  USER_PUBLIC_SELECT,
  type UserPublicRecord,
  type UserRow,
} from '../common/member.js';
import { generatePublicCode } from '../common/public-code.js';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import { type Db, PrismaService } from '../prisma/prisma.service.js';

/** (#276) 할 일 목록, 항목 저장소 (설계 할일-목록.md, D-206 ~ D-208) */

const TODO_LIST_SELECT = {
  id: true,
  groupId: true,
  publicCode: true,
  name: true,
  creatorId: true,
  editorId: true,
  createdAt: true,
  updatedAt: true,
  creator: USER_PUBLIC_SELECT,
  editor: USER_PUBLIC_SELECT,
  group: { select: { publicCode: true } },
} as const;

const TODO_ITEM_SELECT = {
  id: true,
  listId: true,
  text: true,
  done: true,
  doneAt: true,
  doneById: true,
  creatorId: true,
  createdAt: true,
  updatedAt: true,
  creator: USER_PUBLIC_SELECT,
  doneBy: USER_PUBLIC_SELECT,
} as const;

export interface TodoListRow {
  id: number;
  groupId: number;
  groupCode: string;
  publicCode: string;
  name: string;
  creatorId: number | null;
  editorId: number | null;
  createdAt: Date;
  updatedAt: Date;
  creator: UserRow | null;
  editor: UserRow | null;
}

export interface TodoListSummaryRow {
  id: number;
  publicCode: string;
  name: string;
  editorId: number | null;
  editor: UserRow | null;
  updatedAt: Date;
  openCount: number;
  doneCount: number;
}

export interface TodoItemRow {
  id: number;
  listId: number;
  text: string;
  done: boolean;
  doneAt: Date | null;
  doneById: number | null;
  creatorId: number | null;
  createdAt: Date;
  updatedAt: Date;
  creator: UserRow | null;
  doneBy: UserRow | null;
}

/** 항목 수정 값. 바뀌는 칸만 */
export interface TodoItemChange {
  text?: string;
  done?: boolean;
  doneAt?: Date | null;
  doneById?: number | null;
}

export interface TodoItemCreateInput {
  text: string;
  done: boolean;
  doneAt: Date | null;
  doneById: number | null;
  creatorId: number;
}

type ListRecord = Omit<TodoListRow, 'creator' | 'editor' | 'groupCode'> & {
  creator: UserPublicRecord | null;
  editor: UserPublicRecord | null;
  group: { publicCode: string };
};
type ItemRecord = Omit<TodoItemRow, 'creator' | 'doneBy'> & {
  creator: UserPublicRecord | null;
  doneBy: UserPublicRecord | null;
};

/** 상한에 걸려 트랜잭션을 되돌릴 때 던지는 표식 (밖에서 null 로 바꾼다) */
class LimitReached extends Error {}

/** 고칠 행이 그사이 지워졌음 (다른 멤버가 먼저 지움). Prisma P2025 */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2025'
  );
}

@Injectable()
export class TodosRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
  ) {}

  /** 목록 화면. updatedAt 내림차순(같으면 id 내림차순), 목록마다 남은 개수와 완료 개수 */
  async listSummaries(groupId: number): Promise<TodoListSummaryRow[]> {
    const lists = await this.prisma.todoList.findMany({
      where: { groupId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        publicCode: true,
        name: true,
        editorId: true,
        updatedAt: true,
        editor: USER_PUBLIC_SELECT,
      },
    });
    if (lists.length === 0) return [];
    const counts = await this.prisma.todoItem.groupBy({
      by: ['listId', 'done'],
      where: { listId: { in: lists.map((l) => l.id) } },
      _count: { _all: true },
    });
    const countOf = (listId: number, done: boolean) =>
      counts.find((c) => c.listId === listId && c.done === done)?._count._all ??
      0;
    return lists.map((l) => ({
      id: l.id,
      publicCode: l.publicCode,
      name: l.name,
      editorId: l.editorId,
      editor: toUserRowOrNull(l.editor, this.urls),
      updatedAt: l.updatedAt,
      openCount: countOf(l.id, false),
      doneCount: countOf(l.id, true),
    }));
  }

  /** 공개 코드로 목록 하나 (팀 확인은 서비스가) */
  async findListByCode(code: string): Promise<TodoListRow | null> {
    const row = await this.prisma.todoList.findUnique({
      where: { publicCode: code },
      select: TODO_LIST_SELECT,
    });
    return row && this.toListRow(row);
  }

  /** 다른 팀 목록을 가리키는 번호는 null (D-31) */
  findListInGroup(
    groupId: number,
    listId: number,
  ): Promise<{ id: number; name: string } | null> {
    return this.prisma.todoList.findFirst({
      where: { id: listId, groupId },
      select: { id: true, name: true },
    });
  }

  /** 다른 팀 항목을 가리키는 번호는 null. 항목에는 groupId 가 없어 목록을 거친다 (D-206) */
  findItemInGroup(
    groupId: number,
    itemId: number,
  ): Promise<{
    id: number;
    listId: number;
    text: string;
    done: boolean;
  } | null> {
    return this.prisma.todoItem.findFirst({
      where: { id: itemId, list: { groupId } },
      select: { id: true, listId: true, text: true, done: true },
    });
  }

  /** 목록의 항목 전부 (정렬은 서비스의 sortTodoItems) */
  async listItems(listId: number): Promise<TodoItemRow[]> {
    const rows = await this.prisma.todoItem.findMany({
      where: { listId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: TODO_ITEM_SELECT,
    });
    return rows.map((row) => this.toItemRow(row));
  }

  /**
   * 목록 만들기. 팀 행을 잠그고(FOR UPDATE) 개수를 센 뒤 만든다. 이미 limit 개면 null (D-208).
   * 공개 코드는 일정처럼 만들 때 생성한다 (32^8 이라 충돌은 무시, D-197)
   */
  async createListWithinLimit(
    input: { groupId: number; name: string; creatorId: number },
    limit: number,
  ): Promise<TodoListRow | null> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM \`Group\` WHERE id = ${input.groupId} FOR UPDATE`;
        if (
          (await tx.todoList.count({ where: { groupId: input.groupId } })) >=
          limit
        )
          throw new LimitReached();
        return tx.todoList.create({
          data: {
            groupId: input.groupId,
            name: input.name,
            creatorId: input.creatorId,
            editorId: input.creatorId,
            publicCode: generatePublicCode(),
          },
          select: TODO_LIST_SELECT,
        });
      });
      return this.toListRow(row);
    } catch (error) {
      if (error instanceof LimitReached) return null;
      throw error;
    }
  }

  /** 이름 바꾸기 + 마지막으로 바꾼 사람 */
  async renameList(
    listId: number,
    name: string,
    editorId: number,
  ): Promise<TodoListRow> {
    const row = await this.prisma.todoList.update({
      where: { id: listId },
      data: { name, editorId },
      select: TODO_LIST_SELECT,
    });
    return this.toListRow(row);
  }

  /** 목록 그대로 (이름이 같아 쓰지 않을 때의 응답) */
  async getList(listId: number): Promise<TodoListRow> {
    const row = await this.prisma.todoList.findUniqueOrThrow({
      where: { id: listId },
      select: TODO_LIST_SELECT,
    });
    return this.toListRow(row);
  }

  /** 목록 삭제. 항목은 Cascade */
  async deleteList(listId: number): Promise<void> {
    await this.prisma.todoList.deleteMany({ where: { id: listId } });
  }

  /**
   * 항목 추가. 목록 행을 잠그고 updatedAt, editorId 를 올린 뒤 개수를 세어 limit 개면
   * 트랜잭션을 되돌리고 null (D-208). 목록이 그사이 지워졌으면 'GONE'
   */
  async createItemWithinLimit(
    listId: number,
    input: TodoItemCreateInput,
    limit: number,
  ): Promise<TodoItemRow | null | 'GONE'> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await this.touchListTx(tx, listId, input.creatorId);
        if ((await tx.todoItem.count({ where: { listId } })) >= limit)
          throw new LimitReached();
        return tx.todoItem.create({
          data: { listId, ...input },
          select: TODO_ITEM_SELECT,
        });
      });
      return this.toItemRow(row);
    } catch (error) {
      if (error instanceof LimitReached) return null;
      if (isNotFound(error)) return 'GONE';
      throw error;
    }
  }

  /** 항목 수정 + 목록 updatedAt, editorId. 그사이 지워졌으면 null */
  async updateItem(
    itemId: number,
    listId: number,
    change: TodoItemChange,
    editorId: number,
  ): Promise<TodoItemRow | null> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.todoItem.update({
          where: { id: itemId },
          data: change,
          select: TODO_ITEM_SELECT,
        });
        await this.touchListTx(tx, listId, editorId);
        return updated;
      });
      return this.toItemRow(row);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** 항목 하나 그대로 (같은 값이라 쓰지 않을 때의 응답) */
  async getItem(itemId: number): Promise<TodoItemRow | null> {
    const row = await this.prisma.todoItem.findUnique({
      where: { id: itemId },
      select: TODO_ITEM_SELECT,
    });
    return row && this.toItemRow(row);
  }

  /** 항목 삭제 + 목록 updatedAt. 이미 없으면 false */
  async deleteItem(
    itemId: number,
    listId: number,
    editorId: number,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.todoItem.deleteMany({ where: { id: itemId } });
      if (count > 0)
        await tx.todoList.updateMany({
          where: { id: listId },
          data: { editorId, updatedAt: new Date() },
        });
      return count > 0;
    });
  }

  /** 완료 항목 지우기. 하나 이상 지웠을 때만 목록 updatedAt */
  async clearDone(listId: number, editorId: number): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.todoItem.deleteMany({
        where: { listId, done: true },
      });
      if (count > 0)
        await tx.todoList.updateMany({
          where: { id: listId },
          data: { editorId, updatedAt: new Date() },
        });
      return count;
    });
  }

  /**
   * 항목이 바뀌면 목록도 바뀐 것으로 (정렬, 마지막으로 바꾼 사람). 먼저 목록 행을 잠근다(FOR UPDATE):
   * Prisma 의 update 는 UPDATE 전에 일반 SELECT 를 해 그 순간의 읽기 시점이 잡히므로, 잠금 없이 시작하면
   * 뒤의 개수 세기가 먼저 끝난 다른 트랜잭션의 항목을 못 본다 (D-208). 목록이 없으면 P2025 와 같은 표식을 던진다
   */
  private async touchListTx(
    tx: Db,
    listId: number,
    editorId: number,
  ): Promise<void> {
    const locked = await tx.$queryRaw<
      { id: number }[]
    >`SELECT id FROM \`TodoList\` WHERE id = ${listId} FOR UPDATE`;
    if (locked.length === 0)
      throw Object.assign(new Error('목록이 없어요'), { code: 'P2025' });
    await tx.todoList.update({
      where: { id: listId },
      data: { editorId, updatedAt: new Date() },
      select: { id: true },
    });
  }

  private toListRow(record: ListRecord): TodoListRow {
    const { group, ...rest } = record;
    return {
      ...rest,
      groupCode: group.publicCode,
      creator: toUserRowOrNull(record.creator, this.urls),
      editor: toUserRowOrNull(record.editor, this.urls),
    };
  }

  private toItemRow(record: ItemRecord): TodoItemRow {
    return {
      ...record,
      creator: toUserRowOrNull(record.creator, this.urls),
      doneBy: toUserRowOrNull(record.doneBy, this.urls),
    };
  }
}
