import { eventRowTime } from "../event-row";
import { describe, expect, it } from "vitest";
import { kstToIso } from "../date";
import { dayLabel, groupPast, groupUpcoming, lastDayOf, pastWindow, monthBreak, upcomingDayOf, upcomingWindow, windowRangeText } from "../upcoming";
import type { Anniversary, Event, Member } from "../types";

const who: Member = { userId: 1, displayName: "지우", color: "#5B6CF4", profileImageUrl: null };
const TODAY = "2026-11-11"; // 수요일

let seq = 0;
function ev(start: string, end: string, extra: Partial<Event> = {}): Event {
  seq += 1;
  return {
    id: seq,
    groupId: 2,
    title: `일정${seq}`,
    startsAt: start,
    endsAt: end,
    allDay: false,
    memo: undefined,
    creator: who,
    createdAt: start,
    updatedAt: start,
    repeat: null,
    repeatUntil: null,
    occurrence: null,
    seriesStartsAt: null,
    repeatAnchor: null,
    ...extra,
  } as Event;
}
const at = (k: string, t: string) => kstToIso(k, t);
const allDay = (from: string, toExclusive: string, extra: Partial<Event> = {}) => ev(kstToIso(from), kstToIso(toExclusive), { allDay: true, ...extra });
const ann = (id: number, date: string, kind: Anniversary["kind"]): Anniversary => ({
  id,
  groupId: 2,
  name: `기념${id}`,
  date,
  kind,
  creator: who,
  createdAt: date,
});

// 지금 = 오늘 09:00 KST
const NOW = Date.parse(at(TODAY, "09:00"));
const W0 = upcomingWindow(TODAY, 0);

describe("upcomingWindow", () => {
  it("30일씩 이어 붙는다", () => {
    expect(W0).toEqual({ from: "2026-11-11", to: "2026-12-11" });
    expect(upcomingWindow(TODAY, 1)).toEqual({ from: "2026-12-11", to: "2027-01-10" });
  });
  it("범위 글자", () => {
    expect(windowRangeText(upcomingWindow(TODAY, 1))).toBe("12월 11일 ~ 1월 9일");
  });
});

describe("dayLabel", () => {
  it("오늘, 내일, 그 밖은 요일", () => {
    expect(dayLabel(TODAY, TODAY)).toBe("오늘");
    expect(dayLabel("2026-11-12", TODAY)).toBe("내일");
    expect(dayLabel("2026-11-13", TODAY)).toBe("금");
  });
});

describe("KST 경계", () => {
  it("UTC 로는 전날인 KST 새벽 일정도 그 KST 날에 묶인다", () => {
    // 11-12 00:30 KST = 11-11 15:30Z
    const e = ev("2026-11-11T15:30:00.000Z", "2026-11-11T16:30:00.000Z");
    expect(upcomingDayOf(e, TODAY)).toBe("2026-11-12");
  });
  it("KST 23:59 시작은 그날", () => {
    const e = ev(at("2026-11-12", "23:59"), at("2026-11-13", "00:30"));
    expect(upcomingDayOf(e, TODAY)).toBe("2026-11-12");
  });
  it("창 끝(30일째 다음 자정) 에 시작하는 일정은 다음 창", () => {
    const e = ev(at("2026-12-11", "00:00"), at("2026-12-11", "01:00"));
    expect(groupUpcoming([e], [], W0, TODAY, NOW)).toEqual([]);
    expect(groupUpcoming([e], [], upcomingWindow(TODAY, 1), TODAY, NOW).map((d) => d.date)).toEqual(["2026-12-11"]);
  });
});

