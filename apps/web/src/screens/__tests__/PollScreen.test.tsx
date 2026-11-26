// @vitest-environment happy-dom
// (#189) 약속 투표 화면: 가능 켜기(전체 교체 본문), 정하기(만든 사람이 아니면 확인 창), 먼저 정해졌으면(409) 다시 받고 알림, 정한 뒤 "일정 보기"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Member, Poll } from "@/lib/types";

const push = vi.fn();
const show = vi.fn();
const vote = vi.fn();
const confirm = vi.fn();
const remove = vi.fn();
const refetch = vi.fn();
const eventsChanged = vi.fn();
let data: Poll | null;
const setData = vi.fn((next: Poll | null) => {
  data = next;
});
const member = (userId: number, displayName: string): Member => ({ userId, displayName, color: "#F26D6D", profileImageUrl: null });
const ME = member(2, "지훈");

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, back: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ show }) }));
vi.mock("@/components/AppShell", () => ({ useGroupContext: () => ({ groupId: 10, group: { me: ME }, eventsChanged }) }));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  usePoll: () => ({ data, error: null, isLoading: false, refetch, setData }),
  useRefetchOnVisible: () => {},
  useVotePoll: () => ({ mutate: vote, isPending: false, error: null }),
  useConfirmPoll: () => ({ mutate: confirm, isPending: false, error: null }),
  useDeletePoll: () => ({ mutate: remove, isPending: false, error: null }),
}));

const { PollScreen } = await import("../PollScreen");

const kst = (local: string) => new Date(`${local}+09:00`).toISOString();
const base = (over: Partial<Poll> = {}): Poll => ({
  id: 5,
  publicCode: "poll5xxx",
  groupId: 10,
  groupCode: "team10xx",
  title: "저녁 약속",
  status: "OPEN",
  deadline: null,
  expired: false,
  creator: member(1, "민지"),
  createdAt: kst("2026-11-13T10:00"),
  closedAt: null,
  eventId: null,
  eventCode: null,
  decidedOptionId: null,
  participants: { all: true, members: [member(1, "민지"), ME] },
  options: [
    { id: 11, startsAt: kst("2030-11-22T19:00"), endsAt: kst("2030-11-22T21:00"), allDay: false, past: false, voters: [member(1, "민지")] },
    { id: 12, startsAt: kst("2030-11-23T12:00"), endsAt: kst("2030-11-23T14:00"), allDay: false, past: false, voters: [] },
  ],
  myVotes: [],
  canVote: true,
  ...over,
});

describe("PollScreen (#189)", () => {
  beforeEach(() => {
    data = base();
    for (const fn of [push, show, vote, confirm, remove, refetch, eventsChanged, setData]) fn.mockClear();
  });
  afterEach(cleanup);

  it("가능을 켜면 내 표 전체로 저장하고, 표가 가장 많은 후보가 정할 시간으로 골라져 있다", async () => {
    vote.mockResolvedValue({ ok: true, data: base({ myVotes: [12] }), error: null });
    render(<PollScreen code="poll5xxx" />);
    expect(screen.getByText("가장 많아요")).toBeTruthy();
    expect(screen.getByRole("button", { name: "이 시간으로 정하기" })).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: /가능$/ });
    await act(async () => {
      fireEvent.click(buttons[1]);
    });
    expect(vote).toHaveBeenCalledWith({ pollId: 5, optionIds: [12] });
    expect(setData).toHaveBeenLastCalledWith(base({ myVotes: [12] }));
  });

  it("만든 사람이 아니면 확인 창을 거쳐 정하고, 일정으로 간다. BUSY_NOW 는 알림 문구", async () => {
    confirm.mockResolvedValue({
      ok: true,
      data: { poll: base({ status: "CLOSED" }), event: { publicCode: "evnt9xxx", occurrence: null }, warning: "BUSY_NOW" },
      error: null,
    });
    render(<PollScreen code="poll5xxx" />);
    fireEvent.click(screen.getByRole("button", { name: "이 시간으로 정하기" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "정하기" }));
    });
    expect(confirm).toHaveBeenCalledWith({ pollId: 5, optionId: 11 });
    expect(eventsChanged).toHaveBeenCalled();
    expect(show.mock.calls[0][0]).toContain("일정이 생긴 사람이 있어요");
    expect(push).toHaveBeenCalledWith("/events/evnt9xxx");
  });

  it("먼저 정해졌으면(409) 다시 불러오고 '이미 정해졌어요'", async () => {
    confirm.mockResolvedValue({ ok: false, data: null, error: { status: 409, code: "POLL_CLOSED", message: "이미 정해진 투표예요" } });
    data = base({ creator: ME });
    render(<PollScreen code="poll5xxx" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "이 시간으로 정하기" }));
    });
    expect(refetch).toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith("이미 정해졌어요");
  });

  it("대상이 아니면 가능 버튼이 없고, 정한 뒤에는 정한 시간과 일정 보기", () => {
    data = base({ canVote: false });
    render(<PollScreen code="poll5xxx" />);
    expect(screen.queryAllByRole("button", { name: /가능$/ })).toHaveLength(0);
    expect(screen.getByText(/결과만 볼 수 있어요/)).toBeTruthy();
    cleanup();
    data = base({ status: "CLOSED", decidedOptionId: 12, eventId: 9, eventCode: "evnt9xxx" });
    render(<PollScreen code="poll5xxx" />);
    expect(screen.getByRole("status").textContent).toContain("으로 정했어요");
    expect(screen.getByRole("link", { name: "일정 보기" }).getAttribute("href")).toBe("/events/evnt9xxx");
    expect(screen.queryByRole("button", { name: "투표 메뉴" })).toBeNull();
  });
});
