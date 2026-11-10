import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL, supportMailto } from "../support";

describe("supportMailto", () => {
  it("지원 주소로 가고 제목에 서비스 이름을 붙인다", () => {
    const url = supportMailto("계정 삭제 요청");
    expect(url.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true);
    expect(decodeURIComponent(url.split("subject=")[1])).toBe("[언제볼까] 계정 삭제 요청");
  });
});
