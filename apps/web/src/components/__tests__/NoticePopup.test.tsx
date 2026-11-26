// @vitest-environment happy-dom
// (#538) 중요 공지 팝업 (D-291): 잠깐 뒤 한 번 뜨고, [닫기]/Esc 와 [자세히 보기] 는 닫은 기록을 남기며 같은 공지의 띠도 감춘다.
// 막는 창(이용 제한 팀, 꼭 업데이트)이 있거나 알림 안내가 떠 있으면 기다린다
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoticeAttention } from "@/lib/types";

const dismiss = vi.fn<(id: number) => Promise<unknown>>();
const push = vi.fn<(href: string) => void>();
let attention: NoticeAttention | null = null;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/hooks", () => ({
  useNoticeAttention: () => ({ data: attention, error: null, isLoading: false, refetch: vi.fn() }),
  useDismissNotice: () => ({ mutate: dismiss, isPending: false, error: null }),
}));

const { NoticePopup } = await import("../NoticePopup");
const { setPromptOpen } = await import("@/lib/push");

const popup = {
  id: 2,
  title: "11월 30일 새벽 서버 점검 안내",
  kind: "maintenance" as const,
  publishedAt: "2026-11-25T00:00:00.000Z",
  preview: "새벽 2시부터 점검해요.",
};

function renderPopup(blocked = false) {
  const r = render(<NoticePopup blocked={blocked} />);
  act(() => {
    vi.advanceTimersByTime(1300);
  });
  return r;
}

describe("NoticePopup (#538)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    attention = { popup, banner: null };
    dismiss.mockReset().mockResolvedValue({ ok: true });
    push.mockReset();
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    setPromptOpen(false);
  });

  it("잠깐 뒤에 종류, 제목, 첫 문단을 띄운다", () => {
    render(<NoticePopup blocked={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    expect(screen.getByRole("dialog", { name: popup.title })).toBeTruthy();
    expect(screen.getByText("점검")).toBeTruthy();
    expect(screen.getByText(popup.preview)).toBeTruthy();
  });

  it("[닫기] 는 닫은 기록을 남기고 같은 공지의 띠를 감춘다. 다시 그려도 이 화면에서는 안 뜬다", () => {
    renderPopup();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(dismiss).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("wwm.hint.notice.2")).toBe("1");
    expect(push).not.toHaveBeenCalled();
  });

  it("Esc 도 닫기와 같다", () => {
    renderPopup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dismiss).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("[자세히 보기] 는 닫은 기록을 남기고 상세로 간다", () => {
    renderPopup();
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기" }));
    expect(dismiss).toHaveBeenCalledWith(2);
    expect(push).toHaveBeenCalledWith("/notices/2?from=popup"); // (#544) 팝업으로 연 읽음
  });

  it("막는 창이 있거나 알림 안내가 떠 있으면 기다렸다가, 닫히면 뜬다", () => {
    const r = renderPopup(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => setPromptOpen(true));
    r.rerender(<NoticePopup blocked={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => setPromptOpen(false));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("팝업이 없으면 아무것도 그리지 않는다", () => {
    attention = { popup: null, banner: { id: 1, title: "t", kind: "notice", publishedAt: popup.publishedAt } };
    renderPopup();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
