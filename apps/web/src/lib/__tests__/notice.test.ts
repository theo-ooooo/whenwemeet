import { describe, expect, it } from "vitest";
import { noticeDate, noticeHref, noticeParagraphs, noticeReadVia, noticeSegments, readRateText } from "../notice";
import { noticePushNote, noticeStatTiles, unreadTargetCount } from "../notice-stats";
import type { NoticeStats } from "../types";

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
    expect(segs.map((s) => (s.type === "text" ? s.text : s.href)).join("")).toBe(text.replace('https://x"', 'https://x"'));
  });

  it("게시일, 초안", () => {
    expect(noticeDate(null)).toBe("초안");
    expect(noticeDate("2026-11-25T03:00:00.000Z")).toBe("2026년 11월 25일 (수)");
  });
});

describe("공지 읽은 경로와 결과 (#544)", () => {
  it("상세 주소: 경로를 주면 ?from=, 주지 않으면 그대로", () => {
    expect(noticeHref(3)).toBe("/notices/3");
    expect(noticeHref(3, "push")).toBe("/notices/3?from=push");
    expect(noticeHref(3, "popup")).toBe("/notices/3?from=popup");
    expect(noticeHref(3, "banner")).toBe("/notices/3?from=banner");
    expect(noticeHref(3, "list")).toBe("/notices/3?from=list");
  });

  it("?from= 원문 → 경로. 없거나 모르는 값, detail 은 detail. 여럿이면 첫 값", () => {
    expect(noticeReadVia("push")).toBe("push");
    expect(noticeReadVia(["popup", "push"])).toBe("popup");
    expect(noticeReadVia("banner")).toBe("banner");
    expect(noticeReadVia("list")).toBe("list");
    expect(noticeReadVia(undefined)).toBe("detail");
    expect(noticeReadVia(null)).toBe("detail");
    expect(noticeReadVia("detail")).toBe("detail");
    expect(noticeReadVia("email")).toBe("detail");
  });

  it("읽은 비율 문구: 반올림 퍼센트, 기준이 없으면 -", () => {
    expect(readRateText(null)).toBe("-");
    expect(readRateText(2 / 3)).toBe("67%");
    expect(readRateText(1)).toBe("100%");
    expect(readRateText(0)).toBe("0%");
  });

  const base: NoticeStats = {
    noticeId: 1,
    publishedAt: "2026-11-22T00:00:00.000Z",
    pushedAt: "2026-11-22T00:00:00.000Z",
    push: { status: "DISPATCHED", dispatchedAt: "2026-11-22T00:00:10.000Z", targetUsers: 5, devices: 5, sent: 4, delivered: 3, failed: 2, pending: 0 },
    reads: { total: 4, byVia: { list: 1, detail: 1, push: 1, popup: 0, banner: 1 }, pushOpened: 1 },
    readRate: 0.6,
    readRateBasis: { of: "push", read: 3, total: 5 },
  };

  it("결과 칸 여섯: 푸시 대상(기기), 전달 성공(보낸 기기), 실패(0 보다 크면 경고), 읽음, 푸시로 연 사람, 읽은 비율(기준)", () => {
    expect(noticeStatTiles(base)).toEqual([
      { label: "푸시 대상", value: "5", hint: "기기 5대" },
      { label: "전달 성공", value: "3", hint: "보낸 기기 4대" },
      { label: "실패", value: "2", hint: "보내기 실패, 영수증 오류", warn: true },
      { label: "읽음", value: "4", hint: "로그인한 사람만" },
      { label: "푸시로 연 사람", value: "1" },
      { label: "읽은 비율", value: "60%", hint: "푸시 대상 5명 중 3명" },
    ]);
    expect(noticePushNote(base)).toBeNull();
    expect(unreadTargetCount(base)).toBe(2);
  });

  it("푸시를 보내지 않은 공지: 푸시 칸은 -, 비율은 전체 사용자 기준, 안 읽은 사람 필터 없음", () => {
    const quiet: NoticeStats = { ...base, pushedAt: null, push: null, readRate: 0.25, readRateBasis: { of: "users", read: 4, total: 16 } };
    const tiles = noticeStatTiles(quiet);
    expect(tiles.slice(0, 3).map((t) => t.value)).toEqual(["-", "-", "-"]);
    expect(tiles[2].warn).toBe(false);
    expect(tiles[5]).toEqual({ label: "읽은 비율", value: "25%", hint: "전체 16명 중 4명" });
    expect(noticePushNote(quiet)).toContain("푸시를 보내지 않은 공지");
    expect(unreadTargetCount(quiet)).toBeNull();
  });

  it("푸시 상태 한 줄: 준비 중, 보내지 못함, 결과 기다림", () => {
    const push = base.push!;
    expect(noticePushNote({ ...base, push: { ...push, status: "PENDING", targetUsers: 0, devices: 0 } })).toContain("준비 중");
    expect(noticePushNote({ ...base, push: { ...push, status: "SKIPPED" } })).toContain("보내지 못했어요");
    expect(noticePushNote({ ...base, push: { ...push, pending: 2 } })).toBe("기기 2대는 아직 결과를 기다리고 있어요");
  });
});
