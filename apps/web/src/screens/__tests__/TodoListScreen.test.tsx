// @vitest-environment happy-dom
// (#378) 할 일 목록 상세: 머리줄 ‹ + ⋯(이름 바꾸기, 완료 항목 지우기, 목록 지우기는 확인 뒤), 항목마다 ✕ 대신 밀어서 지우기(되돌리기 토스트),
// "항목 추가" 는 목록 맨 아래 줄(엔터로 계속 추가)
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoItem } from "@/lib/types";

const show = vi.fn();
const push = vi.fn();
const editor = {
  list: { id: 1, groupId: 2, name: "장보기", publicCode: "todo1xxx" },
  items: [] as TodoItem[],
  error: null,
  refetch: vi.fn(),
  add: vi.fn(),
  toggle: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  clearDone: vi.fn(),
  rename: vi.fn(),
  deleteList: vi.fn(),
  renaming: false,
  clearing: false,
  deleting: false,
};

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, back: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ show }) }));
vi.mock("@/components/AppShell", () => ({ useGroupContext: () => ({ groupId: 2, group: { me: { userId: 1 } } }) }));
vi.mock("@/hooks", () => ({
  messageOf: (_e: unknown, fallback: string) => fallback,
  isPendingItem: (item: { id: number }) => item.id < 0,
  useTodoListEditor: () => editor,
}));

const { TodoListScreen } = await import("../TodoListScreen");

const who = { userId: 1, displayName: "지우", color: "#F26D6D", profileImageUrl: null };
const item = (id: number, text: string, done = false): TodoItem => ({
  id,
  listId: 1,
  text,
  done,
  doneAt: done ? "2026-11-12T01:00:00.000Z" : null,
  doneBy: done ? who : null,
  creator: who,
  createdAt: "2026-11-10T00:00:00.000Z",
  updatedAt: "2026-11-10T00:00:00.000Z",
});
const ok = <T,>(data: T) => ({ ok: true, data, error: null });

/** 항목 줄의 밀리는 면 (체크 버튼의 부모) */
const rowSurface = (text: string) => screen.getByRole("button", { name: `장보기, ${text}, 완료 안 됨` }).parentElement as HTMLElement;
function swipe(el: HTMLElement, dx: number) {
  fireEvent.pointerDown(el, { pointerType: "touch", pointerId: 1, clientX: 300, clientY: 20 });
  fireEvent.pointerMove(el, { pointerType: "touch", pointerId: 1, clientX: 300 + dx / 2, clientY: 21 });
  fireEvent.pointerMove(el, { pointerType: "touch", pointerId: 1, clientX: 300 + dx, clientY: 21 });
  fireEvent.pointerUp(el, { pointerType: "touch", pointerId: 1, clientX: 300 + dx, clientY: 21 });
}

describe("TodoListScreen (#378)", () => {
  beforeEach(() => {
    editor.items = [item(1, "우유 2개"), item(2, "계란 한 판"), item(3, "대파", true)];
    for (const f of [show, push, editor.add, editor.toggle, editor.remove, editor.restore, editor.clearDone, editor.deleteList]) f.mockReset();
  });
  afterEach(cleanup);

  it("머리줄은 ‹(할 일 목록으로) + 목록 이름 + 남은 개수, 항목마다 늘 보이는 색 점이 없다", () => {
    render(<TodoListScreen code="todo1xxx" />);
    expect(screen.getByRole("heading", { level: 1, name: "장보기" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "할 일 목록으로" }).getAttribute("href")).toBe("/todos");
    expect(screen.getByText("남은 2개")).toBeTruthy();
    expect(document.body.textContent).not.toContain("님이 추가");
  });

  it("항목 추가는 남은 할 일 목록의 마지막 줄. 엔터로 넣고 칸을 비운 채 포커스를 둔다", async () => {
    editor.add.mockResolvedValue(ok(item(9, "식빵")));
    render(<TodoListScreen code="todo1xxx" />);
    const list = screen.getByRole("list", { name: "남은 할 일" });
    const input = within(list).getByRole("textbox", { name: "항목 추가" });
    expect(within(list).getAllByRole("listitem").at(-1)?.contains(input)).toBe(true);
    fireEvent.change(input, { target: { value: "식빵" } });
    await act(async () => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    });
    expect(editor.add).toHaveBeenCalledWith("식빵");
    expect((input as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("끝까지(절반 넘게) 밀면 지우고 '되돌리기' 토스트, 되돌리기는 restore", async () => {
    editor.remove.mockResolvedValue(ok(null));
    editor.restore.mockResolvedValue(ok(null));
    render(<TodoListScreen code="todo1xxx" />);
    await act(async () => {
      swipe(rowSurface("우유 2개"), -240);
    });
    expect(editor.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(editor.toggle).not.toHaveBeenCalled();
    const [text, opts] = show.mock.calls[0];
    expect(text).toContain("우유 2개");
    expect(opts.actionLabel).toBe("되돌리기");
    await act(async () => {
      await opts.onAction();
    });
    expect(editor.restore).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("조금 밀면 뒤의 '삭제' 를 꺼내 두고, 줄을 누르면 체크하지 않고 닫는다. 꺼낸 '삭제' 를 누르면 지운다", async () => {
    editor.remove.mockResolvedValue(ok(null));
    render(<TodoListScreen code="todo1xxx" />);
    const surface = rowSurface("계란 한 판");
    await act(async () => {
      swipe(surface, -60);
    });
    expect(surface.style.transform).toBe("translateX(-76px)");
    expect(editor.remove).not.toHaveBeenCalled();
    // 손을 뗀 직후의 click 은 밀기의 끝이라 막고, 그다음 탭부터 줄로 받는다
    await act(() => new Promise((r) => setTimeout(r, 0)));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "장보기, 계란 한 판, 완료 안 됨" }));
    });
    expect(editor.toggle).not.toHaveBeenCalled();
    expect(surface.style.transform).toBe("");
    await act(async () => {
      swipe(surface, -60);
    });
    const deletes = screen.getAllByRole("button", { name: "계란 한 판 삭제" });
    await act(async () => {
      fireEvent.click(deletes.at(-1) as HTMLElement);
    });
    expect(editor.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it("세로로 움직이면 스크롤로 보고 줄을 밀지 않는다", async () => {
    render(<TodoListScreen code="todo1xxx" />);
    const surface = rowSurface("우유 2개");
    fireEvent.pointerDown(surface, { pointerType: "touch", pointerId: 1, clientX: 300, clientY: 20 });
    fireEvent.pointerMove(surface, { pointerType: "touch", pointerId: 1, clientX: 290, clientY: 80 });
    fireEvent.pointerMove(surface, { pointerType: "touch", pointerId: 1, clientX: 100, clientY: 90 });
    fireEvent.pointerUp(surface, { pointerType: "touch", pointerId: 1, clientX: 100, clientY: 90 });
    expect(surface.style.transform).toBe("");
    expect(editor.remove).not.toHaveBeenCalled();
  });

  it("⋯ 메뉴: 목록 지우기는 확인 창 뒤에만 지우고 목록 화면으로", async () => {
    editor.deleteList.mockResolvedValue(ok(null));
    render(<TodoListScreen code="todo1xxx" />);
    fireEvent.click(screen.getByRole("button", { name: "목록 메뉴" }));
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["이름 바꾸기", "완료 항목 지우기 (1)", "목록 지우기"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "목록 지우기" }));
    expect(editor.deleteList).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    });
    expect(editor.deleteList).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/todos");
  });
});