// (#378 B) 줄의 시각 글자는 공통 일정 줄(EventRow)의 eventRowTime 을 묶인 날 기준으로 쓴다
describe("여러 날 일정", () => {
  it("시작한 날 하나에만 두고 시각 글자에 끝 날짜", () => {
    const e = ev(at("2026-11-12", "22:00"), at("2026-11-14", "02:00"));
    const days = groupUpcoming([e], [], W0, TODAY, NOW);
    expect(days.map((d) => d.date)).toEqual(["2026-11-12"]);
    expect(eventRowTime(e, "2026-11-12")).toBe("오후 10:00 ~ 11월 14일 오전 2:00");
  });
  it("자정을 넘기는 짧은 일정도 끝 날짜를 쓴다", () => {
    const e = ev(at("2026-11-12", "23:00"), at("2026-11-13", "01:00"));
    expect(eventRowTime(e, "2026-11-12")).toBe("오후 11:00 ~ 11월 13일 오전 1:00");
  });
  it("자정에 딱 끝나면 같은 날로 본다", () => {
    const e = ev(at("2026-11-12", "22:00"), at("2026-11-13", "00:00"));
    expect(lastDayOf(e)).toBe("2026-11-12");
    expect(eventRowTime(e, "2026-11-12")).toBe("오후 10:00 ~ 오전 12:00");
  });
  it("여러 날 종일은 '종일, ~마지막 날'", () => {
    const e = allDay("2026-11-12", "2026-11-15");
    expect(lastDayOf(e)).toBe("2026-11-14");
    expect(eventRowTime(e, "2026-11-12")).toBe("종일 ~11월 14일");
    expect(eventRowTime(allDay("2026-11-12", "2026-11-13"), "2026-11-12")).toBe("종일");
  });
  it("이미 시작해 진행 중이면 오늘에, 끝만 적는다", () => {
    const e = ev(at("2026-11-10", "20:00"), at(TODAY, "18:00"));
    const f = allDay("2026-11-09", "2026-11-14");
    const days = groupUpcoming([e, f], [], W0, TODAY, NOW);
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe(TODAY);
    expect(eventRowTime(e, TODAY)).toBe("~ 오후 6:00");
    expect(eventRowTime(f, TODAY)).toBe("종일 ~11월 13일");
    const g = ev(at("2026-11-10", "20:00"), at("2026-11-12", "02:00"));
    expect(eventRowTime(g, TODAY)).toBe("종일 ~11월 12일");
  });
  it("두 창에 걸쳐 와도 한 창에만 (시작한 날 기준)", () => {
    const e = ev(at("2026-12-10", "20:00"), at("2026-12-12", "10:00"));
    const w1 = upcomingWindow(TODAY, 1);
    expect(groupUpcoming([e], [], W0, TODAY, NOW).map((d) => d.date)).toEqual(["2026-12-10"]);
    expect(groupUpcoming([e], [], w1, TODAY, NOW)).toEqual([]);
  });
});

describe("groupUpcoming", () => {
  it("끝난 일정은 빼고, 지금 진행 중인 것은 남긴다", () => {
    const done = ev(at(TODAY, "07:00"), at(TODAY, "08:00"));
    const live = ev(at(TODAY, "08:30"), at(TODAY, "10:00"));
    const days = groupUpcoming([done, live], [], W0, TODAY, NOW);
    expect(days[0].events.map((e) => e.id)).toEqual([live.id]);
  });
  it("반복 회차는 id 가 같아도 회차마다, 같은 회차가 두 번 오면 한 번", () => {
    const a = ev(at("2026-11-12", "10:00"), at("2026-11-12", "11:00"), { occurrence: "2026-11-12", repeat: "WEEKLY" });
    const b = { ...a, startsAt: at("2026-11-19", "10:00"), endsAt: at("2026-11-19", "11:00"), occurrence: "2026-11-19" };
    const days = groupUpcoming([a, b, { ...a }], [], W0, TODAY, NOW);
    expect(days.map((d) => [d.date, d.events.length])).toEqual([
      ["2026-11-12", 1],
      ["2026-11-19", 1],
    ]);
  });
  it("같은 날: 여러 날 종일 → 종일 → 시간, 그다음 시작 순", () => {
    const t2 = ev(at("2026-11-13", "15:00"), at("2026-11-13", "16:00"));
    const t1 = ev(at("2026-11-13", "09:00"), at("2026-11-13", "10:00"));
    const one = allDay("2026-11-13", "2026-11-14");
    const multi = allDay("2026-11-13", "2026-11-16");
    const days = groupUpcoming([t2, t1, one, multi], [], W0, TODAY, NOW);
    expect(days[0].events.map((e) => e.id)).toEqual([multi.id, one.id, t1.id, t2.id]);
  });
  it("라벨, 날짜 숫자, 색 (오늘, 주말과 공휴일)", () => {
    const days = groupUpcoming(
      [
        ev(at(TODAY, "12:00"), at(TODAY, "13:00")),
        ev(at("2026-11-12", "12:00"), at("2026-11-12", "13:00")),
        ev(at("2026-11-14", "12:00"), at("2026-11-14", "13:00")),
        ev(at("2026-12-25", "12:00"), at("2026-12-25", "13:00")),
        ev(at("2026-12-01", "12:00"), at("2026-12-01", "13:00")),
      ],
      [],
      upcomingWindow(TODAY, 0),
      TODAY,
      NOW,
    );
    expect(days.map((d) => [d.date, d.label, d.day, d.tone])).toEqual([
      [TODAY, "오늘", 11, "today"],
      ["2026-11-12", "내일", 12, "plain"],
      ["2026-11-14", "토", 14, "holiday"],
      ["2026-12-01", "화", 1, "plain"],
    ]);
    const w1 = groupUpcoming([ev(at("2026-12-25", "12:00"), at("2026-12-25", "13:00"))], [], upcomingWindow(TODAY, 1), TODAY, NOW);
    expect(w1[0].tone).toBe("holiday"); // 성탄절
  });
  it("기념일 항목은 그날 묶음에, 기념일만 있는 날도 묶음", () => {
    // 2026-08-14 시작 → 100일 = 11-21. 매년 11-30
    const list = [ann(1, "2026-08-14", "COUNT_UP"), ann(2, "2000-11-30", "YEARLY")];
    const e = ev(at("2026-11-21", "18:00"), at("2026-11-21", "20:00"));
    const days = groupUpcoming([e], list, W0, TODAY, NOW);
    expect(days.map((d) => [d.date, d.anniversaries.map((o) => o.label ?? o.anniversary.name), d.events.length])).toEqual([
      ["2026-11-21", ["100일"], 1],
      ["2026-11-30", ["기념2"], 0],
    ]);
  });
  it("비면 빈 배열", () => {
    expect(groupUpcoming(null, null, W0, TODAY, NOW)).toEqual([]);
  });
});

