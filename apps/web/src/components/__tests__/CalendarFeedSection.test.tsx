// @vitest-environment happy-dom
// (#193) 팀 설정 "다른 캘린더 앱에서 보기": 꺼짐 → 고지 시트 → 만들기, 켜짐 버튼과 토글, 메모 켤 때 확인, 다시 만들기, 연결 끊기.
// 화면 문구에 "구독" 이 없어야 한다 (유료 구독으로 읽힘)
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarFeed } from "@/lib/types";

type Outcome<T> = { ok: true; data: T; error: null } | { ok: false; data: null; error: { message?: string } };
const save = vi.fn<(input: Record<string, boolean>) => Promise<Outcome<CalendarFeed>>>();
const rotate = vi.fn<() => Promise<Outcome<CalendarFeed>>>();
const remove = vi.fn<() => Promise<Outcome<{ ok: true }>>>();
const show = vi.fn();
let data: CalendarFeed | null;
let loading = false;
const setData = vi.fn((next: CalendarFeed | null | ((p: CalendarFeed | null) => CalendarFeed | null)) => {
  data = typeof next === "function" ? next(data) : next;
});

vi.mock("@/components/Toast", () => ({ useToast: () => ({ show }) }));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useCalendarFeed: () => ({ data, error: null, isLoading: loading, refetch: vi.fn(), setData }),
  useSaveCalendarFeed: () => ({ mutate: save, isPending: false, error: null }),
  useRotateCalendarFeed: () => ({ mutate: rotate, isPending: false, error: null }),
  useDeleteCalendarFeed: () => ({ mutate: remove, isPending: false, error: null }),
}));

const { CalendarFeedSection } = await import("../CalendarFeedSection");

