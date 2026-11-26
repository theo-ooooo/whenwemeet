// @vitest-environment happy-dom
// (#199) 일정 검색 화면: 빈 검색어 안내, 다가오는/지난 일정 묶음, 강조, 반복 표시, 모든 팀(팀 이름), 0건 문구, hasMore 안내, 주소 q
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventSearchItem, EventSearchResult } from "@/lib/types";

let params = new URLSearchParams();
let result: { data: EventSearchResult | null; error: { message: string } | null } = { data: null, error: null };
let groups = [{ id: 10 }, { id: 11 }];
const searched = vi.fn();

vi.mock("next/navigation", () => ({ useSearchParams: () => params, useRouter: () => ({ back: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/AppShell", () => ({ useGroupContext: () => ({ groupId: 10, groups }) }));
vi.mock("@/components/Participants", () => ({ useWho: () => ({ personal: false, meId: 1 }) }));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useEventSearch: (q: string, groupId: number | null) => {
    searched(q, groupId);
    return { ...result, isLoading: false, refetch: vi.fn(), setData: vi.fn() };
  },
  useAnniversaryItems: () => ({ data: [], error: null }),
  useEvents: () => ({ data: [], error: null }),
  usePlaceResolve: () => ({ data: null, error: null }),
}));

const { SearchScreen } = await import("../SearchScreen");

const M = { userId: 1, displayName: "지우", color: "#F26D6D", profileImageUrl: null };
const item = (
  id: number,
  title: string,
  upcoming: boolean,
  o: Partial<EventSearchItem["event"]> = {},
  group = { id: 10, name: "우리 집", publicCode: "grp00010" },
): EventSearchItem =>
  ({
    event: {
      id,
      groupId: group.id,
      publicCode: `evnt${String(id).padStart(4, "0")}`,
      title,
      startsAt: upcoming ? "2099-01-05T01:00:00.000Z" : "2025-05-01T01:00:00.000Z",
      endsAt: upcoming ? "2099-01-05T02:00:00.000Z" : "2025-05-01T02:00:00.000Z",
      allDay: false,
      memo: null,
      place: null,
      repeat: null,
      occurrence: null,
      creator: M,
      participants: { all: false, members: [M] },
      ...o,
    },
    group,
    matched: ["title"],
    upcoming,
  }) as EventSearchItem;

beforeEach(() => {
  params = new URLSearchParams();
  result = { data: null, error: null };
  groups = [{ id: 10 }, { id: 11 }];
});

afterEach(() => {
  cleanup();
  searched.mockClear();
});

describe("SearchScreen", () => {
  it("(#378) 머리줄은 '‹ 일정 검색' 하나 (뒤로 링크는 달력)", () => {
    render(<SearchScreen />);
    expect(screen.getByRole("heading", { level: 1, name: "일정 검색" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "뒤로" }).getAttribute("href")).toBe("/calendar");
  });

  it("빈 검색어면 안내만 (저장하지 않는다는 문구)", () => {
    render(<SearchScreen />);
    expect(screen.getByText(/검색어는 저장하지 않아요/)).toBeTruthy();
    expect(searched).toHaveBeenLastCalledWith("", 10);
  });

  it("주소 q 로 시작, 다가오는 일정 먼저 지난 일정 다음, 강조와 반복 표시, 줄은 일정 상세로", () => {
    params = new URLSearchParams("q=치과");
    result = {
      data: { items: [item(1, "치과 예약", true, { repeat: "WEEKLY", occurrence: "2099-01-05" }), item(2, "지난 치과", false)], hasMore: false },
      error: null,
    };
    render(<SearchScreen />);
    expect((screen.getByRole("searchbox", { name: "일정 검색어" }) as HTMLInputElement).value).toBe("치과");
    const upcoming = screen.getByRole("region", { name: "다가오는 일정" });
    const past = screen.getByRole("region", { name: "지난 일정" });
    const link = within(upcoming).getByRole("link");
    expect(link.getAttribute("href")).toBe("/events/evnt0001?occurrence=2099-01-05");
    expect(link.getAttribute("aria-label")).toContain("매주");
    expect(upcoming.querySelector("mark")?.textContent).toBe("치과");
    expect(within(past).getByRole("link").getAttribute("aria-label")).toContain("2025년 5월 1일");
    // (#378) 결과 줄은 일정 줄: 시각 한 번(오전/오후), 지난 일정은 흐리게
    expect(link.getAttribute("aria-label")).toContain("오전 10:00 ~ 11:00");
    expect(within(past).getByRole("link").className).toContain("opacity-55");
  });

  it("(#378) 장소는 핀 줄, 메모가 맞았으면 메모 한 줄을 더 (강조)", () => {
    params = new URLSearchParams("q=주차");
    const placeHit = item(4, "가족 모임", true, { place: { text: "할머니 댁", query: null, kakaoPlaceId: null, url: null }, memo: "주차는 뒤편" });
    placeHit.matched = ["memo"];
    result = { data: { items: [placeHit], hasMore: false }, error: null };
    render(<SearchScreen />);
    const link = screen.getByRole("link", { name: /가족 모임/ });
    expect(link.textContent).toContain("할머니 댁");
    expect(link.querySelector("mark")?.textContent).toBe("주차");
    expect(link.getAttribute("aria-label")).toContain("장소 할머니 댁");
  });

  it("모든 팀이면 팀 이름을 보이고 groupId 없이 찾는다. 한 팀뿐이면 범위 고르기가 없다", () => {
    params = new URLSearchParams("q=회의&scope=all");
    result = { data: { items: [item(3, "회의", true, {}, { id: 11, name: "회사", publicCode: "grp00011" })], hasMore: true }, error: null };
    render(<SearchScreen />);
    expect(searched).toHaveBeenLastCalledWith("회의", null);
    expect(screen.getByRole("radio", { name: "모든 팀" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("회사")).toBeTruthy();
    expect(screen.getByText(/검색어를 더 구체적으로/)).toBeTruthy();
    cleanup();
    groups = [{ id: 10 }];
    render(<SearchScreen />);
    expect(screen.queryByRole("radio", { name: "모든 팀" })).toBeNull();
  });

  it("0건이면 '‘검색어’ 일정이 없어요', 적으면 주소 q 를 바꾼다", () => {
    params = new URLSearchParams("q=없음");
    result = { data: { items: [], hasMore: false }, error: null };
    const replace = vi.spyOn(window.history, "replaceState");
    render(<SearchScreen />);
    expect(screen.getByText("‘없음’ 일정이 없어요")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "치과" } });
    expect(replace).toHaveBeenLastCalledWith(null, "", `/search?q=${encodeURIComponent("치과")}`);
  });

  it("오류면 다시 시도", () => {
    params = new URLSearchParams("q=x");
    result = { data: null, error: { message: "잠시 후 다시 시도해 주세요" } };
    render(<SearchScreen />);
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });
});
