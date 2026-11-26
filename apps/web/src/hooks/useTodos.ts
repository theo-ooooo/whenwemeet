"use client";
// (#276) 할 일 목록 자원 훅 (api.md 2.11). 목록 화면의 조회와 목록 단위 변경, 항목 단위 변경
import { useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import type { TodoItem, TodoList, TodoListDetail, TodoListSummary } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";
import { useQuery, type QueryOptions } from "./_useQuery";

/** 목록 화면, 홈 구역 GET /groups/:id/todo-lists (updatedAt 내림차순) */
export function useTodoLists(groupId: number, opts?: QueryOptions<{ items: TodoListSummary[] }>) {
  return useQuery<{ items: TodoListSummary[] }>(`/groups/${groupId}/todo-lists`, opts);
}

/** 목록 하나와 항목 GET /todo-lists/:code. 없거나 내 팀 목록이 아니면 404 */
export function useTodoList(code: string, opts?: QueryOptions<TodoListDetail>) {
  return useQuery<TodoListDetail>(`/todo-lists/${code}`, opts);
}

/** 앱이 다시 앞으로 올 때(visibilitychange) 다시 불러온다. 실시간 동기화 대신 (기획 4장) */
export function useRefetchOnVisible(refetch: () => Promise<void> | void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetch, enabled]);
}

/** 목록 만들기 POST /groups/:id/todo-lists */
export function useCreateTodoList(groupId: number, opts?: MutationOptions) {
  const fn = useCallback((name: string) => api<TodoList>(`/groups/${groupId}/todo-lists`, { method: "POST", body: { name } }), [groupId]);
  return useMutation(fn, opts);
}

/** 이름 바꾸기 PATCH /groups/:id/todo-lists/:listId */
export function useRenameTodoList(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ listId, name }: { listId: number; name: string }) => api<TodoList>(`/groups/${groupId}/todo-lists/${listId}`, { method: "PATCH", body: { name } }),
    [groupId],
  );
  return useMutation(fn, opts);
}

/** 목록 삭제 DELETE /groups/:id/todo-lists/:listId (항목 Cascade) */
export function useDeleteTodoList(groupId: number, opts?: MutationOptions) {
  const fn = useCallback((listId: number) => api<{ ok: true }>(`/groups/${groupId}/todo-lists/${listId}`, { method: "DELETE" }), [groupId]);
  return useMutation(fn, opts);
}

/** 항목 추가 POST /groups/:id/todo-lists/:listId/items. done 은 삭제 되돌리기에서만 */
export function useCreateTodoItem(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ listId, text, done }: { listId: number; text: string; done?: boolean }) =>
      api<TodoItem>(`/groups/${groupId}/todo-lists/${listId}/items`, { method: "POST", body: done ? { text, done } : { text } }),
    [groupId],
  );
  return useMutation(fn, opts);
}

/** 항목 고치기 PATCH /groups/:id/todo-items/:itemId (글, 완료) */
export function useUpdateTodoItem(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ itemId, text, done }: { itemId: number; text?: string; done?: boolean }) =>
      api<TodoItem>(`/groups/${groupId}/todo-items/${itemId}`, {
        method: "PATCH",
        body: { ...(text !== undefined ? { text } : {}), ...(done !== undefined ? { done } : {}) },
      }),
    [groupId],
  );
  return useMutation(fn, opts);
}

/** 항목 삭제 DELETE /groups/:id/todo-items/:itemId */
export function useDeleteTodoItem(groupId: number, opts?: MutationOptions) {
  const fn = useCallback((itemId: number) => api<{ ok: true }>(`/groups/${groupId}/todo-items/${itemId}`, { method: "DELETE" }), [groupId]);
  return useMutation(fn, opts);
}

/** 완료 항목 지우기 DELETE /groups/:id/todo-lists/:listId/items?done=true */
export function useClearDoneTodoItems(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    (listId: number) => api<{ ok: true; count: number }>(`/groups/${groupId}/todo-lists/${listId}/items?done=true`, { method: "DELETE" }),
    [groupId],
  );
  return useMutation(fn, opts);
}
