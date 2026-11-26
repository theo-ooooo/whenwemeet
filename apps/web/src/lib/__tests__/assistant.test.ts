// (#450) AI 비서 순수 계산: history 만들기, 카드 → 저장 본문, [고치기] 주소, 웹 투표 초안, X-Client-Source, 카드 글자
import { describe, expect, it } from "vitest";
import {
  buildHistory,
  canPollFrom,
  cardOfChoice,
  editChanges,
  eventPatchOf,
  targetScope,
  type EventTarget,
  clientSourceOf,
  dailyLimited,
  ddayText,
  draftLunarText,
  draftWhenText,
  editSource,
  eventEditHref,
  eventInputOf,
  examplePrompts,
  freeQueryText,
  nextKstMidnight,
  participantsParam,
  pollDraftFromSlots,
  pollInputOf,
  pollSheetMinutes,
  rowEventOf,
  slotEditHref,
  type AssistantCard,
  type ChatMessage,
  type FreeQuery,
} from "../assistant";

const kst = (local: string) => new Date(`${local}+09:00`).toISOString();
const member = (userId: number, displayName: string) => ({ userId, displayName, color: "#3B82F6", profileImageUrl: null });

describe("buildHistory", () => {
  it("사용자 글과 볼까 historyText 만, 오류와 웹 카드와 답 못 받은 내 말은 뺀다", () => {
    const messages: ChatMessage[] = [
      { id: 1, role: "user", text: " 회식 잡아줘 " },
      { id: 2, role: "assistant", reply: "이렇게 넣을까요?", cards: [], historyText: "[일정 초안] 회식" },
      { id: 3, role: "local", card: { type: "refusal" } },
      { id: 4, role: "user", text: "날씨" },
      { id: 5, role: "error", text: "연결이 불안정해요", retry: "날씨" },
    ];
    expect(buildHistory(messages)).toEqual([
      { role: "user", text: "회식 잡아줘" },
      { role: "assistant", text: "[일정 초안] 회식" },
    ]);
  });

  it("최근 10턴, 턴마다 600자, 합계 4,000자를 넘으면 오래된 것부터 뺀다", () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 8; i++) {
      messages.push({ id: i * 2, role: "user", text: `질문${i}` });
      messages.push({ id: i * 2 + 1, role: "assistant", reply: "", cards: [], historyText: "가".repeat(700) });
    }
    const h = buildHistory(messages);
    expect(h.every((t) => t.text.length <= 600)).toBe(true);
    expect(h.length).toBeLessThanOrEqual(10);
    expect(h.reduce((n, t) => n + t.text.length, 0)).toBeLessThanOrEqual(4000);
    expect(h[h.length - 1].role).toBe("assistant");
  });
});

const draft = {
  title: "강남 회식",
  startsAt: kst("2030-11-29T19:00"),
  endsAt: kst("2030-11-29T20:00"),
  allDay: false,
  place: { text: "강남" },
  participants: [1, 2],
  members: [member(1, "민지"), member(2, "하늘")],
};

describe("카드 → 저장 본문", () => {
  it("일정 [추가]: 제목, 시각, 참여자, 직접 적은 장소. 알림은 싣지 않는다", () => {
    expect(eventInputOf(draft)).toEqual({ title: "강남 회식", startsAt: draft.startsAt, endsAt: draft.endsAt, allDay: false, participants: [1, 2], place: { text: "강남" } });
    expect(eventInputOf({ ...draft, place: null })).not.toHaveProperty("place");
  });

  it("(#566) 음력으로 말한 초안: 본문 lunarInput, 카드 둘째 줄 음력, [고치기] 는 lunar=1", () => {
    // 2026-11-24 = 음력 10월 16일
    const lunar = { ...draft, startsAt: kst("2026-11-24T19:00"), endsAt: kst("2026-11-24T20:00"), lunarInput: true };
    expect(eventInputOf(lunar)).toMatchObject({ lunarInput: true });
    expect(eventInputOf(draft)).not.toHaveProperty("lunarInput");
    expect(draftLunarText(lunar)).toBe("음력 10월 16일");
    expect(draftLunarText(draft)).toBeNull();
    expect(new URL(eventEditHref(lunar), "http://x").searchParams.get("lunar")).toBe("1");
    expect(new URL(eventEditHref(draft), "http://x").searchParams.has("lunar")).toBe(false);
  });

  it("투표 [투표 열기]: 제목, 후보, 대상 (마감 없음)", () => {
    const options = [{ startsAt: kst("2030-11-30T18:00"), endsAt: kst("2030-11-30T20:00"), allDay: false }];
    expect(pollInputOf({ title: "저녁", options, participants: [1] })).toEqual({ title: "저녁", options, participants: [1] });
  });
});

