// @vitest-environment happy-dom
// (#378) 빠른 추가: 일정 폼과 같은 카드, 줄 모양. 제목 큰 칸, 종일 토글 줄, 시간 칩 둘, 알림 줄(카드 안에 펼침),
// "알림은 앱에서 받을 수 있어요" 는 폼 본문에 없고 알림 목록을 펼쳤을 때만(웹), 버튼 "자세히 | 추가". 보내는 본문은 예전과 같다
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/push", () => ({ maybeOpenPushPrompt: vi.fn() }));
vi.mock("@/hooks", async () => ({
  messageOf: (_e: unknown, f: string) => f,
  useCreateEvent: () => ({ mutate, isPending: false, error: null }),
  useEventDraft: (await vi.importActual<typeof import("@/hooks/useEventDraft")>("@/hooks/useEventDraft")).useEventDraft,
}));

const { QuickAddForm } = await import("../QuickAdd");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  const onSaved = vi.fn();
  render(<QuickAddForm groupId={2} date="2030-11-20" titleId="t" onClose={vi.fn()} onBack={vi.fn()} onSaved={onSaved} />);
  return { onSaved };
}

describe("QuickAddForm (#378)", () => {
  it("제목 큰 칸, 종일 토글 줄, 시간 칩, 알림 줄. 안내 문장은 본문에 없다. 버튼은 자세히 | 추가", () => {
    setup();
    expect(screen.getByRole("heading", { name: "20일 수요일에 추가" })).toBeTruthy();
    expect((screen.getByLabelText("제목") as HTMLInputElement).placeholder).toBe("무슨 일정인가요?");
    expect(screen.getByRole("switch", { name: "종일" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("button", { name: "시작 시각, 오전 10:00" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "종료 시각, 오전 11:00" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^알림/ }).textContent).toContain("없음");
    expect(screen.queryByText("알림은 앱에서 받을 수 있어요")).toBeNull();
    expect(screen.getByRole("button", { name: "자세히" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "추가" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
  });

  it("알림 줄을 누르면 카드 안에 목록과 웹 안내 한 줄, 고르면 접힌다. 종일이면 시간 칩이 사라진다", () => {
    setup();
    const row = screen.getByRole("button", { name: /^알림/ });
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("알림은 앱에서 받을 수 있어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "10분 전" }));
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(row.textContent).toContain("10분 전");
    fireEvent.click(screen.getByRole("switch", { name: "종일" }));
    expect(screen.queryByRole("button", { name: /^시작 시각/ })).toBeNull();
  });

  it("빈 제목이면 오류, 적고 추가하면 예전과 같은 본문", async () => {
    const { onSaved } = setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "추가" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("제목을 입력해 주세요");
    expect(mutate).not.toHaveBeenCalled();
    mutate.mockResolvedValue({ ok: true, data: { id: 1 } });
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: " 저녁 " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "추가" }));
    });
    expect(mutate).toHaveBeenCalledWith({ title: "저녁", startsAt: "2030-11-20T01:00:00.000Z", endsAt: "2030-11-20T02:00:00.000Z", allDay: false });
    expect(onSaved).toHaveBeenCalledWith({ id: 1 });
  });

  it("자세히는 값을 새 일정 폼 주소로 넘긴다", () => {
    setup();
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "영화" } });
    fireEvent.click(screen.getByRole("button", { name: "자세히" }));
    expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/events\/new\?.*title=%EC%98%81%ED%99%94/));
  });
});
