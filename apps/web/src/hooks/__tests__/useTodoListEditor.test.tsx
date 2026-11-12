// @vitest-environment happy-dom
// (#276) 목록 상세 훅: 낙관적 반영, 실패 시 되돌리기, 다른 멤버가 지운 항목(404)은 다시 불러오기, 삭제 되돌리기(같은 글 + 완료 상태로 다시 POST)
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Member, TodoItem, TodoListDetail } from "@/lib/types";

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiError }));

const { useTodoListEditor } = await import("../useTodoListEditor");

const me: Member = { userId: 1, displayName: "지우", color: "#F26D6D", profileImageUrl: null };
const item = (over: Partial<TodoItem>): TodoItem => ({
  id: 1,
  listId: 7,
  text: "우유",
  done: false,
  doneAt: null,
  doneBy: null,
  creator: me,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});
const detail = (items: TodoItem[]): TodoListDetail => ({
  list: { id: 7, publicCode: "list2345", groupId: 2, groupCode: "team2xxx", name: "장보기", creator: me, editor: me, createdAt: "", updatedAt: "" },
  items,
});

/** api 호출을 경로와 방법으로 나눠 답한다. 답을 주기 전까지 기다리는 약속도 만든다 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function setup(items: TodoItem[]) {
  api.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/todo-lists/list2345" && (init?.method ?? "GET") === "GET") return detail(items);
    throw new Error(`예상 못 한 호출 ${init?.method} ${path}`);
  });
  const hook = renderHook(() => useTodoListEditor(2, "list2345", me));
  await waitFor(() => expect(hook.result.current.items).not.toBeNull());
  return hook;
}

afterEach(() => {
  api.mockReset();
});

describe("useTodoListEditor", () => {
  it("추가: 저장 전 항목을 바로 보이고(음수 id), 성공하면 서버 항목으로 바꾼다", async () => {
    const hook = await setup([item({})]);
    const d = deferred<TodoItem>();
    api.mockImplementationOnce(() => d.promise);
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.result.current.add("빵");
    });
    expect(hook.result.current.items!.map((i) => i.text)).toEqual(["우유", "빵"]);
    expect(hook.result.current.items![1].id).toBeLessThan(0);
    expect(api).toHaveBeenLastCalledWith("/groups/2/todo-lists/7/items", { method: "POST", body: { text: "빵" } });
    await act(async () => {
      d.resolve(item({ id: 9, text: "빵", createdAt: "2026-11-02T00:00:00.000Z" }));
      await pending;
    });
    expect(hook.result.current.items!.map((i) => i.id)).toEqual([1, 9]);
  });

  it("추가 실패면 저장 전 항목을 뺀다", async () => {
    const hook = await setup([item({})]);
    api.mockRejectedValueOnce(new ApiError(400, "TODO_LIMIT_REACHED", "항목은 300개까지 넣을 수 있어요"));
    let r: Awaited<ReturnType<typeof hook.result.current.add>> | undefined;
    await act(async () => {
      r = await hook.result.current.add("빵");
    });
    expect(r).toMatchObject({ ok: false, error: { code: "TODO_LIMIT_REACHED", message: "항목은 300개까지 넣을 수 있어요" } });
    expect(hook.result.current.items!.map((i) => i.id)).toEqual([1]);
  });

  it("체크: 바로 완료 칸으로 옮기고(나, 지금), 실패하면 되돌린다", async () => {
    const hook = await setup([item({}), item({ id: 2, text: "빵", createdAt: "2026-11-02T00:00:00.000Z" })]);
    const d = deferred<TodoItem>();
    api.mockImplementationOnce(() => d.promise);
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.result.current.toggle(hook.result.current.items![0]);
    });
    expect(hook.result.current.items!.map((i) => [i.id, i.done])).toEqual([
      [2, false],
      [1, true],
    ]);
    expect(hook.result.current.items![1].doneBy).toEqual(me);
    expect(api).toHaveBeenLastCalledWith("/groups/2/todo-items/1", { method: "PATCH", body: { done: true } });
    await act(async () => {
      d.reject(new ApiError(500, "INTERNAL", "잠시 후 다시 시도해 주세요"));
      await pending;
    });
    expect(hook.result.current.items!.map((i) => [i.id, i.done])).toEqual([
      [1, false],
      [2, false],
    ]);
  });

  it("다른 멤버가 지운 항목(404)은 되돌리지 않고 다시 불러온다", async () => {
    const hook = await setup([item({}), item({ id: 2, text: "빵" })]);
    // 서버는 이제 빵만 있다 (다른 멤버가 우유를 지움)
    api.mockImplementation(async () => detail([item({ id: 2, text: "빵" })]));
    api.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "이미 삭제된 항목이에요"));
    const calls = api.mock.calls.length;
    await act(async () => {
      await hook.result.current.toggle(hook.result.current.items![0]);
    });
    await waitFor(() => expect(api.mock.calls.length).toBe(calls + 2));
    expect(api.mock.calls[calls + 1][0]).toBe("/todo-lists/list2345");
    await waitFor(() => expect(hook.result.current.items!.map((i) => i.id)).toEqual([2]));
  });

  it("삭제: 바로 빼고, 실패하면 돌려놓는다. 되돌리기는 같은 글과 완료 상태로 다시 POST", async () => {
    const done = item({ id: 3, text: "대파", done: true, doneAt: "2026-11-03T00:00:00.000Z", doneBy: me });
    const hook = await setup([item({}), done]);
    api.mockRejectedValueOnce(new ApiError(500, "INTERNAL", "x"));
    await act(async () => {
      await hook.result.current.remove(done);
    });
    expect(hook.result.current.items!.map((i) => i.id)).toEqual([1, 3]);

    api.mockResolvedValueOnce({ ok: true });
    await act(async () => {
      await hook.result.current.remove(done);
    });
    expect(hook.result.current.items!.map((i) => i.id)).toEqual([1]);
    expect(api).toHaveBeenLastCalledWith("/groups/2/todo-items/3", { method: "DELETE" });

    api.mockResolvedValueOnce({ ...done, id: 11 });
    await act(async () => {
      await hook.result.current.restore(done);
    });
    expect(api).toHaveBeenLastCalledWith("/groups/2/todo-lists/7/items", { method: "POST", body: { text: "대파", done: true } });
    expect(hook.result.current.items!.map((i) => i.id)).toEqual([1, 11]);
  });

  it("글 수정과 완료 지우기", async () => {
    const hook = await setup([item({}), item({ id: 3, done: true, doneAt: "2026-11-03T00:00:00.000Z", doneBy: me })]);
    api.mockResolvedValueOnce(item({ text: "두유" }));
    await act(async () => {
      await hook.result.current.edit(hook.result.current.items![0], "두유");
    });
    expect(api).toHaveBeenLastCalledWith("/groups/2/todo-items/1", { method: "PATCH", body: { text: "두유" } });
    expect(hook.result.current.items![0].text).toBe("두유");

    api.mockResolvedValueOnce({ ok: true, count: 1 });
    await act(async () => {
      await hook.result.current.clearDone();
    });
    expect(api).toHaveBeenLastCalledWith("/groups/2/todo-lists/7/items?done=true", { method: "DELETE" });
    expect(hook.result.current.items!.map((i) => i.id)).toEqual([1]);
  });

  it("앱이 다시 앞으로 오면 다시 불러온다", async () => {
    const hook = await setup([item({})]);
    api.mockImplementation(async () => detail([item({}), item({ id: 5, text: "새로 생김", createdAt: "2026-11-05T00:00:00.000Z" })]));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(hook.result.current.items!.map((i) => i.id)).toEqual([1, 5]));
  });
});
