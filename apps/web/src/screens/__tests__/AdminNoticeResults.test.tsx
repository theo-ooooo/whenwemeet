// @vitest-environment happy-dom
// (#544) 관리자 공지 결과 칸 (D-293): 숫자 칸 여섯, 읽은 사람 목록(경로 배지), 읽음 | 안 읽음 전환은 푸시를 보낸 공지만, 안 읽음에서는 경로 필터를 숨긴다
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoticeReader, NoticeStats } from "@/lib/types";

let stats: NoticeStats | null = null;
const readersCalls: { q: string; via: string | null; unread: boolean }[] = [];
let readers: NoticeReader[] = [];

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useAdminNoticeStats: () => ({ data: stats, error: null, isLoading: false, refetch: vi.fn() }),
  useAdminNoticeReaders: (_id: number, filter: { q: string; via: string | null; unread: boolean }) => {
    readersCalls.push(filter);
    return { items: readers, error: null, isLoading: false, hasMore: false, loadingMore: false, loadMore: vi.fn(), refetch: vi.fn(), setItems: vi.fn() };
  },
}));

const { AdminNoticeResults } = await import("../admin/AdminNoticeResults");

const pushed: NoticeStats = {
  noticeId: 1,
  publishedAt: "2026-11-22T00:00:00.000Z",
  pushedAt: "2026-11-22T00:00:00.000Z",
  push: { status: "DISPATCHED", dispatchedAt: "2026-11-22T00:00:10.000Z", targetUsers: 5, devices: 5, sent: 4, delivered: 3, failed: 2, pending: 0 },
  reads: { total: 4, byVia: { list: 1, detail: 1, push: 1, popup: 0, banner: 1 }, pushOpened: 1 },
  readRate: 0.6,
  readRateBasis: { of: "push", read: 3, total: 5 },
};

describe("AdminNoticeResults (#544)", () => {
  beforeEach(() => {
    stats = pushed;
    readers = [{ id: 3, nickname: "엄마", profileImageUrl: null, firstReadAt: "2026-11-22T01:00:00.000Z", via: "push" }];
    readersCalls.length = 0;
  });
  afterEach(cleanup);

  it("숫자 칸과 읽은 사람(이름, 시각, 경로 배지)", () => {
    render(<AdminNoticeResults id={1} />);
    for (const label of ["푸시 대상", "전달 성공", "실패", "읽음", "푸시로 연 사람", "읽은 비율"]) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText("푸시 대상 5명 중 3명")).toBeTruthy();
    expect(screen.getByRole("link", { name: "엄마" }).getAttribute("href")).toBe("/admin/users/3");
    expect(screen.getByText("2026.11.22 10:00")).toBeTruthy();
    expect(screen.getByText("푸시", { selector: "span" })).toBeTruthy();
  });

  it("안 읽음으로 바꾸면 unread 로 다시 묻고 경로 필터를 숨긴다. 경로를 고르면 via 로 묻는다", () => {
    render(<AdminNoticeResults id={1} />);
    fireEvent.change(screen.getByLabelText("경로"), { target: { value: "popup" } });
    expect(readersCalls.at(-1)).toEqual({ q: "", via: "popup", unread: false });
    fireEvent.click(screen.getByRole("radio", { name: "안 읽음 2" }));
    expect(readersCalls.at(-1)).toMatchObject({ unread: true });
    expect(screen.queryByLabelText("경로")).toBeNull();
    expect(screen.getByText("안 읽은 사람 (푸시 대상)")).toBeTruthy();
  });

  it("푸시를 보내지 않은 공지: 안 읽음 전환이 없고 안내 문구, 빈 목록 문구", () => {
    stats = { ...pushed, pushedAt: null, push: null, readRate: 0.25, readRateBasis: { of: "users", read: 4, total: 16 } };
    readers = [];
    render(<AdminNoticeResults id={1} />);
    expect(screen.queryByRole("radio", { name: /안 읽음/ })).toBeNull();
    expect(screen.getByText(/푸시를 보내지 않은 공지예요/)).toBeTruthy();
    expect(screen.getByText("아직 읽은 사람이 없어요")).toBeTruthy();
  });
});
