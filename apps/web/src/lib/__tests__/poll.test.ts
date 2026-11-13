import { describe, expect, it } from "vitest";
import {
  candidateFromSlot,
  deadlineOf,
  deadlineText,
  defaultPick,
  draftProblem,
  hasOption,
  manualOption,
  optionLabel,
  optionParts,
  responseText,
  sortOptions,
  startRange,
  toggledVotes,
  tomorrowDeadline,
  topOptionIds,
  voterCountOf,
} from "../poll";
import { pollCodeOf, pollHref } from "../routes";
import type { Member, Poll } from "../types";

const kst = (local: string) => new Date(`${local}+09:00`).toISOString();
const TODAY = "2026-11-13";
const member = (userId: number): Member => ({ userId, displayName: `m${userId}`, color: "#F26D6D", profileImageUrl: null });

describe("빈 시간 구간 → 후보 (#189 설계 5-1)", () => {
  const slot = { startsAt: kst("2026-11-14T13:00"), endsAt: kst("2026-11-14T19:00") };
  it("기본은 구간 시작부터 최소 길이, 시작을 옮기면 같은 길이로. 구간이 짧으면 구간 그대로", () => {
    expect(candidateFromSlot(slot, 120)).toEqual({ startsAt: kst("2026-11-14T13:00"), endsAt: kst("2026-11-14T15:00"), allDay: false });
    expect(candidateFromSlot(slot, 120, kst("2026-11-14T16:30"))).toEqual({ startsAt: kst("2026-11-14T16:30"), endsAt: kst("2026-11-14T18:30"), allDay: false });
    expect(candidateFromSlot({ startsAt: kst("2026-11-14T13:00"), endsAt: kst("2026-11-14T14:00") }, 120).endsAt).toBe(kst("2026-11-14T14:00"));
  });
  it("시작 시각 범위: 구간 시작 ~ 끝 - 최소 길이 (30분 단위, 하루 안 분)", () => {
    expect(startRange(slot, 120)).toEqual({ day: "2026-11-14", from: 13 * 60, to: 17 * 60 });
    expect(startRange({ startsAt: kst("2026-11-14T13:00"), endsAt: kst("2026-11-14T15:00") }, 120)).toEqual({ day: "2026-11-14", from: 780, to: 780 });
  });
});

describe("표기", () => {
  it("후보 한 줄: 같은 오전/오후는 끝 쪽 생략, 다르면 둘 다, 종일, 여러 날 종일, 다른 해", () => {
    expect(optionLabel({ startsAt: kst("2026-11-22T19:00"), endsAt: kst("2026-11-22T21:00"), allDay: false }, TODAY)).toBe("11월 22일 (일) 오후 7:00~9:00");
    expect(optionLabel({ startsAt: kst("2026-11-22T11:00"), endsAt: kst("2026-11-22T13:00"), allDay: false }, TODAY)).toBe("11월 22일 (일) 오전 11:00~오후 1:00");
    expect(optionLabel({ startsAt: kst("2026-11-22T00:00"), endsAt: kst("2026-11-23T00:00"), allDay: true }, TODAY)).toBe("11월 22일 (일) 종일");
    expect(optionLabel({ startsAt: kst("2026-11-22T00:00"), endsAt: kst("2026-11-24T00:00"), allDay: true }, TODAY)).toBe("11월 22일 (일) ~ 11월 23일 (월) 종일");
    expect(optionLabel({ startsAt: kst("2027-01-02T10:00"), endsAt: kst("2027-01-02T11:00"), allDay: false }, TODAY)).toBe("2027년 1월 2일 (토) 오전 10:00~11:00");
    expect(optionParts({ startsAt: kst("2026-11-22T19:00"), endsAt: kst("2026-11-22T21:00"), allDay: false }, TODAY)).toEqual({ date: "11월 22일 (일)", time: "오후 7:00~9:00" });
  });
  it("마감과 응답 수", () => {
    expect(deadlineText({ status: "OPEN", expired: false, deadline: kst("2026-11-14T21:00") }, TODAY)).toBe("11월 14일 (토) 오후 9:00까지");
    expect(deadlineText({ status: "OPEN", expired: true, deadline: kst("2026-11-12T21:00") }, TODAY)).toBe("투표가 끝났어요");
    expect(deadlineText({ status: "OPEN", expired: false, deadline: null }, TODAY)).toBeNull();
    expect(deadlineText({ status: "CLOSED", expired: false, deadline: null }, TODAY)).toBeNull();
    expect(responseText({ voterCount: 2, targetCount: 3 })).toBe("3명 중 2명 답했어요");
    expect(responseText({ voterCount: 0, targetCount: 3 })).toBe("아직 아무도 답하지 않았어요");
  });
});

