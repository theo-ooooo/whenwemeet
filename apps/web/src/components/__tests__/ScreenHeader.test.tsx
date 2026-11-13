// @vitest-environment happy-dom
// (#378) 하위 화면 머리줄: "‹ 제목 ⋯", 뒤로는 앱 안 기록이 있으면 router.back, 없으면 fallback 링크
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const back = vi.fn();
let canBack = false;
vi.mock("next/navigation", () => ({ useRouter: () => ({ back }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) => (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        // 실제 Link 처럼: 막지 않았으면 이동한 것으로 본다
        if (!e.defaultPrevented) e.preventDefault();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/lib/back-nav", () => ({ canGoBack: () => canBack }));

const { ScreenHeader } = await import("../ScreenHeader");

beforeEach(() => {
  canBack = false;
  back.mockClear();
});
afterEach(cleanup);

describe("ScreenHeader", () => {
  it("제목은 h1, ‹ 는 fallback 을 가리키는 '뒤로' 링크, 오른쪽 칸", () => {
    render(<ScreenHeader title="일정 검색" fallbackHref="/calendar" right={<button type="button">메뉴</button>} subtitle="남은 3개" />);
    expect(screen.getByRole("heading", { level: 1, name: "일정 검색" })).toBeTruthy();
    const link = screen.getByRole("link", { name: "뒤로" });
    expect(link.getAttribute("href")).toBe("/calendar");
    expect(link.className).toContain("size-11");
    expect(screen.getByRole("button", { name: "메뉴" })).toBeTruthy();
    expect(screen.getByText("남은 3개")).toBeTruthy();
  });

  it("앱 안 기록이 있으면 router.back, 없으면 링크 그대로", () => {
    render(<ScreenHeader title="새 소식" fallbackHref="/calendar" backLabel="달력으로" />);
    const link = screen.getByRole("link", { name: "달력으로" });
    fireEvent.click(link);
    expect(back).not.toHaveBeenCalled();
    canBack = true;
    fireEvent.click(link);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("새 탭으로 열기(⌘, 가운데 클릭)는 가로채지 않는다", () => {
    canBack = true;
    render(<ScreenHeader title="x" fallbackHref="/calendar" />);
    fireEvent.click(screen.getByRole("link", { name: "뒤로" }), { metaKey: true });
    expect(back).not.toHaveBeenCalled();
  });

  it("back=phone 이면 넓은 화면에서 숨기는 클래스", () => {
    render(<ScreenHeader title="x" fallbackHref="/calendar" back="phone" />);
    expect(screen.getByRole("link", { name: "뒤로" }).className).toContain("fold:hidden");
  });

  it("(#378) onBack 을 주면 이동하지 않고 그것만 부른다 (입력 화면 이탈 확인). ⌘ 클릭은 링크 그대로", () => {
    canBack = true;
    const onBack = vi.fn();
    render(<ScreenHeader title="새 일정" fallbackHref="/calendar" backLabel="취소" onBack={onBack} />);
    const link = screen.getByRole("link", { name: "취소" });
    fireEvent.click(link);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    fireEvent.click(link, { metaKey: true });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
