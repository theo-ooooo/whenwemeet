import { describe, expect, it } from "vitest";
import {
  activityHref,
  activityPhrase,
  activitySubline,
  groupNewsByDay,
  knownNewsItems,
  newsDateLabel,
  newsDayOf,
  newsHref,
  newsKey,
  newsKindOf,
  newsPhrase,
} from "../news-copy";
import type { ActivityNewsItem, ActivityType, NewsItem } from "../types";

type Item = Pick<NewsItem, "action" | "repeat" | "scope" | "occurrence" | "eventCode">;
const it0: Item = { action: "CREATED", repeat: null, scope: null, occurrence: null, eventCode: "evntcode" };

describe("newsPhrase (설계 4-3)", () => {
  it("한 번짜리는 예전 문구", () => {
    expect(newsPhrase(it0)).toBe("일정을 추가했어요");
    expect(newsPhrase({ ...it0, action: "UPDATED" })).toBe("일정을 수정했어요");
    expect(newsPhrase({ ...it0, action: "DELETED", eventCode: null })).toBe("일정을 삭제했어요");
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
    expect(newsHref({ ...it0, action: "DELETED" })).toBeNull();
    expect(newsHref({ ...it0, eventCode: null })).toBeNull();
  });
  it("이 일정만은 그 회차로, 이후 모두와 새 반복은 첫 회차로", () => {
    expect(newsHref(it0)).toBe("/events/evntcode/edit");
    expect(newsHref({ ...it0, action: "UPDATED", repeat: "WEEKLY", scope: "THIS", occurrence: "2026-11-18" })).toBe(
      "/events/evntcode/edit?occurrence=2026-11-18",
    );
    expect(newsHref({ ...it0, action: "UPDATED", repeat: "WEEKLY", scope: "FOLLOWING", occurrence: "2026-11-18" })).toBe("/events/evntcode/edit");
    // 원본이 지워졌거나 삭제 기록이면 이동 없음
    expect(newsHref({ ...it0, action: "UPDATED", eventCode: null })).toBeNull();
    expect(newsHref({ ...it0, action: "DELETED" })).toBeNull();
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
    expect(activityPhrase(ann("ANNIVERSARY_CREATED"))).toBe("기념일 ‘처음 만난 날’을 추가했어요");
    expect(activityPhrase(ann("ANNIVERSARY_DELETED", { name: "하늘 생일", date: "2000-05-05", kind: "YEARLY" }))).toBe("기념일 ‘하늘 생일’을 삭제했어요");
    expect(activityPhrase(ann("ANNIVERSARY_CREATED", { name: "결혼기념일 파티", date: "2026-01-01", kind: "ONCE" }))).toBe(
      "기념일 ‘결혼기념일 파티’를 추가했어요",
    );
  });

  it("activityPhrase: 수정은 바뀐 필드 하나면 그 필드, 여럿이면 수정했어요", () => {
    const base = { name: "처음 만난 날", date: "2026-11-22", kind: "COUNT_UP" as const };
    expect(activityPhrase(ann("ANNIVERSARY_UPDATED", { ...base, changed: ["date"], before: { date: "2026-11-21" } }))).toBe(
      "기념일 ‘처음 만난 날’의 날짜를 바꿨어요",
    );
    expect(activityPhrase(ann("ANNIVERSARY_UPDATED", { ...base, changed: ["kind"], before: { kind: "ONCE" } }))).toBe(
      "기념일 ‘처음 만난 날’의 종류를 바꿨어요",
    );
    expect(activityPhrase(ann("ANNIVERSARY_UPDATED", { ...base, name: "첫 만남", changed: ["name"], before: { name: "처음 만난 날" } }))).toBe(
      "기념일 ‘처음 만난 날’의 이름을 ‘첫 만남’으로 바꿨어요",
    );
    expect(activityPhrase(ann("ANNIVERSARY_UPDATED", { ...base, name: "우리 날", changed: ["name"], before: { name: "처음" } }))).toBe(
      "기념일 ‘처음’의 이름을 ‘우리 날’로 바꿨어요",
    );
    expect(activityPhrase(ann("ANNIVERSARY_UPDATED", { ...base, changed: ["name", "date"], before: { name: "x", date: "2026-11-21" } }))).toBe(
      "기념일 ‘처음 만난 날’을 수정했어요",
    );
  });

  it("activityPhrase: 멤버와 팀 이름", () => {
    expect(activityPhrase({ type: "MEMBER_JOINED", payload: {} })).toBe("팀에 들어왔어요");
    expect(activityPhrase({ type: "MEMBER_JOINED", payload: { via: "EVENT_SHARE" } })).toBe("일정 링크로 팀에 들어왔어요");
    expect(activityPhrase({ type: "MEMBER_LEFT", payload: {} })).toBe("팀을 나갔어요");
    expect(activityPhrase({ type: "MEMBER_DELETED", payload: {} })).toBe("서비스를 떠났어요");
    expect(activityPhrase({ type: "GROUP_RENAMED", payload: { from: "우리집", to: "우리 가족" } })).toBe("팀 이름을 ‘우리집’에서 ‘우리 가족’으로 바꿨어요");
    expect(activityPhrase({ type: "GROUP_RENAMED", payload: { from: "우리 가족", to: "우리 둘" } })).toBe("팀 이름을 ‘우리 가족’에서 ‘우리 둘’로 바꿨어요");
    // (#279)
    expect(activityPhrase({ type: "EVENTS_IMPORTED", payload: { count: 1234 } })).toBe("일정 1,234개를 가져왔어요");
  });

  it("activityHref: 기념일 추가, 수정은 기념일 화면, 합류와 팀 이름은 팀 설정, 삭제와 나가기는 이동 없음", () => {
    expect(activityHref({ type: "ANNIVERSARY_CREATED" })).toBe("/anniversaries");
    expect(activityHref({ type: "ANNIVERSARY_UPDATED" })).toBe("/anniversaries");
    expect(activityHref({ type: "ANNIVERSARY_DELETED" })).toBeNull();
    expect(activityHref({ type: "MEMBER_JOINED" })).toBe("/team");
    expect(activityHref({ type: "GROUP_RENAMED" })).toBe("/team");
    expect(activityHref({ type: "EVENTS_IMPORTED" })).toBe("/calendar");
    expect(activityHref({ type: "MEMBER_LEFT" })).toBeNull();
    expect(activityHref({ type: "MEMBER_DELETED" })).toBeNull();
  });

  it("(#190) 참석 여부: 문구, 그 일정(회차) 상세로 이동, 둘째 줄은 일정 날짜와 시각", () => {
    const payload = {
      eventId: 5,
      eventCode: "evntcode",
      occurrence: null,
      title: "저녁 약속",
      startsAt: "2026-11-20T10:00:00.000Z",
      endsAt: "2026-11-20T12:00:00.000Z",
      allDay: false,
      status: "GOING" as const,
    };
    expect(activityPhrase({ type: "EVENT_RSVP", payload })).toBe("‘저녁 약속’에 참석으로 답했어요");
    expect(activityPhrase({ type: "EVENT_RSVP", payload: { ...payload, status: "NOT_GOING" } })).toBe("‘저녁 약속’에 불참으로 답했어요");
    expect(activityPhrase({ type: "EVENT_RSVP", payload: { ...payload, status: "MAYBE" } })).toBe("‘저녁 약속’에 미정으로 답했어요");
    expect(activityHref({ type: "EVENT_RSVP", payload })).toBe("/events/evntcode");
    expect(activityHref({ type: "EVENT_RSVP", payload: { ...payload, occurrence: "2026-11-20" } })).toBe("/events/evntcode?occurrence=2026-11-20");
    expect(activitySubline({ type: "EVENT_RSVP", payload }, "2026-11-11")).toBe("11월 20일 (금) 오후 7:00 ~ 9:00");
    expect(
      knownNewsItems([
        {
          kind: "ACTIVITY",
          id: 1,
          type: "EVENT_RSVP",
          actor: { userId: 1, displayName: "a", color: "#000000", profileImageUrl: null },
          anniversaryId: null,
          payload,
          createdAt: "",
          isNew: false,
        },
      ]),
    ).toHaveLength(1);
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
    const future = { kind: "ACTIVITY", id: 2, type: "TODO_DONE", payload: {} } as unknown as ActivityNewsItem;
    const unknownKind = { kind: "POLL", id: 3 } as unknown as NewsItem;
    expect(knownNewsItems([event, eventV2, activity, future, unknownKind])).toEqual([event, eventV2, activity]);
    expect([event, eventV2, activity].map(newsKey)).toEqual(["EVENT:1", "EVENT:1", "ACTIVITY:1"]);
  });
});

