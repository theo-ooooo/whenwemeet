import { describe, expect, it } from "vitest";
import {
  COLOR_NAMES,
  cycleColor,
  displayIndex,
  eventColorBody,
  eventColorChanged,
  eventColorName,
  memberColor,
  PICKABLE_COLORS,
  sameEventColor,
} from "../colors";
import { MEMBER_COLORS } from "../types";

describe("멤버 색 8색 (#343, D-215)", () => {
  it("팔레트 순번 = 화면 색 순번. 8번째 키(#F279B5)는 핑크 --m8", () => {
    expect(MEMBER_COLORS.map((c) => memberColor(c))).toEqual([
      "var(--m1)",
      "var(--m2)",
      "var(--m3)",
      "var(--m4)",
      "var(--m5)",
      "var(--m6)",
      "var(--m7)",
      "var(--m8)",
    ]);
    expect(memberColor("#f279b5")).toBe("var(--m8)");
    expect(displayIndex(7)).toBe(7);
    // 팔레트 밖(탈퇴한 멤버 회색)은 그대로, 없으면 --mute
    expect(memberColor("#9CA3AF")).toBe("#9CA3AF");
    expect(memberColor(null)).toBe("var(--mute)");
  });

  it("고를 수 있는 색은 8개 모두, 이름은 같은 순서로 핑크가 마지막", () => {
    expect(PICKABLE_COLORS).toEqual(MEMBER_COLORS);
    expect(COLOR_NAMES).toHaveLength(PICKABLE_COLORS.length);
    expect(COLOR_NAMES[7]).toBe("핑크");
    expect(cycleColor(7)).toBe("var(--m8)");
    expect(cycleColor(8)).toBe("var(--m1)");
  });
});

describe("일정 색 폼 규칙 (#343)", () => {
  it("이름: null = 자동, 대소문자 무시, 밖은 지금 색", () => {
    expect(eventColorName(null)).toBe("자동");
    expect(eventColorName("#f279b5")).toBe("핑크");
    expect(eventColorName("#F26D6D")).toBe("블루");
    expect(eventColorName("#000000")).toBe("지금 색");
    expect(sameEventColor("#f279b5", "#F279B5")).toBe(true);
    expect(sameEventColor(null, "#F279B5")).toBe(false);
  });

  it("바뀜: 수정에서만, 대소문자는 같다", () => {
    expect(eventColorChanged({ editing: true, current: "#F279B5", initial: null })).toBe(true);
    expect(eventColorChanged({ editing: true, current: "#f279b5", initial: "#F279B5" })).toBe(false);
    expect(eventColorChanged({ editing: false, current: "#F279B5", initial: null })).toBe(false);
  });

  it("본문: 생성은 고른 색만, 수정은 바꿨을 때만(자동으로 되돌리면 null), 이 일정만은 싣지 않는다", () => {
    expect(eventColorBody({ editing: false, thisOnly: false, current: null, initial: null })).toBeUndefined();
    expect(eventColorBody({ editing: false, thisOnly: false, current: "#F279B5", initial: null })).toBe("#F279B5");
    expect(eventColorBody({ editing: true, thisOnly: false, current: "#F279B5", initial: "#F279B5" })).toBeUndefined();
    expect(eventColorBody({ editing: true, thisOnly: false, current: null, initial: "#F279B5" })).toBeNull();
    expect(eventColorBody({ editing: true, thisOnly: false, current: "#F26D6D", initial: null })).toBe("#F26D6D");
    expect(eventColorBody({ editing: true, thisOnly: true, current: "#F26D6D", initial: null })).toBeUndefined();
  });
});
