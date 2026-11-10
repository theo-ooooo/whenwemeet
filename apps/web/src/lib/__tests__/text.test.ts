import { describe, expect, it } from "vitest";
import { eulReul, eunNeun, iGa, nameProblem } from "../text";

describe("조사", () => {
  it("받침 유무", () => {
    expect(eulReul("닉네임")).toBe("닉네임을");
    expect(eulReul("팀 이름")).toBe("팀 이름을");
    expect(eulReul("메모")).toBe("메모를");
    expect(eunNeun("표시 이름")).toBe("표시 이름은");
    expect(eunNeun("ABC")).toBe("ABC는");
    expect(iGa("지우")).toBe("지우가");
  });
});

// 이름 바꾸기 공통 규칙 (#171)
describe("nameProblem", () => {
  it("비면 입력 요청, 비워도 되는 칸은 통과", () => {
    expect(nameProblem("닉네임", "  ", 20)).toBe("닉네임을 입력해 주세요");
    expect(nameProblem("표시 이름", "", 20, true)).toBeNull();
  });
  it("길이는 코드포인트로 센다", () => {
    expect(nameProblem("팀 이름", "가".repeat(30), 30)).toBeNull();
    expect(nameProblem("팀 이름", "가".repeat(31), 30)).toBe("팀 이름은 30자까지 쓸 수 있어요");
    expect(nameProblem("닉네임", "😀".repeat(20), 20)).toBeNull();
  });
});
