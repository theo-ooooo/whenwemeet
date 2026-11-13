import { describe, expect, it } from "vitest";
import { charCount, clampChars, nearLimit } from "../chars";

describe("chars", () => {
  it("코드포인트로 세고 자른다", () => {
    expect(charCount("가😀")).toBe(2);
    expect(clampChars("가나다", 2)).toBe("가나");
  });

  it("(#378) 글자 수는 상한의 80% 부터 보인다", () => {
    expect(nearLimit(23, 30)).toBe(false);
    expect(nearLimit(24, 30)).toBe(true);
    expect(nearLimit(30, 30)).toBe(true);
    expect(nearLimit(39, 50)).toBe(false);
    expect(nearLimit(40, 50)).toBe(true);
    expect(nearLimit(399, 500)).toBe(false);
    expect(nearLimit(400, 500)).toBe(true);
  });
});
