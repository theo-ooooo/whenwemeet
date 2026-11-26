// (#190) 참석 여부와 반응 공용 규칙
import { describe, expect, it } from "vitest";
import { applyMyReaction, applyMyRsvp, isParticipant, nextReaction, occurrenceQuery, rsvpSummaryText, showRsvp } from "../rsvp";
import type { Event, Member, RsvpSummary } from "../types";

const m = (userId: number, displayName = `멤버${userId}`): Member => ({ userId, displayName, color: "#3B82F6", profileImageUrl: null });
const SUM: RsvpSummary = { going: 0, notGoing: 0, maybe: 0, pending: 2, mine: null };
const ev = (over: Partial<Event> = {}): Event =>
  ({
    id: 1,
    groupId: 2,
    publicCode: "evntcode",
    title: "저녁",
    startsAt: "2026-11-20T10:00:00.000Z",
    endsAt: "2026-11-20T12:00:00.000Z",
    allDay: false,
    creator: m(1),
    createdAt: "",
    updatedAt: "",
    repeat: null,
    repeatUntil: null,
    occurrence: null,
    seriesStartsAt: null,
    repeatAnchor: null,
    participants: { all: false, members: [m(1), m(2)] },
    rsvp: SUM,
    ...over,
  }) as Event;
const NOW = Date.parse("2026-11-19T00:00:00.000Z");

describe("rsvp (#190)", () => {
  it("isParticipant: 모두면 누구나, 아니면 목록에 있는 사람. 내 id 를 모르면 false", () => {
    expect(isParticipant(ev(), 2)).toBe(true);
    expect(isParticipant(ev(), 3)).toBe(false);
    expect(isParticipant(ev({ participants: { all: true, members: [m(1)] } }), 9)).toBe(true);
    expect(isParticipant(ev(), null)).toBe(false);
  });

  it("showRsvp: 개인 팀, 옛 API(집계 없음), 참여자 없음이면 숨김", () => {
    expect(showRsvp(ev(), false)).toBe(true);
    expect(showRsvp(ev(), true)).toBe(false);
    expect(showRsvp(ev({ rsvp: undefined }), false)).toBe(false);
    expect(showRsvp(ev({ participants: { all: false, members: [] } }), false)).toBe(false);
  });

  it("rsvpSummaryText: 0 인 칸은 빼고, 아무도 답하지 않았으면 안내 문장", () => {
    expect(rsvpSummaryText({ going: 3, notGoing: 0, maybe: 1, pending: 2, mine: null })).toBe("참석 3, 미정 1, 응답 전 2");
    expect(rsvpSummaryText({ going: 0, notGoing: 2, maybe: 0, pending: 0, mine: null })).toBe("불참 2");
    expect(rsvpSummaryText(SUM)).toBe("아직 아무도 답하지 않았어요");
  });

  it("applyMyRsvp: 이전 값에서 빼고 새 값에 더한다. null 은 응답 전으로", () => {
    const a = applyMyRsvp(SUM, "GOING");
    expect(a).toEqual({ going: 1, notGoing: 0, maybe: 0, pending: 1, mine: "GOING" });
    const b = applyMyRsvp(a, "NOT_GOING");
    expect(b).toEqual({ going: 0, notGoing: 1, maybe: 0, pending: 1, mine: "NOT_GOING" });
    expect(applyMyRsvp(b, null)).toEqual(SUM);
  });

  it("반응: 같은 걸 다시 누르면 취소, 다른 걸 누르면 바꾼다", () => {
    const empty = { LIKE: 1, EXCITED: 0, ACK: 0, mine: null };
    expect(nextReaction(null, "LIKE")).toBe("LIKE");
    expect(nextReaction("LIKE", "LIKE")).toBeNull();
    expect(nextReaction("LIKE", "ACK")).toBe("ACK");
    const liked = applyMyReaction(empty, "LIKE");
    expect(liked).toEqual({ LIKE: 2, EXCITED: 0, ACK: 0, mine: "LIKE" });
    expect(applyMyReaction(liked, "ACK")).toEqual({ LIKE: 1, EXCITED: 0, ACK: 1, mine: "ACK" });
    expect(applyMyReaction(liked, null)).toEqual(empty);
  });

  it("occurrenceQuery: 반복 회차만 날짜, 한 번짜리는 생략", () => {
    expect(occurrenceQuery(ev())).toBeUndefined();
    expect(occurrenceQuery(ev({ repeat: "WEEKLY", occurrence: "2026-11-20" }))).toBe("2026-11-20");
  });
});
