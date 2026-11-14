// (#378) 일정 줄: 시각 글자 한 번, 지난 일정, 보일 참여자, 내 참석, 읽기 이름
import { describe, expect, it } from "vitest";
import { clockRangeText, clockText, formatEventTime, kstToIso } from "../date";
import { eventRowLabel, eventRowTime, isPastEvent, myRsvpOf, visibleParticipants } from "../event-row";
import type { Member, RsvpSummary } from "../types";

const at = (day: string, hm = "00:00") => kstToIso(day, hm);
const m = (id: number, name: string): Member => ({ userId: id, displayName: name, color: "#F26D6D", profileImageUrl: null });
const timed = (s: string, e: string, sd = "2026-11-17", ed = sd) => ({ startsAt: at(sd, s), endsAt: at(ed, e), allDay: false });
const allDay = (sd: string, edExclusive: string) => ({ startsAt: at(sd), endsAt: at(edExclusive), allDay: true });
const rsvp = (mine: RsvpSummary["mine"]): RsvpSummary => ({ going: 1, maybe: 0, notGoing: 0, pending: 1, mine });

describe("시각 글자", () => {
  it("오전/오후, 0시와 12시", () => {
    expect(clockText(at("2026-11-17", "00:05"))).toBe("오전 12:05");
    expect(clockText(at("2026-11-17", "12:00"))).toBe("오후 12:00");
    expect(clockText(at("2026-11-17", "18:30"))).toBe("오후 6:30");
  });

  it("같은 오전/오후면 끝은 숫자만, 바뀌면 끝에도 붙인다", () => {
    expect(clockRangeText(at("2026-11-17", "08:00"), at("2026-11-17", "09:00"))).toBe("오전 8:00 ~ 9:00");
    expect(clockRangeText(at("2026-11-17", "11:00"), at("2026-11-17", "13:00"))).toBe("오전 11:00 ~ 오후 1:00");
  });

  it("(QA 2026-11-14) formatEventTime(사이드바, 새 소식) 은 시작한 날의 일정 줄 글자와 같다", () => {
    const cases = [
      timed("19:30", "22:00"),
      timed("11:00", "13:00"),
      timed("22:00", "00:00", "2026-11-17", "2026-11-18"),
      timed("22:00", "02:00", "2026-11-17", "2026-11-18"),
      allDay("2026-11-17", "2026-11-18"),
      allDay("2026-11-17", "2026-11-20"),
    ];
    for (const ev of cases) expect(formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)).toBe(eventRowTime(ev));
    expect(formatEventTime(at("2026-11-17", "19:30"), at("2026-11-17", "22:00"), false)).toBe("오후 7:30 ~ 10:00");
    expect(formatEventTime(at("2026-11-17", "22:00"), at("2026-11-18"), false)).toBe("오후 10:00 ~ 오전 12:00");
    expect(formatEventTime(at("2026-11-17", "22:00"), at("2026-11-18", "02:00"), false)).toBe("오후 10:00 ~ 11월 18일 오전 2:00");
    expect(formatEventTime(at("2026-11-17"), at("2026-11-20"), true)).toBe("종일 ~11월 19일");
  });

  it("하루 시간 일정, 종일 하루", () => {
    expect(eventRowTime(timed("08:00", "09:00"))).toBe("오전 8:00 ~ 9:00");
    expect(eventRowTime(allDay("2026-11-17", "2026-11-18"))).toBe("종일");
  });

  it("여러 날 종일: 마지막 날 전까지 '종일 ~11월 22일', 마지막 날은 '종일'", () => {
    const ev = allDay("2026-11-20", "2026-11-23");
    expect(eventRowTime(ev)).toBe("종일 ~11월 22일");
    expect(eventRowTime(ev, "2026-11-21")).toBe("종일 ~11월 22일");
    expect(eventRowTime(ev, "2026-11-22")).toBe("종일");
  });

  it("여러 날 시간 일정: 시작한 날, 가운데 날, 끝나는 날", () => {
    const ev = timed("22:00", "02:00", "2026-11-20", "2026-11-23");
    expect(eventRowTime(ev)).toBe("오후 10:00 ~ 11월 23일 오전 2:00");
    expect(eventRowTime(ev, "2026-11-21")).toBe("종일 ~11월 23일");
    expect(eventRowTime(ev, "2026-11-23")).toBe("~ 오전 2:00");
  });

  it("자정에 끝나는 시간 일정은 하루짜리", () => {
    expect(eventRowTime(timed("22:00", "00:00", "2026-11-17", "2026-11-18"))).toBe("오후 10:00 ~ 오전 12:00");
  });
});

describe("지난 일정, 참여자, 참석", () => {
  it("끝 시각이 지금 이전이면 지난 일정", () => {
    const ev = timed("08:00", "09:00");
    expect(isPastEvent(ev, Date.parse(at("2026-11-17", "09:00")))).toBe(true);
    expect(isPastEvent(ev, Date.parse(at("2026-11-17", "08:59")))).toBe(false);
  });

  it("개인 팀이면 아바타 없음, 전원도 일부와 같이 앞 3명 + 수 (#442)", () => {
    const creator = m(1, "지우");
    const four = { creator, participants: { all: false, members: [m(1, "지우"), m(2, "하늘"), m(3, "민지"), m(4, "지훈")] } };
    expect(visibleParticipants({ creator, participants: { all: true, members: [creator] } }, false)).toEqual({ members: [creator], more: 0 });
    expect(visibleParticipants({ creator, participants: { all: true, members: [creator] } }, true)).toEqual({ members: [], more: 0 });
    expect(visibleParticipants(four, true)).toEqual({ members: [], more: 0 });
    const v = visibleParticipants(four, false);
    expect(v.members.map((x) => x.displayName)).toEqual(["지우", "하늘", "민지"]);
    expect(v.more).toBe(1);
    // 옛 API(participants 없음)는 등록자 한 명
    expect(visibleParticipants({ creator }, false).members).toEqual([creator]);
  });

  it("내 참석: 고른 값만, 개인 팀과 집계 없는 옛 API 는 null", () => {
    const creator = m(1, "지우");
    const base = { creator, participants: { all: false, members: [creator] } };
    expect(myRsvpOf({ ...base, rsvp: rsvp("GOING") }, false)).toBe("GOING");
    expect(myRsvpOf({ ...base, rsvp: rsvp(null) }, false)).toBeNull();
    expect(myRsvpOf({ ...base, rsvp: rsvp("MAYBE") }, true)).toBeNull();
    expect(myRsvpOf(base, false)).toBeNull();
  });

  it("읽기 이름: 제목, 날짜, 시각, 사람, 장소, 내 응답, 그 밖, 지난 일정 순", () => {
    const creator = m(1, "지우");
    const ev = { title: "치과", ...timed("11:00", "12:00"), creator, participants: { all: false, members: [creator, m(2, "하늘")] }, rsvp: rsvp("GOING") };
    expect(eventRowLabel(ev, { who: { meId: 1, personal: false }, dateText: "11월 17일 (화)", place: "사랑니치과", extra: ["매주", null], past: true })).toBe(
      "치과, 11월 17일 (화), 오전 11:00 ~ 오후 12:00, 나, 하늘, 장소 사랑니치과, 내 응답 참석, 매주, 지난 일정",
    );
    expect(eventRowLabel(ev, { who: { meId: 1, personal: true } })).toBe("치과, 오전 11:00 ~ 오후 12:00");
  });
});
