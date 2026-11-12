import { describe, expect, it } from "vitest";
import { pickStartGroupId, startCalendarLabel } from "../start-calendar";

const PERSONAL = { id: 1, type: "PERSONAL" as const, name: "내 달력" };
const TEAM_A = { id: 2, type: "TEAM" as const, name: "우리 둘" };
const TEAM_B = { id: 3, type: "TEAM" as const, name: "가족" };
const GROUPS = [PERSONAL, TEAM_A, TEAM_B];

describe("pickStartGroupId (#300)", () => {
  it("LAST: 쿠키의 팀이 내 팀이면 그 팀, 아니면 개인 팀", () => {
    const last = { mode: "LAST" as const, groupId: null };
    expect(pickStartGroupId(GROUPS, last, 3)).toBe(3);
    expect(pickStartGroupId(GROUPS, last, 99)).toBe(1);
    expect(pickStartGroupId(GROUPS, last, null)).toBe(1);
  });

  it("설정을 못 읽으면(null) LAST 와 같다", () => {
    expect(pickStartGroupId(GROUPS, null, 2)).toBe(2);
    expect(pickStartGroupId(GROUPS, null, null)).toBe(1);
  });

  it("PERSONAL: 쿠키와 상관없이 개인 팀", () => {
    expect(pickStartGroupId(GROUPS, { mode: "PERSONAL", groupId: null }, 3)).toBe(1);
  });

  it("GROUP: 고정한 팀이 있으면 쿠키와 상관없이 그 팀", () => {
    expect(pickStartGroupId(GROUPS, { mode: "GROUP", groupId: 2 }, 3)).toBe(2);
  });

  it("GROUP: 고정한 팀이 없으면(나갔거나 지워짐) LAST 규칙", () => {
    expect(pickStartGroupId(GROUPS, { mode: "GROUP", groupId: 99 }, 3)).toBe(3);
    expect(pickStartGroupId(GROUPS, { mode: "GROUP", groupId: 99 }, null)).toBe(1);
    expect(pickStartGroupId(GROUPS, { mode: "GROUP", groupId: null }, null)).toBe(1);
  });

  it("개인 팀이 없으면 첫 팀, 팀이 하나도 없으면 null", () => {
    expect(pickStartGroupId([TEAM_A, TEAM_B], { mode: "PERSONAL", groupId: null }, null)).toBe(2);
    expect(pickStartGroupId([], { mode: "GROUP", groupId: 2 }, 2)).toBeNull();
    expect(pickStartGroupId([], null, null)).toBeNull();
  });
});

describe("startCalendarLabel (#300)", () => {
  it("LAST, 값 없음은 마지막에 본 달력, PERSONAL 은 내 달력", () => {
    expect(startCalendarLabel(undefined, GROUPS)).toBe("마지막에 본 달력");
    expect(startCalendarLabel({ mode: "LAST", groupId: null }, GROUPS)).toBe("마지막에 본 달력");
    expect(startCalendarLabel({ mode: "PERSONAL", groupId: null }, GROUPS)).toBe("내 달력");
  });

  it("GROUP 은 팀 이름, 목록에 없거나 목록을 아직 못 받았으면 마지막에 본 달력", () => {
    expect(startCalendarLabel({ mode: "GROUP", groupId: 3 }, GROUPS)).toBe("가족");
    expect(startCalendarLabel({ mode: "GROUP", groupId: 99 }, GROUPS)).toBe("마지막에 본 달력");
    expect(startCalendarLabel({ mode: "GROUP", groupId: 3 }, null)).toBe("마지막에 본 달력");
  });
});
