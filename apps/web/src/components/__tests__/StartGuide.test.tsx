// @vitest-environment happy-dom
// (#278) 달력 위 시작 안내: 이 기기에 쓰임이 있을 때만, 단계 줄 링크, 누르면 그 줄이 빠짐(저장 단계 제외), 닫기
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveStart } from "@/lib/start-guide";

vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

const { StartGuide } = await import("../StartGuide");

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const links = () => screen.queryAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);

describe("StartGuide", () => {
  it("안내가 없는 팀(기존 팀, 다른 기기)에는 아무것도 그리지 않는다", () => {
    const { container } = render(<StartGuide groupId={1} />);
    expect(container.innerHTML).toBe("");
  });

  it("가족: 내 생일, 가족 기념일, 다른 캘린더 앱에서 보기", () => {
    saveStart(1, "family");
    render(<StartGuide groupId={1} />);
    expect(screen.getByRole("heading", { name: "이렇게 시작해 보세요" })).toBeTruthy();
    expect(links()).toEqual([
      ["내 생일 넣기", "/me#birthday"],
      ["가족 기념일 넣기", "/anniversaries"],
      ["다른 캘린더 앱에서 보기", "/team?feed=1"],
    ]);
  });

  it("누른 줄은 빠지고, 저장해야 끝나는 첫 단계는 눌러도 남는다", () => {
    saveStart(2, "study");
    render(<StartGuide groupId={2} />);
    act(() => fireEvent.click(screen.getByRole("link", { name: /주 보기로 한 주 보기/ })));
    act(() => fireEvent.click(screen.getByRole("link", { name: /정기 모임 넣기/ })));
    expect(links().map((l) => l[0])).toEqual(["정기 모임 넣기", "준비할 것 목록 만들기"]);
    expect(localStorage.getItem("wwm.start.2")).toBe("study:week");
  });

  it("닫으면 사라지고 이 기기 안내도 지운다", () => {
    saveStart(3, "two");
    const { container } = render(<StartGuide groupId={3} />);
    act(() => fireEvent.click(screen.getByRole("button", { name: "시작 안내 닫기" })));
    expect(container.innerHTML).toBe("");
    expect(localStorage.getItem("wwm.start.3")).toBeNull();
  });

  it("다른 팀의 안내는 보이지 않는다", () => {
    saveStart(4, "friends");
    const { container } = render(<StartGuide groupId={5} />);
    expect(container.innerHTML).toBe("");
  });
});
