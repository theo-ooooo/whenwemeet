"use client";
// (#276) 목록 상세 화면의 데이터 창구. 조회 + 낙관적 반영 + 실패 시 되돌리기 + 삭제 되돌리기(같은 글과 완료 상태로 다시 POST).
// 토스트 같은 화면 반응은 화면이 결과(MutationOutcome)를 보고 정한다. 다른 멤버가 지운 항목(404)은 여기서 다시 불러온다
import { useCallback, useMemo, useRef } from "react";
import { sortTodoItems, toggledItem } from "@/lib/todo";
import type { Member, TodoItem, TodoList, TodoListDetail } from "@/lib/types";
import type { MutationOutcome } from "./_useMutation";
import {
  useClearDoneTodoItems,
  useCreateTodoItem,
  useDeleteTodoItem,
  useDeleteTodoList,
  useRefetchOnVisible,
  useRenameTodoList,
  useTodoList,
  useUpdateTodoItem,
} from "./useTodos";

/** 저장 전 항목은 음수 id (체크, 수정, 삭제를 막는다) */
export const isPendingItem = (item: Pick<TodoItem, "id">) => item.id < 0;

export function useTodoListEditor(groupId: number, code: string, me: Member | null, initial?: TodoListDetail | null) {
  // 서버가 팀을 찾느라 이미 받은 목록이 있으면 스켈레톤 없이 시작하고 뒤에서 다시 받는다
  const q = useTodoList(code, { initialData: initial ?? null });
  const { data, setData, refetch } = q;
  useRefetchOnVisible(refetch);
  const createItem = useCreateTodoItem(groupId);
  const updateItem = useUpdateTodoItem(groupId);
  const deleteItem = useDeleteTodoItem(groupId);
  const clearDoneM = useClearDoneTodoItems(groupId);
  const renameM = useRenameTodoList(groupId);
  const deleteListM = useDeleteTodoList(groupId);
  const tempId = useRef(0);

  const items = useMemo(() => (data ? sortTodoItems(data.items) : null), [data]);
  const list = data?.list ?? null;

  const patchItems = useCallback(
    (fn: (items: TodoItem[]) => TodoItem[]) => setData((prev: TodoListDetail | null) => (prev ? { ...prev, items: fn(prev.items) } : prev)),
    [setData],
  );
  const replace = useCallback((id: number, next: TodoItem) => patchItems((xs) => xs.map((x) => (x.id === id ? next : x))), [patchItems]);
  const drop = useCallback((id: number) => patchItems((xs) => xs.filter((x) => x.id !== id)), [patchItems]);

  /** 다른 멤버가 먼저 지웠으면(404) 낙관적 반영을 되돌리지 않고 서버 상태로 다시 맞춘다 */
  const settleGone = useCallback(
    <T>(r: MutationOutcome<T>): MutationOutcome<T> => {
      if (!r.ok && r.error.status === 404) void refetch();
      return r;
    },
    [refetch],
  );

  /** 항목 추가. 저장 전 항목(음수 id)을 바로 보이고, 실패하면 뺀다 */
  const add = useCallback(
    async (text: string): Promise<MutationOutcome<TodoItem>> => {
      if (!list) throw new Error("목록을 받기 전에는 추가할 수 없어요");
      const now = new Date().toISOString();
      const id = -++tempId.current;
      const creator = me ?? { userId: null, displayName: "", color: "#9CA3AF", profileImageUrl: null };
      patchItems((xs) => [...xs, { id, listId: list.id, text, done: false, doneAt: null, doneBy: null, creator, createdAt: now, updatedAt: now }]);
      const r = await createItem.mutate({ listId: list.id, text });
      if (r.ok) replace(id, r.data);
      else drop(id);
      return settleGone(r);
    },
    [list, me, patchItems, createItem, replace, drop, settleGone],
  );

  /** 체크와 해제 */
  const toggle = useCallback(
    async (item: TodoItem): Promise<MutationOutcome<TodoItem>> => {
      replace(item.id, toggledItem(item, !item.done, me, new Date().toISOString()));
      const r = await updateItem.mutate({ itemId: item.id, done: !item.done });
      if (r.ok) replace(item.id, r.data);
      else if (r.error.status !== 404) replace(item.id, item);
      return settleGone(r);
    },
    [me, replace, updateItem, settleGone],
  );

  /** 글 수정 */
  const edit = useCallback(
    async (item: TodoItem, text: string): Promise<MutationOutcome<TodoItem>> => {
      replace(item.id, { ...item, text });
      const r = await updateItem.mutate({ itemId: item.id, text });
      if (r.ok) replace(item.id, r.data);
      else if (r.error.status !== 404) replace(item.id, item);
      return settleGone(r);
    },
    [replace, updateItem, settleGone],
  );

  /** 확인 없이 삭제. 화면은 성공하면 5초 되돌리기(restore)를 띄운다 */
  const remove = useCallback(
    async (item: TodoItem): Promise<MutationOutcome<{ ok: true }>> => {
      drop(item.id);
      const r = await deleteItem.mutate(item.id);
      if (!r.ok && r.error.status !== 404) patchItems((xs) => [...xs, item]);
      return settleGone(r);
    },
    [drop, deleteItem, patchItems, settleGone],
  );

  /** 삭제 되돌리기: 같은 글과 완료 상태로 다시 POST (기념일과 같은 방식, D-26) */
  const restore = useCallback(
    async (item: TodoItem): Promise<MutationOutcome<TodoItem>> => {
      const r = await createItem.mutate({ listId: item.listId, text: item.text, done: item.done });
      if (r.ok) patchItems((xs) => [...xs, r.data]);
      return settleGone(r);
    },
    [createItem, patchItems, settleGone],
  );

  /** 완료 항목 지우기 (화면이 먼저 확인을 받는다) */
  const clearDone = useCallback(async () => {
    if (!list) throw new Error("목록을 받기 전에는 지울 수 없어요");
    const r = await clearDoneM.mutate(list.id);
    if (r.ok) patchItems((xs) => xs.filter((x) => !x.done));
    return settleGone(r);
  }, [list, clearDoneM, patchItems, settleGone]);

  const rename = useCallback(
    async (name: string): Promise<MutationOutcome<TodoList>> => {
      if (!list) throw new Error("목록을 받기 전에는 바꿀 수 없어요");
      const r = await renameM.mutate({ listId: list.id, name });
      if (r.ok) setData((prev) => (prev ? { ...prev, list: r.data } : prev));
      return r;
    },
    [list, renameM, setData],
  );

  const deleteList = useCallback(async () => {
    if (!list) throw new Error("목록을 받기 전에는 지울 수 없어요");
    return deleteListM.mutate(list.id);
  }, [list, deleteListM]);

  return {
    list,
    items,
    error: q.error,
    refetch,
    add,
    toggle,
    edit,
    remove,
    restore,
    clearDone,
    rename,
    deleteList,
    renaming: renameM.isPending,
    clearing: clearDoneM.isPending,
    deleting: deleteListM.isPending,
  };
}