describe("만들기", () => {
  const a = { startsAt: kst("2026-11-22T19:00"), endsAt: kst("2026-11-22T21:00"), allDay: false };
  const b = { startsAt: kst("2026-11-21T12:00"), endsAt: kst("2026-11-21T14:00"), allDay: false };
  const now = Date.parse(kst("2026-11-13T12:00"));
  it("검사: 제목, 후보 2~5개, 지난 후보", () => {
    expect(draftProblem({ title: " ", options: [a, b], now })).toBe("제목을 적어 주세요");
    expect(draftProblem({ title: "x".repeat(51), options: [a, b], now })).toContain("50자");
    expect(draftProblem({ title: "저녁", options: [a], now })).toBe("후보를 2개 이상 골라 주세요");
    expect(draftProblem({ title: "저녁", options: [a, b, a, b, a, b], now })).toBe("후보는 5개까지 고를 수 있어요");
    expect(draftProblem({ title: "저녁", options: [a, { ...b, startsAt: kst("2026-11-13T11:00") }], now })).toContain("지난 시간");
    expect(draftProblem({ title: "저녁", options: [a, b], now })).toBeNull();
  });
  it("직접 추가: 시간, 자정 넘김, 24:00, 종일. 중복 판정과 정렬", () => {
    expect(manualOption({ date: "2026-11-20", allDay: false, start: "19:00", end: "21:00" })).toEqual({ startsAt: kst("2026-11-20T19:00"), endsAt: kst("2026-11-20T21:00"), allDay: false });
    expect(manualOption({ date: "2026-11-20", allDay: false, start: "22:00", end: "01:00" }).endsAt).toBe(kst("2026-11-21T01:00"));
    expect(manualOption({ date: "2026-11-20", allDay: false, start: "22:00", end: "24:00" }).endsAt).toBe(kst("2026-11-21T00:00"));
    expect(manualOption({ date: "2026-11-20", allDay: true, start: "", end: "" })).toEqual({ startsAt: kst("2026-11-20T00:00"), endsAt: kst("2026-11-21T00:00"), allDay: true });
    expect(hasOption([a], { ...a })).toBe(true);
    expect(sortOptions([a, b])).toEqual([b, a]);
  });
  it("마감: 없음, 내일 이맘때(30분 올림), 직접", () => {
    const at = Date.parse(kst("2026-11-13T12:10"));
    expect(deadlineOf("none", { date: "2026-11-14", time: "21:00" }, at)).toBeNull();
    expect(tomorrowDeadline(at)).toBe(kst("2026-11-14T12:30"));
    expect(deadlineOf("custom", { date: "2026-11-14", time: "21:00" }, at)).toBe(kst("2026-11-14T21:00"));
  });
});

describe("투표 화면", () => {
  const options = [
    { id: 1, voters: [member(1), member(2)], past: false },
    { id: 2, voters: [member(2)], past: false },
    { id: 3, voters: [member(1), member(2), member(3)], past: true },
  ];
  it("가장 많은 후보(지난 후보 제외, 0표면 없음)와 기본 선택(하나일 때만)", () => {
    expect(topOptionIds(options)).toEqual([1]);
    expect(topOptionIds([{ id: 1, voters: [], past: false }])).toEqual([]);
    expect(defaultPick({ status: "OPEN", options: options as Poll["options"] })).toBe(1);
    expect(defaultPick({ status: "OPEN", options: [{ ...options[0] }, { ...options[1], voters: [member(1), member(3)] }] as Poll["options"] })).toBeNull();
    expect(defaultPick({ status: "CLOSED", options: options as Poll["options"] })).toBeNull();
  });
  it("내 표 켜고 끄기, 대상 중 답한 사람 수", () => {
    expect(toggledVotes([3, 1], 2, true)).toEqual([1, 2, 3]);
    expect(toggledVotes([1, 2], 2, false)).toEqual([1]);
    expect(voterCountOf({ options: options as Poll["options"], participants: { all: false, members: [member(1), member(2)] } })).toBe(2);
  });
  it("주소", () => {
    expect(pollHref({ publicCode: "poll1xxx" })).toBe("/polls/poll1xxx");
    expect(pollCodeOf("/polls/POLL1XXX")).toBe("poll1xxx");
    expect(pollCodeOf("/polls/bad")).toBeNull();
    expect(pollCodeOf("/polls")).toBeNull();
    expect(pollCodeOf("/todos/poll1xxx")).toBeNull();
  });
});
