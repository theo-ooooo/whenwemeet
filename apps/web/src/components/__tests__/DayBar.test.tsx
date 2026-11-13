// @vitest-environment happy-dom
// (#378) 하루 막대: 모두 비는 시간 요약, 코랄 빈 구간 버튼(읽기 이름, 누른 자리 30분, 키보드는 구간 시작), 눈금, 지금, 멤버 줄
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DayBar } from "../DayBar";
import { kstToIso } from "@/lib/date";
import type { Member } from "@/lib/types";

const D = "2026-11-17";
const t = (hm: string) => Date.parse(kstToIso(D, hm));
const iv = (a: string, b: string) => ({ start: t(a), end: t(b) });
const m = (id: number, name: string): Member => ({ userId: id, displayName: name, color: id === 1 ? "#F26D6D" : "#F2994A", profileImageUrl: null });
const members = [
  { member: m(1, "지우"), busy: [iv("08:00", "09:00"), iv("18:00", "19:00")] },
  { member: m(2, "하늘"), busy: [iv("08:30", "10:00"), iv("21:00", "21:30")] },
];

afterEach(cleanup);

describe("DayBar", () => {
  it("요약: 둘이면 '둘 다 빔' + 합계, 그룹 읽기 이름", () => {
    render(<DayBar date={D} members={members} title="오늘 하루" />);
    const group = screen.getByRole("group", { name: "오늘 하루, 둘 다 빔 11시간 30분" });
    expect(within(group).getByText("11시간 30분").className).toContain("text-acc-ink");
  });

  it("셋 이상이면 '모두', 빈 시간이 없으면 '없음'", () => {
    const three = [...members, { member: m(3, "민지"), busy: [iv("07:00", "23:30")] }];
    render(<DayBar date={D} members={three} />);
    expect(screen.getByRole("group", { name: "이날 하루, 모두 비는 시간 없음" })).toBeTruthy();
  });

  it("onSelect 가 없으면 빈 구간은 그림 + 읽기 글자, 있으면 버튼", () => {
    const { container } = render(<DayBar date={D} members={members} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelectorAll("[data-free]")).toHaveLength(3);
    expect(screen.getByText("오전 10:00 ~ 오후 6:00 둘 다 비어요")).toBeTruthy();
  });

  it("빈 구간 버튼: 누른 자리를 30분으로 내린 시각, 키보드는 구간 시작", () => {
    const select = vi.fn();
    render(<DayBar date={D} members={members} onSelect={select} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "오전 10:00 ~ 오후 6:00 둘 다 비어요, 이 시간에 일정 추가",
      "오후 7:00 ~ 9:00 둘 다 비어요, 이 시간에 일정 추가",
      "오후 9:30 ~ 11:00 둘 다 비어요, 이 시간에 일정 추가",
    ]);
    // 막대 폭 300px 가정: 8시 + (140/300)*15시간 = 15:00 → 15:00
    const layer = buttons[0].parentElement!;
    layer.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 44, right: 300, bottom: 44, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.click(buttons[0], { clientX: 145, detail: 1 });
    expect(select).toHaveBeenLastCalledWith(t("15:00"));
    fireEvent.click(buttons[1], { detail: 0 });
    expect(select).toHaveBeenLastCalledWith(t("19:00"));
  });

  it("빈 구간 위치는 % (10~18시 = 13.33% 에서 53.33% 폭)", () => {
    render(<DayBar date={D} members={members} onSelect={() => {}} />);
    const b = screen.getAllByRole("button")[0] as HTMLElement;
    expect(b.style.left).toBe("13.33%");
    expect(b.style.width).toBe("53.33%");
  });

  it("free 를 주면 그 값을 쓴다 (빈 시간 찾기 결과)", () => {
    render(<DayBar date={D} members={[]} free={[iv("09:00", "16:00")]} fromHour={9} toHour={23} />);
    expect(screen.getByRole("group", { name: "이날 하루, 모두 빔 7시간" })).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("눈금, 지금 선(창 안일 때만), 멤버 줄(아바타 + 바쁜 시간 읽기)", () => {
    const { container, rerender } = render(<DayBar date={D} members={members} now={t("14:10")} />);
    expect(container.textContent).toContain("8111417202");
    expect(container.querySelector("[data-now]")).toBeTruthy();
    expect(screen.getByText("지금 오후 2:10")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("지우 바쁜 시간 오전 8:00 ~ 9:00, 오후 6:00 ~ 7:00");
    rerender(<DayBar date={D} members={members} now={t("23:30")} showMembers={false} />);
    expect(container.querySelector("[data-now]")).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("(#378 B) 혼자(개인 달력)면 '비는 시간' 과 '비어요' 만, 멤버 줄 없음", () => {
    render(<DayBar date={D} members={[members[0]]} onSelect={() => {}} />);
    expect(screen.getByRole("group", { name: "이날 하루, 비는 시간 13시간" })).toBeTruthy();
    expect(screen.getAllByRole("button")[0].getAttribute("aria-label")).toBe("오전 9:00 ~ 오후 6:00 비어요, 이 시간에 일정 추가");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("(#378 B) memberCount 로 요약을 가르고, hideHead 면 머리 줄 없이 읽기 이름만, bare 면 카드 면 없음", () => {
    const { container } = render(<DayBar date={D} members={[]} free={[iv("09:00", "16:00")]} memberCount={2} title="토 11/14" hideHead bare />);
    const group = screen.getByRole("group", { name: "토 11/14, 둘 다 빔 7시간" });
    expect(group.textContent).not.toContain("토 11/14");
    expect(group.className).not.toContain("bg-paper");
    expect(container.querySelector("[data-free]")?.textContent).toBe("오전 9:00 ~ 오후 4:00 둘 다 비어요");
  });
});