describe("[고치기] 주소", () => {
  it("새 일정 폼에 제목, 시작, 끝, 참여자, 장소, from=assistant", () => {
    const u = new URL(eventEditHref(draft), "http://x");
    expect(u.pathname).toBe("/events/new");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      title: "강남 회식",
      start: draft.startsAt,
      end: draft.endsAt,
      participants: "1,2",
      place: "강남",
      from: "assistant",
    });
  });

  it("종일은 allDay=1 과 시작 날 10:00, 마지막 날 11:00", () => {
    const u = new URL(eventEditHref({ ...draft, allDay: true, startsAt: kst("2030-11-29T00:00"), endsAt: kst("2030-12-01T00:00"), place: null, participants: [] }), "http://x");
    expect(u.searchParams.get("allDay")).toBe("1");
    expect(u.searchParams.get("start")).toBe(kst("2030-11-29T10:00"));
    expect(u.searchParams.get("end")).toBe(kst("2030-11-30T11:00"));
    expect(u.searchParams.has("participants")).toBe(false);
  });

  it("빈 시간 '이 시간으로 일정': 끝 = 시작 + 최소 길이(구간을 넘지 않게), 대상, 제목", () => {
    const q: FreeQuery = { from: "", to: "", dayStart: "18:00", dayEnd: "22:00", minMinutes: 120, days: "weekend", participants: [1, 2] };
    const u = new URL(slotEditHref({ startsAt: kst("2030-11-30T18:00"), endsAt: kst("2030-11-30T19:00") }, q, "저녁 약속"), "http://x");
    expect(u.searchParams.get("end")).toBe(kst("2030-11-30T19:00"));
    expect(u.searchParams.get("title")).toBe("저녁 약속");
    expect(u.searchParams.get("participants")).toBe("1,2");
  });
});

describe("빈 시간 → 웹 투표 초안 (D-273)", () => {
  const card: Extract<AssistantCard, { type: "freeSlots" }> = {
    type: "freeSlots",
    query: { from: "", to: "", dayStart: "18:00", dayEnd: "22:00", minMinutes: 120, days: "weekend", participants: [1, 2] },
    slots: [
      { startsAt: kst("2030-11-30T18:00"), endsAt: kst("2030-11-30T22:00") },
      { startsAt: kst("2030-12-01T18:00"), endsAt: kst("2030-12-01T19:30") },
    ],
    total: 2,
    pollTitle: null,
  };

  it("제목 기본 '약속', 후보는 최소 길이로 (구간이 짧으면 구간 끝), 대상 멤버", () => {
    const p = pollDraftFromSlots(card, [member(1, "민지"), member(2, "하늘"), member(3, "지훈")]);
    expect(p.draft.title).toBe("약속");
    expect(p.draft.options).toEqual([
      { startsAt: kst("2030-11-30T18:00"), endsAt: kst("2030-11-30T20:00"), allDay: false },
      { startsAt: kst("2030-12-01T18:00"), endsAt: kst("2030-12-01T19:30"), allDay: false },
    ]);
    expect(p.members.map((m) => m.displayName)).toEqual(["민지", "하늘"]);
    expect(pollSheetMinutes(p.draft.options)).toBe(120);
  });

  it("투표 버튼: 팀, 멤버 2명 이상, 후보 2개 이상일 때만", () => {
    expect(canPollFrom([1, 2], { personal: false, memberCount: 2 })).toBe(true);
    expect(canPollFrom([1, 2], { personal: true, memberCount: 1 })).toBe(false);
    expect(canPollFrom([1], { personal: false, memberCount: 3 })).toBe(false);
  });
});

describe("X-Client-Source", () => {
  it("허용 값만", () => {
    expect(clientSourceOf("assistant")).toBe("assistant");
    expect(clientSourceOf("assistant-poll")).toBe("assistant-poll");
    expect(clientSourceOf("evil")).toBeNull();
    expect(clientSourceOf(null)).toBeNull();
  });

  it("[고치기] 폼: 날짜, 시각, 종일을 바꿨으면 assistant-edit-changed", () => {
    const base = { allDay: false, startDate: "2030-11-29", startTime: "19:00", endDate: "2030-11-29", endTime: "20:00" };
    expect(editSource(base, { ...base })).toBe("assistant-edit");
    expect(editSource(base, { ...base, startTime: "20:00" })).toBe("assistant-edit-changed");
    expect(editSource(base, { ...base, allDay: true })).toBe("assistant-edit-changed");
  });
});

describe("participantsParam", () => {
  it("쉼표 id 를 숫자로, 이상한 조각은 버리고 비면 null", () => {
    expect(participantsParam("3,5,x,3")).toEqual([3, 5]);
    expect(participantsParam("abc")).toBeNull();
    expect(participantsParam(null)).toBeNull();
  });
});