describe("monthBreak", () => {
  it("처음과 달이 바뀌는 곳에만, 해가 다르면 연도", () => {
    expect(monthBreak(null, "2026-11-12", TODAY)).toBe("11월");
    expect(monthBreak("2026-11-12", "2026-11-30", TODAY)).toBeNull();
    expect(monthBreak("2026-11-30", "2026-12-01", TODAY)).toBe("12월");
    expect(monthBreak("2026-12-31", "2027-01-02", TODAY)).toBe("2027년 1월");
  });
});

describe("(#192) 지난 일정 pastWindow, groupPast", () => {
  it("창 1 은 오늘 포함 지난 30일, 창 2 는 그 앞 30일", () => {
    expect(pastWindow(TODAY, 1)).toEqual({ from: "2026-10-13", to: "2026-11-12" });
    expect(pastWindow(TODAY, 2)).toEqual({ from: "2026-09-13", to: "2026-10-13" });
  });

  it("끝난 일정만 시작한 날에 묶고, 날짜 오름차순", () => {
    const now = Date.parse(at(TODAY, "15:00"));
    const morning = ev(at(TODAY, "09:00"), at(TODAY, "10:00"));
    const ongoing = ev(at(TODAY, "14:00"), at(TODAY, "16:00"));
    const yesterday = ev(at("2026-11-10", "18:00"), at("2026-11-10", "20:00"));
    const allDay = ev(at("2026-11-08", "00:00"), at("2026-11-09", "00:00"), { allDay: true });
    const old = ev(at("2026-10-01", "10:00"), at("2026-10-01", "11:00"));
    const days = groupPast([morning, ongoing, yesterday, allDay, old, yesterday], pastWindow(TODAY, 1), TODAY, now);
    expect(days.map((d) => [d.date, d.label, d.tone, d.events.map((e) => e.id)])).toEqual([
      ["2026-11-08", "일", "holiday", [allDay.id]],
      ["2026-11-10", "어제", "plain", [yesterday.id]],
      ["2026-11-11", "오늘", "today", [morning.id]],
    ]);
  });

  it("앞 창에서 시작해 이번 창에 끝난 일정은 시작한 날의 창에만", () => {
    const now = Date.parse(at(TODAY, "15:00"));
    const cross = ev(at("2026-10-12", "22:00"), at("2026-10-13", "02:00"));
    expect(groupPast([cross], pastWindow(TODAY, 1), TODAY, now)).toEqual([]);
    expect(groupPast([cross], pastWindow(TODAY, 2), TODAY, now).map((d) => d.date)).toEqual(["2026-10-12"]);
  });
});
