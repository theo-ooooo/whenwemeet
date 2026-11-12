// @vitest-environment happy-dom
// (#315) 사이드바 접기: 접힌 레일 칸, 툴팁, 키보드 조작, 팀 바꾸기, 접힌 동안 아래 묶음을 받지 않음
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupDetail } from "@/lib/types";

const useEvents = vi.fn((...args: unknown[]) => ({ args, data: [], error: null, refetch: vi.fn() }));
const useAnniversaries = vi.fn((...args: unknown[]) => ({ args, data: [], error: null, refetch: vi.fn() }));
vi.mock("@/hooks", () => ({ useEvents: (...a: unknown[]) => useEvents(...a), useAnniversaries: (...a: unknown[]) => useAnniversaries(...a) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const { Sidebar } = await import("../Sidebar");

const member = (userId: number, name: string, color: string) => ({ userId, displayName: name, color, profileImageUrl: null, joinedAt: "2026-11-01T00:00:00.000Z" });
const group = {
  id: 6,
  type: "TEAM",
  name: "우리 둘",
  publicCode: "teamcode",
  inviteCode: "ABCDEF",
  inviteUrl: null,
  inviteShareUrl: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  members: [member(1, "지우", "#F26D6D"), member(2, "하늘", "#5B6CF4")],
  me: { ...member(1, "지우", "#F26D6D"), notify: true },
} as unknown as GroupDetail;

function setup(over: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const onToggle = vi.fn();
  const onSwitchTeam = vi.fn();
  render(<Sidebar groupId={6} group={group} tab="free" unread={3} enabled refreshKey="k" onSwitchTeam={onSwitchTeam} collapsed={false} onToggle={onToggle} {...over} />);
  return { onToggle, onSwitchTeam };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("펼친 사이드바", () => {
  it("팀 이름, 메뉴 이름, 다가오는 일정 묶음을 그리고 [사이드바 접기] 로 접는다", () => {
    const { onToggle } = setup();
    const aside = screen.getByRole("complementary");
    expect(aside.dataset.collapsed).toBeUndefined();
    expect(within(aside).getByText("우리 둘")).toBeTruthy();
    expect(within(aside).getByText("빈 시간")).toBeTruthy();
    expect(within(aside).getByText("다가오는 일정")).toBeTruthy();
    const btn = screen.getByRole("button", { name: "사이드바 접기" });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(useEvents).toHaveBeenCalled();
  });
});

describe("(#276) 할 일 메뉴", () => {
  it("펼친 사이드바: 기념일과 새 소식 사이, 할 일 화면에서 켜진다", () => {
    setup({ tab: "todos" });
    const nav = screen.getByRole("navigation", { name: "주요 화면" });
    const names = within(nav).getAllByRole("link").map((a) => a.textContent);
    expect(names.indexOf("할 일")).toBe(names.indexOf("기념일") + 1);
    const current = within(nav).getByRole("link", { current: "page" });
    expect(current.getAttribute("href")).toBe("/todos");
  });
});

describe("접힌 72 레일", () => {
  it("화면 이름 글자 없이 아이콘 칸만, 각 칸은 aria-label 과 툴팁을 가진다", () => {
    setup({ collapsed: true });
    const aside = screen.getByRole("complementary");
    expect(aside.dataset.collapsed).toBe("true");
    const nav = within(aside).getByRole("navigation", { name: "주요 화면" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("aria-label"))).toEqual(["달력", "빈 시간", "기념일", "할 일", "새 소식, 새 소식 3개", "팀 설정"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/calendar", "/free", "/anniversaries", "/todos", "/news", "/team"]);
    // 툴팁: 칸마다 하나, 스크린 리더에서는 숨김 (이름은 aria-label 로)
    const tips = aside.querySelectorAll("[data-tooltip]");
    expect([...tips].map((t) => t.textContent)).toEqual(["우리 둘", "달력", "빈 시간", "기념일", "할 일", "새 소식", "팀 설정", "내 정보", "펼치기"]);
    for (const t of tips) expect(t.getAttribute("aria-hidden")).toBe("true");
    // 툴팁은 마우스와 키보드 포커스 둘 다에서 보인다 (같은 칸 group 안)
    for (const t of tips) {
      expect(t.className).toMatch(/group-hover:block/);
      expect(t.className).toMatch(/group-focus-within:block/);
    }
    // (#323) 레일 밖으로 나간 툴팁이 본문(뒤에 오는 위치 지정 요소)에 가리지 않게 레일이 본문 위 층에 있고, 레일은 툴팁을 자르지 않는다
    expect(aside.className).toMatch(/\bsticky\b/);
    expect(aside.className).toMatch(/\bz-30\b/);
    expect(aside.className).not.toMatch(/overflow-(?:y-|x-)?(?:auto|hidden|scroll|clip)/);
    // 팀 이름 글자, 다가오는 일정 묶음은 없다 (아바타 첫 글자 + 툴팁만)
    expect(within(aside).queryByText("다가오는 일정")).toBeNull();
    expect(within(aside).queryByRole("heading")).toBeNull();
  });

  it("지금 화면은 먹색 칩(aria-current), 새 소식은 아이콘 점, 누르는 칸 44", () => {
    setup({ collapsed: true, tab: "upcoming" });
    const current = screen.getByRole("link", { current: "page" });
    expect(current.getAttribute("aria-label")).toBe("달력");
    expect(current.className).toMatch(/bg-ink/);
    expect(current.className).toMatch(/size-11/);
  });

  it("팀 아바타를 누르면 팀 바꾸기, 펼치기 버튼은 aria-expanded=false 로 onToggle", () => {
    const { onToggle, onSwitchTeam } = setup({ collapsed: true });
    fireEvent.click(screen.getByRole("button", { name: "우리 둘, 팀 바꾸기" }));
    expect(onSwitchTeam).toHaveBeenCalledTimes(1);
    const expand = screen.getByRole("button", { name: "사이드바 펼치기" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expand);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "내 정보" }).getAttribute("href")).toBe("/me");
  });

  it("키보드: 모든 칸이 Tab 으로 닿는 요소(링크, 버튼)이고 순서는 심볼, 팀, 메뉴 6, 내 정보, 펼치기", () => {
    setup({ collapsed: true });
    const focusables = [...screen.getByRole("complementary").querySelectorAll<HTMLElement>("a, button")];
    expect(focusables.map((el) => el.getAttribute("aria-label"))).toEqual([
      "언제볼까 달력",
      "우리 둘, 팀 바꾸기",
      "달력",
      "빈 시간",
      "기념일",
      "할 일",
      "새 소식, 새 소식 3개",
      "팀 설정",
      "내 정보",
      "사이드바 펼치기",
    ]);
    // Enter/Space 는 버튼의 기본 동작 (button type=button)
    for (const el of focusables) if (el.tagName === "BUTTON") expect(el.getAttribute("type")).toBe("button");
  });

  it("접힌 동안 다가오는 일정, 기념일을 받지 않는다", () => {
    setup({ collapsed: true });
    expect(useEvents).not.toHaveBeenCalled();
    expect(useAnniversaries).not.toHaveBeenCalled();
  });
});
