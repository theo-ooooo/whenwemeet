import { describe, expect, it } from "vitest";
import { newsDateLabel, newsHref, newsPhrase } from "../news-copy";
import type { NewsItem } from "../types";

type Item = Pick<NewsItem, "action" | "repeat" | "scope" | "occurrence" | "eventId">;
const it0: Item = { action: "CREATED", repeat: null, scope: null, occurrence: null, eventId: 7 };

describe("newsPhrase (설계 4-3)", () => {
  it("한 번짜리는 예전 문구", () => {
    expect(newsPhrase(it0)).toBe("일정을 추가했어요");
    expect(newsPhrase({ ...it0, action: "UPDATED" })).toBe("일정을 수정했어요");
    expect(newsPhrase({ ...it0, action: "DELETED", eventId: null })).toBe("일정을 삭제했어요");
  });
  it("새 반복 일정은 주기 이름", () => {
    expect(newsPhrase({ ...it0, repeat: "WEEKLY" })).toBe("매주 반복 일정을 추가했어요");
    expect(newsPhrase({ ...it0, repeat: "BIWEEKLY" })).toBe("격주 반복 일정을 추가했어요");
    expect(newsPhrase({ ...it0, repeat: "MONTHLY" })).toBe("매월 반복 일정을 추가했어요");
    expect(newsPhrase({ ...it0, repeat: "YEARLY" })).toBe("매년 반복 일정을 추가했어요");
  });
  it("수정, 삭제는 범위와 회차 날짜", () => {
    const r = { ...it0, repeat: "WEEKLY" as const, occurrence: "2026-11-18" };
    expect(newsPhrase({ ...r, action: "UPDATED", scope: "THIS" })).toBe("11월 18일 일정만 수정했어요");
    expect(newsPhrase({ ...r, action: "UPDATED", scope: "FOLLOWING" })).toBe("11월 18일부터 반복 일정을 수정했어요");
    expect(newsPhrase({ ...r, action: "DELETED", scope: "THIS" })).toBe("11월 18일 일정을 삭제했어요");
    expect(newsPhrase({ ...r, action: "DELETED", scope: "FOLLOWING" })).toBe("11월 18일부터 반복을 삭제했어요");
  });
  it("반복을 켠 한 번짜리 수정(범위 없음)은 그냥 수정", () => {
    expect(newsPhrase({ ...it0, action: "UPDATED", repeat: "WEEKLY" })).toBe("일정을 수정했어요");
  });
});

describe("newsHref", () => {
  it("삭제, 일정 없음은 이동 없음", () => {
    expect(newsHref(2, { ...it0, action: "DELETED" })).toBeNull();
    expect(newsHref(2, { ...it0, eventId: null })).toBeNull();
  });
  it("이 일정만은 그 회차로, 이후 모두와 새 반복은 첫 회차로", () => {
    expect(newsHref(2, it0)).toBe("/g/2/events/7");
    expect(newsHref(2, { ...it0, action: "UPDATED", repeat: "WEEKLY", scope: "THIS", occurrence: "2026-11-18" })).toBe("/g/2/events/7?occurrence=2026-11-18");
    expect(newsHref(2, { ...it0, action: "UPDATED", repeat: "WEEKLY", scope: "FOLLOWING", occurrence: "2026-11-18" })).toBe("/g/2/events/7");
  });
});

describe("newsDateLabel — 시각 줄 날짜 (QA3-L6)", () => {
  it("올해 회차는 연도 없이", () => {
    expect(newsDateLabel("2026-11-27T19:00:00+09:00", "2026-11-11")).toBe("11월 27일 (금)");
  });

  it("다른 해 회차는 연도를 붙인다 (앞, 뒤 모두)", () => {
    expect(newsDateLabel("2024-02-29T09:00:00+09:00", "2026-11-11")).toBe("2024년 2월 29일 (목)");
    expect(newsDateLabel("2027-01-05T09:00:00+09:00", "2026-11-11")).toBe("2027년 1월 5일 (화)");
  });

  it("연도는 KST 기준 (UTC 로는 전해인 1월 1일 00:30)", () => {
    expect(newsDateLabel("2026-12-31T15:30:00Z", "2026-11-11")).toBe("2027년 1월 1일 (금)");
    expect(newsDateLabel("2027-01-01T00:30:00+09:00", "2027-01-01")).toBe("1월 1일 (금)");
  });
});
