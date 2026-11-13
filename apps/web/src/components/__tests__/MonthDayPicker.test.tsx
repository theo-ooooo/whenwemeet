// @vitest-environment happy-dom
// (#378) 월, 일 고르기 (내 생일): 줄 값, 달 칸 방향키, 날 칸 방향키와 Enter, 고르면 닫힘, Esc
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonthDayPicker, type MonthDay } from "../pickers/MonthDayPicker";

afterEach(cleanup);

function Harness({ initial = null, onChange }: { initial?: MonthDay | null; onChange?: (v: MonthDay) => void }) {
  const [v, setV] = useState<MonthDay | null>(initial);
  return (
    <MonthDayPicker
      label="생일"
      value={v}
      onChange={(next) => {
        setV(next);
        onChange?.(next);
      }}
    />
  );
}

describe("MonthDayPicker", () => {
  it("없으면 '고르기', 열면 고른 달만 Tab 으로 들어오고 방향키로 달을 옮긴다", () => {
    render(<Harness />);
    const row = screen.getByRole("button", { name: "생일, 선택 안 함" });
    expect(row.textContent).toContain("고르기");
    fireEvent.click(row);
    const jan = screen.getByRole("radio", { name: "1월" });
    expect(jan.getAttribute("aria-checked")).toBe("true");
    expect(jan.tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: "2월" }).tabIndex).toBe(-1);
    fireEvent.keyDown(jan, { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: "5월" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(screen.getByRole("radio", { name: "5월" }), { key: "End" });
    expect(screen.getByRole("radio", { name: "12월" }).getAttribute("aria-checked")).toBe("true");
  });

  it("날 칸은 방향키로 옮기고 누르면 정하고 닫는다. 그 달에 없는 날은 마지막 날로 줄인다", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ m: 1, d: 31 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "생일, 1월 31일" }));
    expect(screen.getByRole("button", { name: "1월 31일" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "4월" }));
    const days = screen.getByRole("group", { name: "4월 날짜" }).querySelectorAll("button");
    expect(days).toHaveLength(30);
    expect(screen.getByRole("button", { name: "4월 30일" }).tabIndex).toBe(0);
    fireEvent.keyDown(screen.getByRole("button", { name: "4월 30일" }), { key: "ArrowUp" });
    expect(screen.getByRole("button", { name: "4월 23일" }).tabIndex).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "4월 23일" }));
    expect(onChange).toHaveBeenCalledWith({ m: 4, d: 23 });
    expect(screen.queryByRole("group", { name: "4월 날짜" })).toBeNull();
    expect(screen.getByRole("button", { name: "생일, 4월 23일" })).toBeTruthy();
  });

  it("Esc 는 고르지 않고 닫는다", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "생일, 선택 안 함" }));
    fireEvent.keyDown(screen.getByRole("radio", { name: "1월" }), { key: "Escape" });
    expect(screen.queryByRole("radio", { name: "1월" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
