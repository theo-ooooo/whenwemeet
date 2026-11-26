import { errorBody } from "@/lib/envelope";
import { parseId } from "@/lib/id";
import { memberOf, mockGroupCode, mockTodoCode, type Store, type TodoItemRow, type TodoListRow } from "../fixtures";
import { err, isResult, nextId, nowIso, ok, type AuthedReq, type GroupReq, type MockResult } from "./shared";

/* ---------- (#276) 할 일 목록 (api.md 2.11) ---------- */

const TODO_LIST_LIMIT = 20;
const TODO_ITEM_LIMIT = 300;

function todoListOut(s: Store, l: TodoListRow) {
  return {
    id: l.id,
    publicCode: mockTodoCode(l.id),
    groupId: l.groupId,
    groupCode: mockGroupCode(l.groupId),
    name: l.name,
    creator: memberOf(s, l.groupId, l.creatorId),
    editor: memberOf(s, l.groupId, l.editorId),
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

function todoItemOut(s: Store, groupId: number, i: TodoItemRow) {
  return {
    id: i.id,
    listId: i.listId,
    text: i.text,
    done: i.done,
    doneAt: i.done ? i.doneAt : null,
    doneBy: i.done ? memberOf(s, groupId, i.doneById) : null,
    creator: memberOf(s, groupId, i.creatorId),
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

/** 미완료 추가순, 완료 최신순 (D-207) */
function sortedTodoItems(items: TodoItemRow[]): TodoItemRow[] {
  const open = items.filter((i) => !i.done).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  const done = items.filter((i) => i.done).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "") || b.id - a.id);
  return [...open, ...done];
}

const todoTextErr = (field: "name" | "text", max: number, label: string): MockResult => ({
  status: 400,
  body: errorBody(400, "VALIDATION_FAILED", `${label}은 1~${max}자여야 해요`, [{ field, message: `${label}은 1~${max}자여야 해요` }]),
});

/** 글 검사 (앞뒤 공백을 자른 길이). 맞으면 잘린 글, 아니면 오류 */
function todoText(v: unknown, field: "name" | "text"): string | MockResult {
  const max = field === "name" ? 30 : 100;
  const label = field === "name" ? "목록 이름" : "할 일";
  if (typeof v !== "string") return todoTextErr(field, max, label);
  const t = v.trim();
  return t.length < 1 || Array.from(t).length > max ? todoTextErr(field, max, label) : t;
}

function todoRoutes(
  s: Store,
  groupId: number,
  userId: number,
  rest: string[],
  method: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
): MockResult | null {
  const lists = (s.todoLists ??= []);
  const items = (s.todoItems ??= []);
  const touch = (l: TodoListRow) => {
    l.updatedAt = nowIso();
    l.editorId = userId;
  };
  if (rest[0] === "todo-lists") {
    if (rest.length === 1 && method === "GET") {
      const out = lists
        .filter((l) => l.groupId === groupId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
        .map((l) => {
          const mine = items.filter((i) => i.listId === l.id);
          return {
            id: l.id,
            publicCode: mockTodoCode(l.id),
            name: l.name,
            openCount: mine.filter((i) => !i.done).length,
            doneCount: mine.filter((i) => i.done).length,
            editor: memberOf(s, groupId, l.editorId),
            updatedAt: l.updatedAt,
          };
        });
      return ok({ items: out });
    }
    if (rest.length === 1 && method === "POST") {
      const name = todoText(body?.name, "name");
      if (isResult(name)) return name;
      if (lists.filter((l) => l.groupId === groupId).length >= TODO_LIST_LIMIT) return err(400, "TODO_LIMIT_REACHED", "목록은 20개까지 만들 수 있어요");
      const now = nowIso();
      const row: TodoListRow = { id: nextId(), groupId, name, creatorId: userId, editorId: userId, createdAt: now, updatedAt: now };
      lists.push(row);
      return ok(todoListOut(s, row), 201);
    }
    const listId = parseId(rest[1]);
    if (listId === null) return err(400, "VALIDATION_FAILED", "listId 은(는) 양의 정수여야 해요");
    const list = lists.find((l) => l.id === listId && l.groupId === groupId);
    if (!list) return err(404, "NOT_FOUND", "할 일 목록을 찾을 수 없어요");
    if (rest.length === 2 && method === "PATCH") {
      const name = todoText(body?.name, "name");
      if (isResult(name)) return name;
      if (name !== list.name) {
        list.name = name;
        touch(list);
      }
      return ok(todoListOut(s, list));
    }
    if (rest.length === 2 && method === "DELETE") {
      s.todoLists = lists.filter((l) => l.id !== list.id);
      s.todoItems = items.filter((i) => i.listId !== list.id);
      return ok({ ok: true });
    }
    if (rest[2] === "items" && method === "POST") {
      const text = todoText(body?.text, "text");
      if (isResult(text)) return text;
      if (body?.done !== undefined && typeof body.done !== "boolean") return err(400, "VALIDATION_FAILED", "done 은 true/false 여야 해요");
      if (items.filter((i) => i.listId === list.id).length >= TODO_ITEM_LIMIT) return err(400, "TODO_LIMIT_REACHED", "항목은 300개까지 넣을 수 있어요");
      const now = nowIso();
      const done = body?.done === true;
      const row: TodoItemRow = {
        id: nextId(),
        listId: list.id,
        text,
        done,
        doneAt: done ? now : null,
        doneById: done ? userId : null,
        creatorId: userId,
        createdAt: now,
        updatedAt: now,
      };
      items.push(row);
      touch(list);
      return ok(todoItemOut(s, groupId, row), 201);
    }
    if (rest[2] === "items" && method === "DELETE") {
      if (query.get("done") !== "true") return err(400, "VALIDATION_FAILED", "완료 항목만 지울 수 있어요 (done=true)");
      const count = items.filter((i) => i.listId === list.id && i.done).length;
      s.todoItems = items.filter((i) => !(i.listId === list.id && i.done));
      if (count > 0) touch(list);
      return ok({ ok: true, count });
    }
    return null;
  }
  if (rest[0] === "todo-items" && rest.length === 2) {
    const itemId = parseId(rest[1]);
    if (itemId === null) return err(400, "VALIDATION_FAILED", "itemId 은(는) 양의 정수여야 해요");
    const item = items.find((i) => i.id === itemId && lists.some((l) => l.id === i.listId && l.groupId === groupId));
    if (!item) return err(404, "NOT_FOUND", "이미 삭제된 항목이에요");
    const list = lists.find((l) => l.id === item.listId)!;
    if (method === "PATCH") {
      let changed = false;
      if (body?.text !== undefined) {
        const text = todoText(body.text, "text");
        if (isResult(text)) return text;
        if (text !== item.text) {
          item.text = text;
          changed = true;
        }
      }
      if (body?.done !== undefined) {
        if (typeof body.done !== "boolean") return err(400, "VALIDATION_FAILED", "done 은 true/false 여야 해요");
        if (body.done !== item.done) {
          item.done = body.done;
          item.doneAt = body.done ? nowIso() : null;
          item.doneById = body.done ? userId : null;
          changed = true;
        }
      }
      if (changed) {
        item.updatedAt = nowIso();
        touch(list);
      }
      return ok(todoItemOut(s, groupId, item));
    }
    if (method === "DELETE") {
      s.todoItems = items.filter((i) => i.id !== item.id);
      touch(list);
      return ok({ ok: true });
    }
  }
  return null;
}

// (#276) 공개 코드로 할 일 목록 하나 GET /todo-lists/:code. 내 팀 목록이 아니거나 없으면 404
export function todoCodeRoute(req: AuthedReq): MockResult | null {
  const { s, method, seg, userId } = req;
  if (seg[0] === "todo-lists" && seg.length === 2 && method === "GET") {
    const code = seg[1].toLowerCase();
    const l = (s.todoLists ?? []).find((x) => mockTodoCode(x.id) === code);
    if (!l || !s.memberships.some((m) => m.groupId === l.groupId && m.userId === userId)) return err(404, "NOT_FOUND", "할 일 목록을 찾을 수 없어요");
    const mine = sortedTodoItems((s.todoItems ?? []).filter((i) => i.listId === l.id));
    return ok({ list: todoListOut(s, l), items: mine.map((i) => todoItemOut(s, l.groupId, i)) });
  }
  return null;
}

export function groupTodoRoutes(req: GroupReq): MockResult | null {
  const { s, method, query, body, userId, groupId, rest } = req;
  if (rest[0] === "todo-lists" || rest[0] === "todo-items") {
    const r = todoRoutes(s, groupId, userId, rest, method, query, body);
    if (r) return r;
  }
  return null;
}
