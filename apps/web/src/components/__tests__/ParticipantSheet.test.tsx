// @vitest-environment happy-dom
// (#442) 참여자 고르기: "모두" 줄 대신 "전체 선택". 전원을 골라도 "ALL" 이 아니라 고른 id (멤버 순서)
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticipantSheet } from "../Participants";
import type { Member } from "@/lib/types";

const m = (id: number, name: string): Member => ({ userId: id, displayName: name, color: "#F26D6D", profileImageUrl: null });
const MEMBERS = [m(1, "지우"), m(2, "하늘"), m(3, "민지")];

const open = (value: "ALL" | number[]) => {
  const onDone = vi.fn();
  render(<ParticipantSheet open members={MEMBERS} meId={1} value={value} onDone={onDone} onClose={() => {}} />);
  return onDone;
};
const box = (name: RegExp) => screen.getByRole("checkbox", { name });
const done = () => fireEvent.click(screen.getByRole("button", { name: "완료" }));

afterEach(cleanup);

describe("참여자 고르기 (#442)", () => {
  it("'모두' 줄이 없고 '전체 선택' 이 있다", () => {
    open([1]);
    expect(screen.queryByText("모두")).toBeNull();
    expect(box(/전체 선택/).getAttribute("aria-checked")).toBe("false");
  });

  it("전체 선택을 누르면 전원이 켜지고 완료는 전원 id (ALL 아님)", () => {
    const onDone = open([1]);
    fireEvent.click(box(/전체 선택/));
    for (const n of [/지우/, /하늘/, /민지/]) expect(box(n).getAttribute("aria-checked")).toBe("true");
    done();
    expect(onDone).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("ALL 로 열면 전원 켜짐, 한 명 끄면 전체 선택도 꺼지고 나머지 id", () => {
    const onDone = open("ALL");
    expect(box(/전체 선택/).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box(/민지/));
    expect(box(/전체 선택/).getAttribute("aria-checked")).toBe("false");
    done();
    expect(onDone).toHaveBeenCalledWith([1, 2]);
  });

  it("전체 선택을 다시 누르면 전원 꺼지고 완료 막힘", () => {
    open("ALL");
    fireEvent.click(box(/전체 선택/));
    expect(screen.getByRole("alert").textContent).toContain("한 명 이상");
    expect((screen.getByRole("button", { name: "완료" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
