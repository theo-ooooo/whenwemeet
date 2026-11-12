import { describe, expect, it } from "vitest";
import { activityHref, activityPhrase, activitySubline, knownNewsItems, newsDateLabel, newsHref, newsKey, newsPhrase } from "../news-copy";
import type { ActivityNewsItem, ActivityType, NewsItem } from "../types";

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

describe("팀 활동 줄 (#191)", () => {
  type A = Pick<ActivityNewsItem, "type" | "payload">;
  const ann = (type: ActivityType, payload: A["payload"] = { name: "처음 만난 날", date: "2026-11-22", kind: "COUNT_UP" }): A => ({ type, payload });

  it("activityPhrase: 기념일 추가, 삭제는 받침에 맞는 조사", () => {
    expect(activityPhrase(ann("ANNIVERSARY_CREATED"))).toBe("기념일 '처음 만난 날'을 추가했어요");
    expect(activityPhrase(ann("ANNIVERSARY_DELETED", { name: "하늘 생일", date: "2000-05-05", kind: "YEARLY" }))).toBe("기념일 '하늘 생일'을 삭제했어요");
    expect(activityPhrase(ann("ANNIVERSARY_CREATED", { name: "결혼기념일 파티", date: "2026-01-01", kind: "ONCE" }))).toBe("기념일 '결혼기념일 파티'를 추가했어요");
  });

  it("activityPhrase: 수정은 바뀐 필드 하나면 그 필드, 여럿이면 수정했어요", () => {
    const base = { name: "처음 만난 날", date: "2026-11-22", kind: "COUNT_UP" as const };
    expect(activityPhrase(ann("ANNIVERSARY_UPDATED", { ...base, changed: ["date"], before: { date: "2026-11-21" } }))).toBe("기념일 '처음 만난 날'의 날짜를 바꿨어요");
    expect(activityPhrase(ann("ANNIVERSARY_UPDATED", { ...base, changed: ["kind"], before: { kind: "ONCE" } }))).toBe("기념일 '처음 만난 날'의 종류를 바꿨어요");
    expect(activityPhrase(ann("ANNIVERSARY_UPDATED", { ...base, name: "첫 만남", changed: ["name"], before: { name: "처음 만난 날" } }))).toBe(
      "기념일 '처음 만난 날'의 이름을 '첫 만남'으로 바꿨어요",
    );
    expect(activityPhrase(ann("ANNIVERSARY_UPDATED", { ...base, name: "우리 날", changed: ["name"], before: { name: "처음" } }))).toBe("기념일 '처음'의 이름을 '우리 날'로 바꿨어요");
    expect(activityPhrase(ann("ANNIVERSARY_UPDATED", { ...base, changed: ["name", "date"], before: { name: "x", date: "2026-11-21" } }))).toBe("기념일 '처음 만난 날'을 수정했어요");
  });

  it("activityPhrase: 멤버와 팀 이름", () => {
    expect(activityPhrase({ type: "MEMBER_JOINED", payload: {} })).toBe("팀에 들어왔어요");
    expect(activityPhrase({ type: "MEMBER_JOINED", payload: { via: "EVENT_SHARE" } })).toBe("일정 링크로 팀에 들어왔어요");
    expect(activityPhrase({ type: "MEMBER_LEFT", payload: {} })).toBe("팀을 나갔어요");
    expect(activityPhrase({ type: "MEMBER_DELETED", payload: {} })).toBe("서비스를 떠났어요");
    expect(activityPhrase({ type: "GROUP_RENAMED", payload: { from: "우리집", to: "우리 가족" } })).toBe("팀 이름을 '우리집'에서 '우리 가족'으로 바꿨어요");
    expect(activityPhrase({ type: "GROUP_RENAMED", payload: { from: "우리 가족", to: "우리 둘" } })).toBe("팀 이름을 '우리 가족'에서 '우리 둘'로 바꿨어요");
    // (#279)
    expect(activityPhrase({ type: "EVENTS_IMPORTED", payload: { count: 1234 } })).toBe("일정 1,234개를 가져왔어요");
  });

  it("activityHref: 기념일 추가, 수정은 기념일 화면, 합류와 팀 이름은 팀 설정, 삭제와 나가기는 이동 없음", () => {
    expect(activityHref(2, { type: "ANNIVERSARY_CREATED" })).toBe("/g/2/anniversaries");
    expect(activityHref(2, { type: "ANNIVERSARY_UPDATED" })).toBe("/g/2/anniversaries");
    expect(activityHref(2, { type: "ANNIVERSARY_DELETED" })).toBeNull();
    expect(activityHref(2, { type: "MEMBER_JOINED" })).toBe("/g/2/settings");
    expect(activityHref(2, { type: "GROUP_RENAMED" })).toBe("/g/2/settings");
    expect(activityHref(2, { type: "EVENTS_IMPORTED" })).toBe("/g/2/calendar");
    expect(activityHref(2, { type: "MEMBER_LEFT" })).toBeNull();
    expect(activityHref(2, { type: "MEMBER_DELETED" })).toBeNull();
  });

  it("activitySubline: 기념일만 날짜와 종류, 다른 해는 연도", () => {
    expect(activitySubline(ann("ANNIVERSARY_CREATED"), "2026-11-11")).toBe("11월 22일, 함께한 날 세기");
    expect(activitySubline(ann("ANNIVERSARY_DELETED", { name: "생일", date: "2000-05-05", kind: "YEARLY" }), "2026-11-11")).toBe("2000년 5월 5일, 매년 반복");
    expect(activitySubline({ type: "GROUP_RENAMED", payload: { from: "a", to: "b" } }, "2026-11-11")).toBeNull();
    expect(activitySubline({ type: "MEMBER_JOINED", payload: {} }, "2026-11-11")).toBeNull();
  });

  it("knownNewsItems: kind 없는 옛 일정과 아는 활동만, 모르는 종류는 거른다. 키는 kind:id", () => {
    const event = { id: 1, action: "CREATED", eventId: 7 } as NewsItem;
    const eventV2 = { ...event, kind: "EVENT" } as NewsItem;
    const activity = { kind: "ACTIVITY", id: 1, type: "MEMBER_JOINED", payload: {} } as unknown as ActivityNewsItem;
    const future = { kind: "ACTIVITY", id: 2, type: "EVENT_RSVP", payload: {} } as unknown as ActivityNewsItem;
    const unknownKind = { kind: "POLL", id: 3 } as unknown as NewsItem;
    expect(knownNewsItems([event, eventV2, activity, future, unknownKind])).toEqual([event, eventV2, activity]);
    expect([event, eventV2, activity].map(newsKey)).toEqual(["EVENT:1", "EVENT:1", "ACTIVITY:1"]);
  });
});
