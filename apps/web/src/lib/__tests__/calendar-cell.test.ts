import { describe, expect, it } from "vitest";
import { cellDensity } from "../calendar-cell";
import { memberColor } from "../colors";
import { MEMBER_COLORS, type Member } from "../types";

const m = (i: number): Member => ({ userId: i + 1, displayName: `m${i}`, color: MEMBER_COLORS[i], profileImageUrl: null });
const c = (i: number) => memberColor(MEMBER_COLORS[i]);
const creator = m(0);
/** 참여자 인덱스 목록. null = 옛 API (participants 없음 → 등록자) */
const ev = (...who: number[]) => ({ creator, participants: { all: false, members: who.map(m) } });
const none = () => ({ creator, participants: { all: false, members: [] } });

describe("cellDensity — 폰 달력 칸 참여자 점 (#139, #248 D-140)", () => {
  it("일정이 없으면 점도 없다", () => {
    expect(cellDensity([])).toEqual({ dots: [], more: 0, cut: false });
  });

  it("한 명짜리 일정은 일정 하나에 점 하나, 같은 사람이어도 개수만큼", () => {
    expect(cellDensity([ev(1), ev(1)])).toEqual({ dots: [c(1), c(1)], more: 0, cut: false });
  });

  it("참여자 점을 일정 순서대로 이어 붙인다", () => {
    expect(cellDensity([ev(0, 1), ev(2)])).toEqual({ dots: [c(0), c(1), c(2)], more: 0, cut: false });
  });

  it("일정 색(#343)을 고른 일정은 참여자 수와 무관하게 그 색 점 하나", () => {
    expect(cellDensity([{ ...ev(0, 1, 2), color: MEMBER_COLORS[7] }, ev(3)])).toEqual({ dots: ["var(--m8)", c(3)], more: 0, cut: false });
  });

  it("점을 하나도 못 그린 일정이 있으면 +N (그 일정 수)", () => {
    expect(cellDensity([ev(0, 1, 2), ev(3), ev(4)])).toEqual({ dots: [c(0), c(1), c(2)], more: 2, cut: false });
    expect(cellDensity([ev(0), ev(0), ev(0), ev(0), ev(0), ev(0), ev(0)])).toEqual({ dots: [c(0), c(0), c(0)], more: 4, cut: false });
  });

  it("일정은 다 보였지만 참여자 점이 잘렸으면 숫자 없는 + (cut)", () => {
    expect(cellDensity([ev(0, 1, 2, 3)])).toEqual({ dots: [c(0), c(1), c(2)], more: 0, cut: true });
    expect(cellDensity([ev(0, 1), ev(2, 3)])).toEqual({ dots: [c(0), c(1), c(2)], more: 0, cut: true });
  });

  it("잘린 점과 못 그린 일정이 같이 있으면 +N 만", () => {
    expect(cellDensity([ev(0, 1), ev(2, 3), ev(4)])).toEqual({ dots: [c(0), c(1), c(2)], more: 1, cut: false });
  });

  it("참여자 없음은 회색 점 1개", () => {
    expect(cellDensity([none(), ev(1)])).toEqual({ dots: ["var(--mute)", c(1)], more: 0, cut: false });
  });

  it("옛 API (participants 없음) 는 등록자 색", () => {
    expect(cellDensity([{ creator }])).toEqual({ dots: [c(0)], more: 0, cut: false });
  });

  it("최대 개수를 바꿀 수 있다", () => {
    expect(cellDensity([ev(0), ev(1), ev(2)], 2)).toEqual({ dots: [c(0), c(1)], more: 1, cut: false });
  });
});
