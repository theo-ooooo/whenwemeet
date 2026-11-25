import { describe, expect, it } from "vitest";
import { noticeDate, noticeParagraphs, noticeSegments } from "../notice";

describe("공지 본문 (#515)", () => {
  it("빈 줄로 문단을 나누고 한 줄 바꿈은 문단 안에 둔다", () => {
    const paras = noticeParagraphs("첫 줄\n둘째 줄\n\n  \n다음 문단\r\n\r\n마지막\n\n\n");
    expect(paras.map((p) => p.map((s) => (s.type === "text" ? s.text : s.href)).join(""))).toEqual(["첫 줄\n둘째 줄", "다음 문단", "마지막"]);
  });

  it("https 주소만 링크, 끝 문장 부호는 뺀다", () => {
    expect(noticeSegments("자세한 내용은 https://whenwemeet.day/support. 참고")).toEqual([
      { type: "text", text: "자세한 내용은 " },
      { type: "link", href: "https://whenwemeet.day/support" },
      { type: "text", text: ". 참고" },
    ]);
    expect(noticeSegments("(https://a.example/x)")).toEqual([
      { type: "text", text: "(" },
      { type: "link", href: "https://a.example/x" },
      { type: "text", text: ")" },
    ]);
  });

  it("주소 뒤에 바로 붙은 한글은 링크에 넣지 않는다 (#519)", () => {
    expect(noticeSegments("웹(https://whenwemeet.day)과 iOS")).toEqual([
      { type: "text", text: "웹(" },
      { type: "link", href: "https://whenwemeet.day" },
      { type: "text", text: ")과 iOS" },
    ]);
    expect(noticeSegments("고객 지원(https://whenwemeet.day/support)으로")).toEqual([
      { type: "text", text: "고객 지원(" },
      { type: "link", href: "https://whenwemeet.day/support" },
      { type: "text", text: ")으로" },
    ]);
    expect(noticeSegments("https://whenwemeet.day에서")).toEqual([
      { type: "link", href: "https://whenwemeet.day" },
      { type: "text", text: "에서" },
    ]);
  });

  it("http, javascript:, HTML 은 글자 그대로", () => {
    const text = 'http://a.example <script>alert(1)</script> javascript:alert(1) <a href="https://x">';
    const segs = noticeSegments(text);
    expect(segs.filter((s) => s.type === "link")).toEqual([{ type: "link", href: "https://x" }]);
    expect(segs.map((s) => (s.type === "text" ? s.text : s.href)).join("")).toBe(text.replace('https://x"', "https://x\""));
  });

  it("게시일, 초안", () => {
    expect(noticeDate(null)).toBe("초안");
    expect(noticeDate("2026-11-25T03:00:00.000Z")).toBe("2026년 11월 25일 (수)");
  });
});