describe("(#189) 약속 투표 새 소식", () => {
  const closed = {
    pollId: 1,
    code: "poll1xxx",
    title: "저녁 약속",
    eventId: 9,
    eventCode: "evnt9xxx",
    startsAt: "2026-11-22T10:00:00.000Z",
    endsAt: "2026-11-22T12:00:00.000Z",
    allDay: false,
  };
  it("문구: 열었어요, 시간을 정했어요. 정한 시간은 둘째 줄", () => {
    expect(activityPhrase({ type: "POLL_CREATED", payload: { title: "저녁 약속" } })).toBe("‘저녁 약속’ 투표를 열었어요");
    expect(activityPhrase({ type: "POLL_CLOSED", payload: closed })).toBe("‘저녁 약속’ 시간을 정했어요");
    expect(activitySubline({ type: "POLL_CLOSED", payload: closed }, "2026-11-13")).toBe("11월 22일 (일) 오후 7:00 ~ 9:00");
    expect(
      activitySubline(
        { type: "POLL_CLOSED", payload: { ...closed, startsAt: "2026-11-21T15:00:00.000Z", endsAt: "2026-11-22T15:00:00.000Z", allDay: true } },
        "2026-11-13",
      ),
    ).toBe("11월 22일 (일) 종일");
    expect(activitySubline({ type: "POLL_CREATED", payload: { title: "x" } }, "2026-11-13")).toBeNull();
  });
  it("누르면: 열림은 투표 화면, 정함은 그 일정 (코드가 없으면 투표, 그것도 없으면 이동 없음)", () => {
    expect(activityHref({ type: "POLL_CREATED", payload: { code: "poll1xxx" } })).toBe("/polls/poll1xxx");
    expect(activityHref({ type: "POLL_CLOSED", payload: closed })).toBe("/events/evnt9xxx");
    expect(activityHref({ type: "POLL_CLOSED", payload: { code: "poll1xxx" } })).toBe("/polls/poll1xxx");
    expect(activityHref({ type: "POLL_CREATED", payload: {} })).toBeNull();
  });
  it("아는 종류라 거르지 않는다", () => {
    const item = {
      kind: "ACTIVITY",
      id: 1,
      type: "POLL_CLOSED",
      actor: { userId: 2, displayName: "하늘", color: "#5B6CF4", profileImageUrl: null },
      anniversaryId: null,
      payload: closed,
      createdAt: "",
      isNew: true,
    } as ActivityNewsItem;
    expect(knownNewsItems([item])).toHaveLength(1);
  });
});

