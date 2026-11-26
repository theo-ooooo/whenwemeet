// @vitest-environment happy-dom
// (#378) ⋯ 메뉴: menu 역할, 열면 첫 항목 포커스, 화살표와 Home End, Esc 로 닫고 ⋯ 로 포커스, 바깥 누르면 닫힘, 위험 항목은 확인 뒤 실행
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverflowMenu, type OverflowMenuItem } from "../OverflowMenu";

afterEach(cleanup);

const setup = (over: Partial<Record<"share" | "copy" | "del", () => void | Promise<unknown>>> = {}, extra: OverflowMenuItem[] = []) => {
  const share = vi.fn(over.share);
  const copy = vi.fn(over.copy);
  const del = vi.fn(over.del);
  render(
    <>
      <OverflowMenu
        label="일정 메뉴"
        items={[
          { label: "공유", onSelect: share },
          { label: "복제", onSelect: copy },
          ...extra,
          {
            label: "삭제",
            destructive: true,
            onSelect: del,
            confirm: { title: "이 일정을 지울까요?", body: "지운 뒤 되돌릴 수 있어요", confirmLabel: "삭제" },
          },
        ]}
      />
      <button type="button">바깥</button>
    </>,
  );
  return { share, copy, del, button: screen.getByRole("button", { name: "일정 메뉴" }) };
};

describe("OverflowMenu", () => {
  it("⋯ 는 aria-haspopup=menu, 누르면 menu 와 menuitem, 첫 항목에 포커스", () => {
    const { button } = setup();
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "일정 메뉴" });
    expect(button.getAttribute("aria-controls")).toBe(menu.id);
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["공유", "복제", "삭제"]);
    expect(document.activeElement?.textContent).toBe("공유");
  });

  it("↓ ↑ 는 돌아가며, Home End, 끝에서 처음으로", () => {
    const { button } = setup();
    fireEvent.click(button);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("복제");
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement?.textContent).toBe("삭제");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("공유");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("삭제");
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement?.textContent).toBe("공유");
  });

  it("⋯ 에서 ↑ 로 열면 마지막 항목, 막힌 항목은 건너뛴다", () => {
    const { button } = setup({}, [{ label: "막힘", disabled: true, onSelect: () => {} }]);
    fireEvent.keyDown(button, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("삭제");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("복제");
  });

  it("Esc 는 닫고 ⋯ 로 포커스를 돌린다", () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("Tab 은 닫기만 (포커스는 다음으로 넘어가게 둔다), 바깥을 누르면 닫힌다", () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole("button", { name: "바깥" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("일반 항목은 고르면 닫고 바로 실행", () => {
    const { button, share } = setup();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("menuitem", { name: "공유" }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("위험 항목은 빨간 글자, 확인 창을 먼저 띄우고 취소하면 실행하지 않는다", () => {
    const { button, del } = setup();
    fireEvent.click(button);
    const item = screen.getByRole("menuitem", { name: "삭제" });
    expect(item.className).toContain("text-danger");
    fireEvent.click(item);
    const dialog = screen.getByRole("alertdialog", { name: "이 일정을 지울까요?" });
    expect(dialog.textContent).toContain("지운 뒤 되돌릴 수 있어요");
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(del).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it("확인하면 실행, Promise 면 끝날 때까지 확인 버튼이 기다린다", async () => {
    let finish: () => void = () => {};
    const { button, del } = setup({ del: () => new Promise<void>((r) => (finish = r)) });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("menuitem", { name: "삭제" }));
    const confirm = screen.getAllByRole("button", { name: "삭제" }).find((b) => b.closest('[role="alertdialog"]'))!;
    fireEvent.click(confirm);
    expect(del).toHaveBeenCalledTimes(1);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    await act(async () => finish());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('(#378) confirm: "caller" 위험 항목은 메뉴의 확인 창 없이 메뉴만 닫고 onSelect (부르는 쪽이 확인 창, 범위 시트를 띄운다)', () => {
    const del = vi.fn();
    render(<OverflowMenu label="일정 메뉴" items={[{ label: "삭제", destructive: true, confirm: "caller", onSelect: del }]} />);
    fireEvent.click(screen.getByRole("button", { name: "일정 메뉴" }));
    const item = screen.getByRole("menuitem", { name: "삭제" });
    expect(item.className).toContain("text-danger");
    fireEvent.click(item);
    expect(del).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
