// @vitest-environment happy-dom
// (#343) 일정 폼 "색" 줄: 자동 + 8색 라디오 묶음, 이름 라벨, 화살표 키, 막힘 안내
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventColorPicker } from "../EventColorPicker";

afterEach(cleanup);

function Harness({ initial = null, onChange }: { initial?: string | null; onChange?: (v: string | null) => void }) {
  const [v, setV] = useState<string | null>(initial);
  return (
    <EventColorPicker
      value={v}
      onChange={(next) => {
        setV(next);
        onChange?.(next);
      }}
      autoColors={["var(--m1)", "var(--m2)"]}
    />
  );
}

describe("EventColorPicker", () => {
  it("라디오 9칸: 자동이 첫 칸, 이름은 COLOR_NAMES. 고른 칸만 Tab 으로 들어온다", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "색" });
    const radios = screen.getAllByRole("radio");
    expect(group).toBeTruthy();
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(["자동, 참여자 색", "블루", "레몬", "민트", "라벤더", "그린", "피치", "스카이", "핑크"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", ...Array(8).fill("false")]);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, ...Array(8).fill(-1)]);
  });

  it("누르면 그 색, 자동을 누르면 null. 줄 오른쪽에 이름", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "핑크" }));
    expect(onChange).toHaveBeenLastCalledWith("#F279B5");
    expect(screen.getByRole("radio", { name: "핑크" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("핑크", { selector: "span" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "자동, 참여자 색" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("화살표로 옮기며 고르고 끝에서 돈다. Home, End", () => {
    const onChange = vi.fn();
    render(<Harness initial="#F279B5" onChange={onChange} />);
    const pink = screen.getByRole("radio", { name: "핑크" });
    fireEvent.keyDown(pink, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("자동, 참여자 색");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("#F279B5");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("#F279B5");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith("#A66CF4");
  });

  it("막히면 모든 칸이 disabled 이고 안내가 묶음 설명", () => {
    render(<EventColorPicker value="#F26D6D" onChange={() => {}} autoColors={[]} disabled note="반복 일정의 색은 이후 모두에서 바꿀 수 있어요" />);
    expect(screen.getAllByRole("radio").every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
    const group = screen.getByRole("radiogroup");
    expect(group.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(group.getAttribute("aria-describedby")!)?.textContent).toBe("반복 일정의 색은 이후 모두에서 바꿀 수 있어요");
  });
});