describe("(#378) 새 소식 묶음과 종류 아이콘", () => {
  const TODAY = "2026-11-13"; // 금요일
  it("오늘, 어제, 이번 주(일요일부터, #437), 이전. 시각은 KST 날짜로", () => {
    expect(newsDayOf("2026-11-12T15:30:00.000Z", TODAY)).toBe("오늘"); // KST 13일 00:30
    expect(newsDayOf("2026-11-12T14:30:00.000Z", TODAY)).toBe("어제"); // KST 12일 23:30
    expect(newsDayOf("2026-11-10T03:00:00.000Z", TODAY)).toBe("이번 주"); // 화요일
    expect(newsDayOf("2026-11-09T00:00:00.000Z", TODAY)).toBe("이번 주"); // 월요일 9시
    expect(newsDayOf("2026-11-08T03:00:00.000Z", TODAY)).toBe("이번 주"); // 이번 주 일요일
    expect(newsDayOf("2026-11-07T03:00:00.000Z", TODAY)).toBe("이전"); // 지난 토요일
  });
  it("월요일에는 어제(일요일)도 '어제'", () => {
    expect(newsDayOf("2026-11-15T03:00:00.000Z", "2026-11-16")).toBe("어제");
    expect(newsDayOf("2026-11-14T03:00:00.000Z", "2026-11-16")).toBe("이전");
  });
  it("받은 순서를 지키며 묶는다", () => {
    const at = (iso: string) => ({ createdAt: iso });
    const groups = groupNewsByDay([at("2026-11-13T01:00:00Z"), at("2026-11-12T22:00:00Z"), at("2026-11-12T01:00:00Z"), at("2026-11-01T01:00:00Z")], TODAY);
    expect(groups.map((g) => [g.day, g.items.length])).toEqual([
      ["오늘", 2],
      ["어제", 1],
      ["이전", 1],
    ]);
    expect(groupNewsByDay([], TODAY)).toEqual([]);
  });
  it("종류: 일정 기록과 가져오기는 일정, 기념일, 팀, 투표, 참석", () => {
    const act = (type: ActivityType) => ({ kind: "ACTIVITY", id: 1, type, payload: {} }) as unknown as ActivityNewsItem;
    expect(newsKindOf({ id: 1, action: "CREATED" } as NewsItem)).toBe("event");
    expect(newsKindOf(act("EVENTS_IMPORTED"))).toBe("event");
    expect(newsKindOf(act("ANNIVERSARY_UPDATED"))).toBe("anniversary");
    expect(newsKindOf(act("MEMBER_JOINED"))).toBe("team");
    expect(newsKindOf(act("GROUP_RENAMED"))).toBe("team");
    expect(newsKindOf(act("POLL_CLOSED"))).toBe("poll");
    expect(newsKindOf(act("EVENT_RSVP"))).toBe("rsvp");
  });
});

describe("(#562) 음력 기념일 새 소식 둘째 줄", () => {
  it("음력이면 '음력 3월 15일', 올해가 아니면 연도, 윤달", () => {
    const base = { type: "ANNIVERSARY_CREATED" as const, payload: { name: "제사", date: "2026-03-15", kind: "YEARLY" as const, calendar: "LUNAR" as const } };
    expect(activitySubline(base, "2026-11-26")).toBe("음력 3월 15일, 매년 반복");
    expect(activitySubline({ ...base, payload: { ...base.payload, date: "2025-06-15", isLeapMonth: true as const } }, "2026-11-26")).toBe(
      "음력 2025년 윤6월 15일, 매년 반복",
    );
  });
});