const TOKEN = "T".repeat(43);
const FEED: CalendarFeed = {
  httpsUrl: `https://api.whenwemeet.day/v1/ics/${TOKEN}.ics`,
  webcalUrl: `webcal://api.whenwemeet.day/v1/ics/${TOKEN}.ics`,
  googleAddUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`webcal://api.whenwemeet.day/v1/ics/${TOKEN}.ics`)}`,
  includeMemo: false,
  includeAnniversaries: true,
  createdAt: "2026-11-13T00:00:00.000Z",
  lastFetchedAt: null,
};
const ok = <T,>(d: T): Outcome<T> => ({ ok: true, data: d, error: null });

function setUa(ua: string) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

describe("CalendarFeedSection (#193)", () => {
  beforeEach(() => {
    data = null;
    loading = false;
    save.mockReset();
    rotate.mockReset();
    remove.mockReset();
    show.mockReset();
    setData.mockClear();
    setUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36");
  });
  afterEach(cleanup);

  it("꺼짐: 제목, 설명, 팀원 누구나 만들 수 있다는 고지, 만들기 버튼. 누르면 고지 시트를 먼저 보이고, 만들기에서 PUT {}", async () => {
    save.mockResolvedValue(ok(FEED));
    render(<CalendarFeedSection groupId={1} personal={false} />);
    expect(screen.getByRole("heading", { name: "다른 캘린더 앱에서 보기" })).toBeTruthy();
    expect(screen.getByText("구글 캘린더, 아이폰 캘린더에 이 팀 일정이 보여요. 보기만 되고, 고치는 건 언제볼까에서 해요.")).toBeTruthy();
    expect(screen.getByText("팀원 누구나 자기 연결 주소를 만들 수 있어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "연결 주소 만들기" }));
    expect(save).not.toHaveBeenCalled();
    const sheet = screen.getByRole("dialog", { name: "연결 주소를 만들까요?" });
    expect(sheet.textContent).toContain("제목, 시간, 참여자 이름을 볼 수 있어요");
    expect(sheet.textContent).toContain("메모는 나가지 않아요");
    expect(sheet.textContent).toContain("몇 시간 걸릴 수 있어요");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "만들기" }));
    });
    expect(save).toHaveBeenCalledWith({});
    expect(setData).toHaveBeenLastCalledWith(FEED);
  });

  it("켜짐(윈도우): 아이폰 버튼 없음, 구글은 붙여 넣기 안내, 복사는 https 주소, 아직 가져가지 않았어요", async () => {
    data = FEED;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CalendarFeedSection groupId={1} personal={false} />);
    expect(screen.queryByRole("link", { name: "아이폰 캘린더에 추가" })).toBeNull();
    expect(screen.getByText("구글 캘린더 > 다른 캘린더 + > URL로 추가에 붙여 넣으세요")).toBeTruthy();
    expect(screen.queryByText("구글 캘린더는 컴퓨터에서만 추가할 수 있어요")).toBeNull();
    expect(screen.getByText("아직 가져가지 않았어요")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "주소 복사" }));
    });
    expect(writeText).toHaveBeenCalledWith(FEED.httpsUrl);
    expect(show).toHaveBeenCalledWith("연결 주소를 복사했어요");
  });

  it("켜짐(iPhone): 아이폰 캘린더는 webcal 링크, 구글은 컴퓨터에서만 안내", () => {
    setUa("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1");
    data = FEED;
    render(<CalendarFeedSection groupId={1} personal={false} />);
    expect(screen.getByRole("link", { name: "아이폰 캘린더에 추가" }).getAttribute("href")).toBe(FEED.webcalUrl);
    expect(screen.getByText("구글 캘린더는 컴퓨터에서만 추가할 수 있어요")).toBeTruthy();
  });

  it("메모 포함은 켤 때 확인 한 번 뒤 PUT, 기념일은 바로 PUT", async () => {
    data = FEED;
    save.mockImplementation(async (input) => ok({ ...FEED, ...input }));
    render(<CalendarFeedSection groupId={1} personal={false} />);
    fireEvent.click(screen.getByRole("switch", { name: /^메모 포함/ }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "메모도 보이게 할까요?" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "메모 포함" }).at(-1)!);
    });
    expect(save).toHaveBeenCalledWith({ includeMemo: true });
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /^기념일 포함/ }));
    });
    expect(save).toHaveBeenLastCalledWith({ includeAnniversaries: false });
  });

  it("토글 저장이 실패하면 되돌리고 토스트", async () => {
    data = FEED;
    save.mockResolvedValue({ ok: false, data: null, error: { message: "" } });
    render(<CalendarFeedSection groupId={1} personal={false} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /^기념일 포함/ }));
    });
    expect(setData).toHaveBeenLastCalledWith(FEED);
    expect(show).toHaveBeenCalledWith("저장하지 못했어요. 다시 시도해 주세요");
  });

  it("주소 다시 만들기: 확인 뒤 POST rotate, 새 주소로 바꾸고 토스트", async () => {
    data = { ...FEED, lastFetchedAt: new Date(Date.now() - 3 * 3600_000).toISOString() };
    const next = { ...FEED, httpsUrl: FEED.httpsUrl.replace(TOKEN, "N".repeat(43)) };
    rotate.mockResolvedValue(ok(next));
    render(<CalendarFeedSection groupId={1} personal={false} />);
    expect(screen.getByText("마지막으로 가져간 시간: 3시간 전")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "주소 다시 만들기" }));
    expect(screen.getByRole("alertdialog", { name: "주소를 다시 만들까요?" }).textContent).toContain("지금 주소는 바로 끊겨요");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다시 만들기" }));
    });
    expect(rotate).toHaveBeenCalled();
    expect(setData).toHaveBeenLastCalledWith(next);
    expect(show).toHaveBeenCalledWith("새 연결 주소를 만들었어요");
  });

  it("끄기: 확인 뒤 DELETE, 꺼진 상태로", async () => {
    data = FEED;
    remove.mockResolvedValue(ok({ ok: true }));
    render(<CalendarFeedSection groupId={1} personal={false} />);
    fireEvent.click(screen.getByRole("button", { name: "연결 끊기" }));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "연결 끊기" }).at(-1)!);
    });
    expect(remove).toHaveBeenCalled();
    expect(setData).toHaveBeenLastCalledWith(null);
    expect(show).toHaveBeenCalledWith("연결을 끊었어요");
  });

  it("개인 달력은 '내 일정' 문구", () => {
    render(<CalendarFeedSection groupId={1} personal />);
    expect(screen.getByText("구글 캘린더, 아이폰 캘린더에 내 일정이 보여요. 보기만 되고, 고치는 건 언제볼까에서 해요.")).toBeTruthy();
    expect(screen.queryByText("팀원 누구나 자기 연결 주소를 만들 수 있어요")).toBeNull();
  });

  it("꺼짐, 고지 시트, 켜짐, 확인 창 어디에도 '구독' 이 없다", () => {
    const { unmount } = render(<CalendarFeedSection groupId={1} personal={false} />);
    fireEvent.click(screen.getByRole("button", { name: "연결 주소 만들기" }));
    expect(document.body.textContent).not.toContain("구독");
    unmount();
    data = FEED;
    setUa("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1");
    render(<CalendarFeedSection groupId={1} personal={false} />);
    expect(document.body.textContent).not.toContain("구독");
    for (const name of ["주소 다시 만들기", "연결 끊기"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(document.body.textContent).not.toContain("구독");
      fireEvent.click(screen.getByRole("button", { name: "취소" }));
    }
    fireEvent.click(screen.getByRole("switch", { name: /^메모 포함/ }));
    expect(document.body.textContent).not.toContain("구독");
  });
});