describe("카드 글자", () => {
  it("날짜 시각 한 줄", () => {
    expect(draftWhenText(draft)).toBe("11월 29일 (금) 오후 7:00 ~ 8:00");
    expect(draftWhenText({ allDay: true, startsAt: kst("2030-11-29T00:00"), endsAt: kst("2030-11-30T00:00") })).toBe("11월 29일 (금) 하루 종일");
    expect(draftWhenText({ allDay: true, startsAt: kst("2030-11-29T00:00"), endsAt: kst("2030-12-01T00:00") })).toBe("11월 29일 (금) ~ 11월 30일 (토)");
    expect(draftWhenText({ allDay: false, startsAt: kst("2030-11-29T22:00"), endsAt: kst("2030-11-30T02:00") })).toBe("11월 29일 (금) 오후 10:00 ~ 11월 30일 (토) 오전 2:00");
  });

  it("빈 시간 조건 한 줄", () => {
    const q: FreeQuery = { from: "", to: "", dayStart: "18:00", dayEnd: "22:00", minMinutes: 120, days: "weekend", participants: [1, 2, 3] };
    expect(freeQueryText(q)).toBe("주말 저녁, 2시간 이상, 3명");
    expect(freeQueryText({ ...q, days: "all", dayStart: "09:00", dayEnd: "23:00", participants: [1] })).toBe("모든 날, 2시간 이상, 나");
    expect(freeQueryText({ ...q, days: "weekday", dayStart: "10:00", dayEnd: "12:00" })).toBe("평일 10:00~12:00, 2시간 이상, 3명");
  });

  it("D-n", () => {
    expect(ddayText(0)).toBe("오늘");
    expect(ddayText(3)).toBe("D-3");
  });

  it("예시는 팀 크기에 맞춘다", () => {
    expect(examplePrompts({ personal: false, memberCount: 2 })[1]).toContain("둘 다");
    expect(examplePrompts({ personal: false, memberCount: 4 })[1]).toContain("다 같이");
    expect(examplePrompts({ personal: true, memberCount: 1 })[1]).toContain("내 빈 시간");
  });

  it("일정 목록 카드 → 일정 줄 모양", () => {
    const ev = rowEventOf({ id: 7, publicCode: "abcd1234", title: "영화", startsAt: draft.startsAt, endsAt: draft.endsAt, allDay: false, occurrence: null, members: draft.members }, 2);
    expect(ev).toMatchObject({ id: 7, groupId: 2, publicCode: "abcd1234", creator: draft.members[0], participants: { all: false, members: draft.members } });
  });
});

describe("하루 한도", () => {
  const now = Date.parse(kst("2030-11-29T15:00"));
  it("resetAt 이 남았으면 막고, 지나면 푼다. 없으면 used >= limit", () => {
    expect(dailyLimited({ used: 3, limit: 30, resetAt: kst("2030-11-30T00:00") }, now)).toBe(true);
    expect(dailyLimited({ used: 30, limit: 30, resetAt: kst("2030-11-29T00:00") }, now)).toBe(false);
    expect(dailyLimited({ used: 30, limit: 30, resetAt: null }, now)).toBe(true);
    expect(dailyLimited({ used: 29, limit: 30, resetAt: null }, now)).toBe(false);
  });
  it("다음 KST 자정", () => {
    expect(nextKstMidnight(Date.parse(kst("2030-11-29T23:59")))).toBe(kst("2030-11-30T00:00"));
  });
});

describe("(#511) 고치기, 지우기 카드 → 요청 (D-283)", () => {
  const target: EventTarget = {
    id: 7,
    publicCode: "abc123",
    occurrence: null,
    repeat: false,
    title: "회식",
    startsAt: kst("2030-11-29T19:00"),
    endsAt: kst("2030-11-29T21:00"),
    allDay: false,
    place: { text: "홍대" },
    members: [],
  };
  const after = { title: "회식", startsAt: kst("2030-11-29T19:30"), endsAt: kst("2030-11-29T21:30"), allDay: false, place: { text: "홍대" } };

  it("editChanges: 바뀐 칸만", () => {
    expect(editChanges({ target, after })).toEqual({ title: false, time: true, place: false });
    expect(editChanges({ target, after: { ...target, title: "송년회" } })).toEqual({ title: true, time: false, place: false });
    expect(editChanges({ target, after: { ...target, allDay: true } }).time).toBe(true);
    expect(editChanges({ target, after: { ...target, place: null } }).place).toBe(true);
  });

  it("eventPatchOf: 제목, 시각, 종일은 늘, 장소는 바뀌었을 때만(없앴으면 null), 참여자 반복 알림 색은 싣지 않는다", () => {
    expect(eventPatchOf({ target, after })).toEqual({ title: "회식", startsAt: after.startsAt, endsAt: after.endsAt, allDay: false });
    expect(eventPatchOf({ target, after: { ...after, place: { text: "강남" } } }).place).toEqual({ text: "강남" });
    expect(eventPatchOf({ target, after: { ...after, place: null } }).place).toBeNull();
  });

  it("targetScope: 반복 회차는 이 회차만, 한 번짜리는 생략", () => {
    expect(targetScope(target)).toEqual({});
    expect(targetScope({ occurrence: "2030-11-29" })).toEqual({ occurrence: "2030-11-29", scope: "this" });
  });

  it("cardOfChoice: 고른 후보 → 확인 카드", () => {
    expect(cardOfChoice("delete", { target, after: null })).toEqual({ type: "eventDeleteDraft", target });
    expect(cardOfChoice("edit", { target, after })).toEqual({ type: "eventEditDraft", draft: { target, after } });
    expect(cardOfChoice("edit", { target, after: null })).toBeNull();
  });
});
