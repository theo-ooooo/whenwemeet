// @vitest-environment happy-dom
// (#566, D-298) 일정 폼 날짜 줄의 양력 / 음력: 음력이면 음력 칩, 윤달 체크, 바뀐 양력 한 줄, 없는 날은 빨간 한 줄
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { kstToIso } from "@/lib/date";
import { applyDraft, lunarError, newDraft, type DraftAction, type EventDraft } from "@/lib/event-draft";
import { DateRangeGroup } from "../DateRangeGroup";

afterEach(cleanup);

function Harness({ initial }: { initial: EventDraft }) {
  const [draft, dispatch] = useReducer((d: EventDraft, a: DraftAction) => applyDraft(d, a, "range"), initial);
  return <DateRangeGroup draft={draft} dispatch={dispatch} touched={false} rangeError={null} lunarError={lunarError(draft)} />;
}

// 2026-11-24 (화) = 음력 10월 16일
const start = () => newDraft({ start: kstToIso("2026-11-24", "18:00"), end: kstToIso("2026-11-24", "20:00") });

describe("DateRangeGroup 음력 (#566)", () => {
  it("음력을 누르면 시작이 음력 칩이 되고 윤달 체크와 '양력 11월 24일 (화)' 가 보인다", () => {
    render(<Harness initial={start()} />);
    expect(screen.queryByLabelText("윤달")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: /음력으로 입력/ }));
    expect(screen.getByRole("button", { name: /^시작 날짜 \(음력\), 음력 2026년 10월 16일$/ })).toBeTruthy();
    expect(screen.getByText("양력 11월 24일 (화)")).toBeTruthy();
    expect(screen.getByLabelText("윤달")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /음력으로 입력/ }));
    expect(screen.queryByText("양력 11월 24일 (화)")).toBeNull();
  });

  it("그 해에 없는 윤달을 켜면 이유 한 줄(알림)로 막고 양력 줄은 숨긴다", () => {
    render(<Harness initial={{ ...start(), lunar: { year: 2026, month: 10, day: 16, leap: false } }} />);
    fireEvent.click(screen.getByLabelText("윤달"));
    expect(screen.getByRole("alert").textContent).toBe("음력 2026년에는 윤10월이 없어요");
    expect(screen.queryByText(/^양력 /)).toBeNull();
  });

  it("음력으로 넣은 일정을 다시 열면 음력으로 연다", () => {
    render(<Harness initial={{ ...start(), lunar: { year: 2026, month: 10, day: 16, leap: false } }} />);
    expect(screen.getByRole("switch", { name: /음력으로 입력/ }).getAttribute("aria-checked")).toBe("true");
  });
});
