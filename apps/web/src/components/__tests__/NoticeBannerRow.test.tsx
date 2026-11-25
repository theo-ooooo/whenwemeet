// @vitest-environment happy-dom
// (#538) 달력 위 "새 공지: 제목" 한 줄 (D-291): 누르면 상세(이 공지 띠 감춤), × 는 이 공지만 감추고 더 새 공지는 다시 보인다
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoticeAttention } from "@/lib/types";

let attention: NoticeAttention | null = null;
vi.mock("@/hooks", () => ({ useNoticeAttention: () => ({ data: attention, error: null, isLoading: false, refetch: vi.fn() }) }));

const { NoticeBannerRow } = await import("../NoticeBannerRow");
const banner = (id: number, title: string) => ({ id, title, kind: "notice" as const, publishedAt: "2026-11-25T00:00:00.000Z" });

describe("NoticeBannerRow (#538)", () => {
  beforeEach(() => {
    localStorage.clear();
    attention = { popup: null, banner: banner(4, "연말 일정 정리 기능") };
  });
  afterEach(cleanup);

  it("새 공지 제목과 상세 링크", () => {
    render(<NoticeBannerRow />);
    const link = screen.getByRole("link", { name: /새 공지\s*연말 일정 정리 기능/ });
    expect(link.getAttribute("href")).toBe("/notices/4?from=banner"); // (#544) 띠로 연 읽음
  });

  it("× 는 이 공지만 감춘다. 더 새 공지가 오면 다시 보인다", () => {
    const r = render(<NoticeBannerRow />);
    act(() => fireEvent.click(screen.getByRole("button", { name: "새 공지 닫기" })));
    expect(screen.queryByRole("link")).toBeNull();
    attention = { popup: null, banner: banner(5, "더 새 공지") };
    r.rerender(<NoticeBannerRow />);
    expect(screen.getByRole("link", { name: /더 새 공지/ })).toBeTruthy();
  });

  it("누르면 이 공지 띠를 감춘다, 띠가 없으면 그리지 않는다", () => {
    const r = render(<NoticeBannerRow />);
    fireEvent.click(screen.getByRole("link"));
    expect(localStorage.getItem("wwm.hint.notice.4")).toBe("1");
    attention = { popup: null, banner: null };
    r.rerender(<NoticeBannerRow />);
    expect(r.container.innerHTML).toBe("");
  });
});
