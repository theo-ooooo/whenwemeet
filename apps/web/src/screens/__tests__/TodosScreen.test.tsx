// @vitest-environment happy-dom
// (#378) 할 일 목록 추가 시트: 라벨 글자, 0/30 없이 이름 칸 하나, 버튼 "추가". 만들면 상세로
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const mutate = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/AppShell", () => ({ useGroupContext: () => ({ groupId: 2, setFabAction: vi.fn() }) }));
vi.mock("@/hooks", () => ({
  messageOf: (_e: unknown, f: string) => f,
  useTodoLists: () => ({ data: { items: [] }, error: null, refetch: vi.fn() }),
  useCreateTodoList: () => ({ mutate, isPending: false, error: null }),
  useRefetchOnVisible: () => undefined,
}));

const { TodosScreen } = await import("../TodosScreen");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TodosScreen 목록 추가 시트 (#378)", () => {
  it("이름 칸 하나와 '추가'. 글자 수는 80% 부터", async () => {
    render(<TodosScreen />);
    fireEvent.click(screen.getByRole("button", { name: "목록 추가" }));
    const dialog = screen.getByRole("dialog", { name: "목록 추가" });
    expect(dialog.textContent).not.toMatch(/\d+\/\d+/);
    const input = screen.getByLabelText("목록 이름") as HTMLInputElement;
    expect(input.placeholder).toBe("예: 장보기, 여행 준비물");
    const add = screen.getByRole("button", { name: "추가" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "만들기" })).toBeNull();
    fireEvent.change(input, { target: { value: "장보기" } });
    mutate.mockResolvedValue({ ok: true, data: { id: 3, publicCode: "todo3xxx", name: "장보기" } });
    await act(async () => {
      fireEvent.click(add);
    });
    expect(mutate).toHaveBeenCalledWith("장보기");
    expect(push).toHaveBeenCalledWith(expect.stringContaining("todo3xxx"));
  });
});
