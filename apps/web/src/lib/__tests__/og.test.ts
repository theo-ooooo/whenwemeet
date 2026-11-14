import { describe, expect, it } from "vitest";
import { charLength, clampTeamName, teamNameFontSize, teamNameWordBreak, TEAM_NAME_MAX } from "../og";

describe("팀 이름 (#159)", () => {
  it("이모지를 한 글자로 센다", () => {
    expect(charLength("우리집 🏠")).toBe(5);
  });
  it("최대 길이를 넘으면 말줄임, 공백은 하나로", () => {
    expect(clampTeamName("  우리   둘 ")).toBe("우리 둘");
    const long = "가".repeat(TEAM_NAME_MAX + 5);
    const out = clampTeamName(long);
    expect(charLength(out)).toBe(TEAM_NAME_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(clampTeamName("가".repeat(TEAM_NAME_MAX))).toBe("가".repeat(TEAM_NAME_MAX));
  });
  it("길수록 글자를 줄인다", () => {
    expect(teamNameFontSize("우리 둘")).toBe(104);
    expect(teamNameFontSize("주말 축구 모임")).toBe(88);
    expect(teamNameFontSize("주말마다 만나는 동기")).toBe(72);
    expect(teamNameFontSize("주말마다 만나는 대학 동기 모임")).toBe(60);
  });
  it("한 줄을 넘는 낱말만 글자 단위로 끊는다", () => {
    expect(teamNameWordBreak("주말마다 만나는 대학 동기", 72)).toBe("keep-all");
    expect(teamNameWordBreak("서울대학교컴퓨터공학부동기", 60)).toBe("break-all");
  });
});
