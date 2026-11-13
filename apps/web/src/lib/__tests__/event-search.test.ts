import { describe, expect, it } from "vitest";
import { highlight, repeatTag, searchDateText, searchHref, searchPreview, searchTimeText } from "../event-search";
import { kstToIso } from "../date";
import type { EventSearchItem } from "../types";

// (#199) 일정 검색 화면 순수 함수
const item = (o: Partial<EventSearchItem["event"]> = {}, matched: EventSearchItem["matched"] = ["title"]): EventSearchItem =>
  ({
    event: { id: 1, title: "치과", startsAt: kstToIso("2026-11-20", "10:00"), endsAt: kstToIso("2026-11-20", "11:00"), allDay: false, memo: null, place: null, repeat: null, ...o },
    group: { id: 1, name: "우리 집", publicCode: "grpcode1" },
    matched,
    upcoming: true,
  }) as EventSearchItem;

describe("event-search", () => {
  it("주소: 검색어와 모든 팀만 싣는다", () => {
    expect(searchHref()).toBe("/search");
    expect(searchHref("치과")).toBe(`/search?q=${encodeURIComponent("치과")}`);
    expect(searchHref("a b", true)).toBe("/search?q=a+b&scope=all");
    expect(searchHref("  ", true)).toBe("/search?scope=all");
  });

  it("강조: 대소문자 무시, 여러 번, 없으면 통째", () => {
    expect(highlight("Cafe cafe", "CAFE")).toEqual([
      { text: "Cafe", hit: true },
      { text: " ", hit: false },
      { text: "cafe", hit: true },
    ]);
    expect(highlight("치과 예약", "예약")).toEqual([
      { text: "치과 ", hit: false },
      { text: "예약", hit: true },
    ]);
    expect(highlight("abc", "z")).toEqual([{ text: "abc", hit: false }]);
    expect(highlight("abc", " ")).toEqual([{ text: "abc", hit: false }]);
  });

  it("미리보기: 메모가 맞으면 그 부분(앞이 길면 …), 장소가 있으면 장소, 아니면 메모 첫 줄", () => {
    const long = `${"가".repeat(30)} 스케일링 예약`;
    expect(searchPreview(item({ memo: long }, ["memo"]), "스케일링")).toEqual({ kind: "memo", text: `…${"가".repeat(17)} 스케일링 예약` });
    expect(searchPreview(item({ memo: "짧은\n메모" }, ["memo"]), "메모")).toEqual({ kind: "memo", text: "짧은 메모" });
    const place = { name: "서울숲", address: "서울 성동구", lat: null, lng: null, kakaoPlaceId: null, url: null };
    expect(searchPreview(item({ place, memo: "x" }), "치과")).toEqual({ kind: "place", text: "서울숲, 서울 성동구" });
    expect(searchPreview(item({ memo: "메모만" }), "치과")).toEqual({ kind: "memo", text: "메모만" });
    expect(searchPreview(item(), "치과")).toBeNull();
  });

  it("날짜는 올해가 아니면 연도, 시각과 반복 표시", () => {
    expect(searchDateText(kstToIso("2026-11-20", "10:00"), "2026-11-13")).toBe("11월 20일 (금)");
    expect(searchDateText(kstToIso("2025-05-01", "10:00"), "2026-11-13")).toBe("2025년 5월 1일 (목)");
    expect(searchTimeText({ startsAt: kstToIso("2026-11-20", "10:00"), endsAt: kstToIso("2026-11-20", "11:00"), allDay: false })).toBe("10:00~11:00");
    expect(searchTimeText({ startsAt: kstToIso("2026-11-20"), endsAt: kstToIso("2026-11-21"), allDay: true })).toBe("종일");
    expect(repeatTag("WEEKLY")).toBe("매주");
    expect(repeatTag(null)).toBeNull();
  });
});
