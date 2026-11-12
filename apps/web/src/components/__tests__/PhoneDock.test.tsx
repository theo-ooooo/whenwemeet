// @vitest-environment happy-dom
// (#332) 폰 아래 독 5칸: 순서, 주소, 선택 칩(이름 표시, aria-current), 아이콘만인 칸의 aria-label, 누르는 영역 44
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeTab } from "@/lib/routes";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const { DockTabs, DOCK_TABS, isDockActive } = await import("../PhoneDock");

afterEach(cleanup);

const links = () => within(screen.getByRole("navigation", { name: "주요 화면" })).getAllByRole("link");

describe("폰 독 칸", () => {
  it("5칸, 순서는 달력, 빈 시간, 할 일, 기념일, 팀이고 각 화면 주소로 간다", () => {
    render(<DockTabs tab="news" />);
    expect(DOCK_TABS.map((t) => t.label)).toEqual(["달력", "빈 시간", "할 일", "기념일", "팀"]);
    expect(links().map((a) => a.getAttribute("href"))).toEqual(["/calendar", "/free", "/todos", "/anniversaries", "/team"]);
    // 새 소식에서는 어느 칸도 켜지지 않고, 모두 아이콘만이라 이름은 aria-label 로 읽는다
    expect(links().map((a) => a.getAttribute("aria-label"))).toEqual(["달력", "빈 시간", "할 일", "기념일", "팀"]);
    expect(links().some((a) => a.hasAttribute("aria-current"))).toBe(false);
  });

  it.each([
    ["/calendar", "달력"],
    ["/upcoming", "달력"],
    ["/events/abcdefgh", "달력"],
    ["/free", "빈 시간"],
    ["/todos", "할 일"],
    ["/anniversaries", "기념일"],
    ["/team", "팀"],
  ])("%s 에서는 %s 칸만 먹색 칩 + 이름", (path, label) => {
    render(<DockTabs tab={activeTab(path)} />);
    const current = links().filter((a) => a.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    const [on] = current;
    // 켜진 칸은 이름 글자를 보여 주고(aria-label 없음) 칩 면이 먹색
    expect(on.getAttribute("aria-label")).toBeNull();
    expect(on.textContent).toBe(label);
    expect(on.querySelector(".bg-ink")).not.toBeNull();
    // 나머지 넷은 아이콘만: 이름은 숨김(aria-hidden), aria-label 로 읽는다
    const off = links().filter((a) => a !== on);
    expect(off).toHaveLength(4);
    for (const a of off) {
      expect(a.getAttribute("aria-label")).toBeTruthy();
      expect(a.querySelector("span[aria-hidden='true']")?.textContent).toBe(a.getAttribute("aria-label"));
      expect(a.querySelector(".bg-ink")).toBeNull();
    }
  });

  it("칸마다 누르는 영역은 최소 44 (칸 폭 min-w-11, 알약 높이 64 를 다 쓴다)", () => {
    render(<DockTabs tab="free" />);
    for (const a of links()) {
      expect(a.className).toContain("min-w-11");
      expect(a.className).toContain("h-full");
    }
    expect(screen.getByRole("navigation", { name: "주요 화면" }).className).toContain("h-16");
  });

  it("할 일 칸은 목록 화면에서 켜지고, 다가오는 일정은 달력 칸에 딸린다", () => {
    expect(isDockActive("todos", activeTab("/todos"))).toBe(true);
    expect(isDockActive("calendar", activeTab("/upcoming"))).toBe(true);
    expect(isDockActive("todos", activeTab("/calendar"))).toBe(false);
    expect(isDockActive("calendar", activeTab("/news"))).toBe(false);
  });
});
