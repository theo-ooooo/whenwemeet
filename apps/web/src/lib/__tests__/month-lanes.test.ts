import { describe, expect, it } from "vitest";
import { addDays, kstToIso, type DateKey } from "../date";
import { groupByDay, isMultiDay } from "../day-detail";
import { eventDays, fitWeek, packWeek, phoneDayLanes, phoneWeek } from "../month-lanes";
import type { Event, Member } from "../types";

const who: Member = { userId: 1, displayName: "지우", color: "#5B6CF4", profileImageUrl: null };
const ev = (id: number, start: string, end: string, allDay = false, occurrence: string | null = null): Event => ({
  id,
  groupId: 2,
  publicCode: `ev${id}`.padEnd(8, "x"),
  title: `일정${id}`,
  startsAt: start,
  endsAt: end,
  allDay,
  creator: who,
  createdAt: start,
  updatedAt: start,
  repeat: occurrence ? "WEEKLY" : null,
  repeatUntil: null,
  occurrence,
  seriesStartsAt: null,
  repeatAnchor: null,
});
/** 종일 일정: first 부터 last 까지 (끝은 다음날 자정, 배타) */
const allDay = (id: number, first: DateKey, last: DateKey, occurrence: string | null = null) =>
  ev(id, kstToIso(first), kstToIso(addDays(last, 1)), true, occurrence);
const timed = (id: number, day: DateKey, from: string, to: string, endDay: DateKey = day) => ev(id, kstToIso(day, from), kstToIso(endDay, to));

// 2026-11-08 이 일요일. 한 주 = 11-08 ~ 11-14
const week = (sunday: DateKey) => Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
const W1 = week("2026-11-08");
const W2 = week("2026-11-15");
const pack = (days: DateKey[], events: Event[]) => packWeek(days, groupByDay(events), isMultiDay);
const brief = (p: ReturnType<typeof pack>) => p.segments.map((s) => [s.event.id, s.lane, s.col, s.span, s.isStart, s.isEnd]);

describe("eventDays", () => {
  it("종일 끝은 배타 (다음날 자정 = 그 앞날까지)", () => {
    expect(eventDays(allDay(1, "2026-11-10", "2026-11-12"))).toEqual({ first: "2026-11-10", last: "2026-11-12" });
  });
  it("시간 일정이 자정에 끝나면 그날까지, 자정을 넘으면 다음날까지 (KST)", () => {
    expect(eventDays(timed(1, "2026-11-10", "22:00", "00:00", "2026-11-11"))).toEqual({ first: "2026-11-10", last: "2026-11-10" });
    expect(eventDays(timed(2, "2026-11-10", "23:00", "01:00", "2026-11-11"))).toEqual({ first: "2026-11-10", last: "2026-11-11" });
  });
  it("길이 0 일정은 시작 날 하루", () => {
    const t = kstToIso("2026-11-10", "09:00");
    expect(eventDays(ev(1, t, t))).toEqual({ first: "2026-11-10", last: "2026-11-10" });
  });
});

describe("packWeek", () => {
  it("여러 날 일정 하나는 주 안에서 한 조각, 한 날 일정은 singles", () => {
    const p = pack(W1, [allDay(1, "2026-11-10", "2026-11-12"), timed(2, "2026-11-11", "19:00", "21:00")]);
    expect(brief(p)).toEqual([[1, 0, 2, 3, true, true]]);
    expect(p.singles[3].map((e) => e.id)).toEqual([2]);
    expect(p.lanes).toBe(1);
  });

  it("종일 하루짜리는 막대가 아니다 (끝 배타)", () => {
    const p = pack(W1, [allDay(1, "2026-11-10", "2026-11-10")]);
    expect(p.segments).toEqual([]);
    expect(p.singles[2].map((e) => e.id)).toEqual([1]);
  });

  it("주 경계를 넘으면 두 주에 나뉘고, 이어지는 쪽 끝은 각진다", () => {
    const trip = allDay(1, "2026-11-13", "2026-11-17");
    expect(brief(pack(W1, [trip]))).toEqual([[1, 0, 5, 2, true, false]]);
    expect(brief(pack(W2, [trip]))).toEqual([[1, 0, 0, 3, false, true]]);
  });

  it("주 전체를 덮는 일정은 양쪽 다 각진다", () => {
    expect(brief(pack(W1, [allDay(1, "2026-11-01", "2026-11-20")]))).toEqual([[1, 0, 0, 7, false, false]]);
  });

  it("겹치는 일정은 다른 레인, 안 겹치면 낮은 레인을 다시 쓴다", () => {
    const a = allDay(1, "2026-11-09", "2026-11-11"); // 월~수
    const b = allDay(2, "2026-11-10", "2026-11-13"); // 화~금
    const c = allDay(3, "2026-11-12", "2026-11-14"); // 목~토: a 가 끝난 레인 0
    expect(brief(pack(W1, [a, b, c]))).toEqual([
      [1, 0, 1, 3, true, true],
      [2, 1, 2, 4, true, true],
      [3, 0, 4, 3, true, true],
    ]);
  });

  it("같은 날 시작이면 긴 것이 위 레인", () => {
    const short = allDay(1, "2026-11-09", "2026-11-10");
    const long = allDay(2, "2026-11-09", "2026-11-13");
    const p = pack(W1, [short, long]);
    expect(p.segments.map((s) => [s.event.id, s.lane])).toEqual([
      [2, 0],
      [1, 1],
    ]);
  });

  it("앞 주에서 이어진 일정은 주 첫 칸에서 시작한 것으로 줄 세운다", () => {
    const cont = allDay(1, "2026-11-05", "2026-11-09"); // 일~월 (이어짐)
    const fresh = allDay(2, "2026-11-08", "2026-11-12"); // 일~목 (이 주 시작, 더 김)
    const p = pack(W1, [cont, fresh]);
    expect(brief(p)).toEqual([
      [2, 0, 0, 5, true, true],
      [1, 1, 0, 2, false, true],
    ]);
  });

  it("자정을 넘는 시간 일정도 막대 (KST 기준)", () => {
    const night = timed(1, "2026-11-10", "23:00", "02:00", "2026-11-11");
    expect(brief(pack(W1, [night]))).toEqual([[1, 0, 2, 2, true, true]]);
    const toMidnight = timed(2, "2026-11-10", "22:00", "00:00", "2026-11-11");
    const p = pack(W1, [toMidnight]);
    expect(p.segments).toEqual([]);
    expect(p.singles[2].map((e) => e.id)).toEqual([2]);
  });

  it("UTC 로는 같은 날이어도 KST 로 날이 바뀌면 막대 (15:00Z = 자정 KST)", () => {
    const e = ev(1, "2026-11-10T14:00:00.000Z", "2026-11-10T16:00:00.000Z"); // KST 23:00 ~ 01:00
    expect(brief(pack(W1, [e]))).toEqual([[1, 0, 2, 2, true, true]]);
  });

  it("반복 회차는 회차마다 다른 막대 (같은 id, 다른 occurrence)", () => {
    const o1 = allDay(7, "2026-11-08", "2026-11-09", "2026-11-08");
    const o2 = allDay(7, "2026-11-13", "2026-11-15", "2026-11-13");
    const p = pack(W1, [o1, o2]);
    expect(p.segments.map((s) => [s.key, s.lane, s.col, s.span, s.isEnd])).toEqual([
      ["7:2026-11-08", 0, 0, 2, true],
      ["7:2026-11-13", 0, 5, 2, false],
    ]);
  });
});

describe("fitWeek", () => {
  const a = allDay(1, "2026-11-09", "2026-11-11");
  const b = allDay(2, "2026-11-10", "2026-11-13");

  it("자리가 넉넉하면 전부: 칩은 그날 막대가 없는 줄을 위에서부터", () => {
    const s = timed(3, "2026-11-10", "09:00", "10:00");
    const f = fitWeek(pack(W1, [a, b, s]), 3);
    expect(f.pieces.map((p) => [p.event.id, p.lane, p.col, p.span, p.roundStart, p.roundEnd])).toEqual([
      [1, 0, 1, 3, true, true],
      [2, 1, 2, 4, true, true],
    ]);
    expect(f.days[2]).toEqual({ rows: [2], chips: [s], more: 0 });
    expect(f.days[1]).toEqual({ rows: [], chips: [], more: 0 });
    expect(f.days[0]).toEqual({ rows: [], chips: [], more: 0 });
  });

  it("넘치는 날은 마지막 줄이 +N, 숨은 막대와 칩을 그날 기준으로 센다", () => {
    const s1 = timed(3, "2026-11-10", "09:00", "10:00");
    const s2 = timed(4, "2026-11-10", "11:00", "12:00");
    const f = fitWeek(pack(W1, [a, b, s1, s2]), 2);
    // 화(col 2): 레인 2 + 칩 2 = 4 > 2 → 레인 0 만, +3 (b, s1, s2)
    expect(f.days[2]).toEqual({ rows: [], chips: [], more: 3 });
    // 수(col 3): 레인 2 = 2 → 다 들어간다
    expect(f.days[3]).toEqual({ rows: [], chips: [], more: 0 });
    // b 는 화요일에서 숨고 수~금 은 보인다 → 조각이 화요일 다음부터, 왼쪽 각짐
    expect(f.pieces.filter((p) => p.event.id === 2).map((p) => [p.col, p.span, p.roundStart, p.roundEnd])).toEqual([[3, 3, false, true]]);
    expect(f.pieces.filter((p) => p.event.id === 1).map((p) => [p.col, p.span])).toEqual([[1, 3]]);
  });

  it("가운데 날만 넘치면 막대가 그날에서 끊겨 두 조각", () => {
    const long = allDay(1, "2026-11-08", "2026-11-14");
    const s1 = timed(3, "2026-11-11", "09:00", "10:00");
    const s2 = timed(4, "2026-11-11", "11:00", "12:00");
    const f = fitWeek(pack(W1, [long, s1, s2]), 1);
    expect(f.pieces.map((p) => [p.col, p.span, p.roundStart, p.roundEnd])).toEqual([
      [0, 3, true, false],
      [4, 3, false, true],
    ]);
    expect(f.days[3]).toEqual({ rows: [], chips: [], more: 3 });
  });

  it("레인 없이 칩만 넘치면 기존처럼 (capacity - 1) 개 + 나머지 수", () => {
    const evs = [1, 2, 3, 4].map((i) => timed(i, "2026-11-10", `0${i}:00`, `0${i}:30`));
    const f = fitWeek(pack(W1, evs), 3);
    expect(f.days[2].chips.map((e) => e.id)).toEqual([1, 2]);
    expect(f.days[2].rows).toEqual([0, 1]);
    expect(f.days[2].more).toBe(2);
    expect(fitWeek(pack(W1, evs.slice(0, 3)), 3).days[2]).toMatchObject({ more: 0, rows: [0, 1, 2] });
  });

  it("(QA) 위 레인이 비어 있으면 한 날 칩이 그 줄을 쓴다 (폰 phoneWeek 과 같은 규칙)", () => {
    // 11/16~17 막대(레인 0), 11/17~18 막대(레인 1), 11/18 한 날 일정. 수(11/18) 칸은 레인 0 이 비어 있다
    const x = allDay(1, "2026-11-16", "2026-11-17");
    const y = allDay(2, "2026-11-17", "2026-11-18");
    const s = timed(3, "2026-11-18", "09:00", "10:00");
    const f = fitWeek(pack(W2, [x, y, s]), 2);
    // 빈 첫 줄 + "+2개 더" 가 아니라 0번 줄에 칩, 1번 줄에 막대
    expect(f.days[3]).toEqual({ rows: [0], chips: [s], more: 0 });
    // 막대는 레인을 지키고 끊기지 않는다
    expect(f.pieces.map((p) => [p.event.id, p.lane, p.col, p.span, p.roundStart, p.roundEnd])).toEqual([
      [1, 0, 1, 2, true, true],
      [2, 1, 2, 2, true, true],
    ]);
    // 3줄이어도 같은 자리
    expect(fitWeek(pack(W2, [x, y, s]), 3).days[3]).toEqual({ rows: [0], chips: [s], more: 0 });
  });

  it("빈 줄에 칩을 먼저 채우고, 모자라면 마지막 줄이 +N (빈 위 줄도 칩 자리로 센다)", () => {
    const b = allDay(2, "2026-11-10", "2026-11-13");
    const a = allDay(1, "2026-11-09", "2026-11-10");
    // 목(col 4): b 가 레인 1, 레인 0 빈 줄
    const s1 = timed(3, "2026-11-12", "09:00", "10:00");
    const s2 = timed(4, "2026-11-12", "11:00", "12:00");
    const f3 = fitWeek(pack(W1, [a, b, s1, s2]), 3);
    expect(f3.days[4]).toEqual({ rows: [0, 2], chips: [s1, s2], more: 0 });
    const f2 = fitWeek(pack(W1, [a, b, s1, s2]), 2);
    // 2줄: 막대 1 + 칩 2 > 2 → 0번 줄 칩 하나, 1번 줄 "+2" (숨은 막대 b + 칩 s2)
    expect(f2.days[4]).toEqual({ rows: [0], chips: [s1], more: 2 });
  });

  it("주 경계 조각은 둥근 끝을 일정의 진짜 시작, 끝에만", () => {
    const trip = allDay(1, "2026-11-13", "2026-11-17");
    expect(fitWeek(pack(W1, [trip]), 2).pieces.map((p) => [p.roundStart, p.roundEnd])).toEqual([[true, false]]);
    expect(fitWeek(pack(W2, [trip]), 2).pieces.map((p) => [p.roundStart, p.roundEnd])).toEqual([[false, true]]);
  });
});

describe("phoneDayLanes", () => {
  const a = allDay(1, "2026-11-09", "2026-11-11");
  const b = allDay(2, "2026-11-10", "2026-11-13");
  const c = allDay(3, "2026-11-10", "2026-11-11");

  it("레인 자리를 지켜 빈 레인은 null, 끝의 빈 레인은 자른다", () => {
    const p = pack(W1, [a, b]);
    expect(phoneDayLanes(p, 1, 2).lanes.map((s) => s?.event.id ?? null)).toEqual([1]);
    expect(phoneDayLanes(p, 4, 2).lanes.map((s) => s?.event.id ?? null)).toEqual([null, 2]);
    expect(phoneDayLanes(p, 0, 2)).toEqual({ lanes: [], overflow: [] });
  });

  it("레인이 모자라면 남는 막대 일정은 그날 점으로", () => {
    const p = pack(W1, [a, b, c]);
    const day = phoneDayLanes(p, 2, 2);
    expect(day.lanes.map((s) => s?.event.id)).toEqual([1, 2]);
    expect(day.overflow.map((e) => e.id)).toEqual([3]);
    expect(phoneDayLanes(p, 2, 1).overflow.map((e) => e.id)).toEqual([2, 3]);
  });
});

describe("phoneWeek (#355)", () => {
  const briefChips = (w: ReturnType<typeof phoneWeek<Event>>) => w.chips.map((c) => [c.event.id, c.lane, c.col, c.span, c.multi, c.roundStart, c.roundEnd]);

  it("한 날 일정은 칸마다 4줄까지, 넘치면 +N", () => {
    const d = "2026-11-10";
    const evs = [1, 2, 3, 4, 5, 6].map((id) => timed(id, d, `0${id}:00`, `0${id}:30`));
    const w = phoneWeek(pack(W1, evs));
    expect(briefChips(w)).toEqual([1, 2, 3, 4].map((id, i) => [id, i, 2, 1, false, true, true]));
    expect(w.more).toEqual([0, 0, 6 - 4, 0, 0, 0, 0]);
  });

  it("딱 4개면 +N 없음", () => {
    const d = "2026-11-12";
    const w = phoneWeek(
      pack(
        W1,
        [1, 2, 3, 4].map((id) => timed(id, d, `0${id}:00`, `0${id}:30`)),
      ),
    );
    expect(w.chips).toHaveLength(4);
    expect(w.more.every((n) => n === 0)).toBe(true);
  });

  it("여러 날 막대가 먼저 줄을 잡고, 한 날 일정은 그 아래 빈 줄", () => {
    const w = phoneWeek(pack(W1, [timed(2, "2026-11-11", "09:00", "10:00"), allDay(1, "2026-11-10", "2026-11-12")]));
    expect(briefChips(w)).toEqual([
      [1, 0, 2, 3, true, true, true],
      [2, 1, 3, 1, false, true, true],
    ]);
  });

  it("막대 아래 칸이 비면 한 날 일정이 0번 줄을 쓴다 (막대 없는 칸)", () => {
    const w = phoneWeek(pack(W1, [allDay(1, "2026-11-10", "2026-11-11"), timed(2, "2026-11-13", "09:00", "10:00")]));
    expect(briefChips(w)).toContainEqual([2, 0, 5, 1, false, true, true]);
  });

  it("주를 넘는 여러 날 일정은 주마다 한 조각, 끊긴 쪽은 각진 끝 (제목은 조각마다 한 번)", () => {
    const trip = allDay(1, "2026-11-12", "2026-11-17");
    const w1 = phoneWeek(pack(W1, [trip]));
    const w2 = phoneWeek(pack(W2, [trip]));
    expect(briefChips(w1)).toEqual([[1, 0, 4, 3, true, true, false]]);
    expect(briefChips(w2)).toEqual([[1, 0, 0, 3, true, false, true]]);
  });

  it("막대가 4줄을 넘으면 통째로 못 그리고 걸친 칸마다 +1", () => {
    const bars = [1, 2, 3, 4, 5].map((id) => allDay(id, "2026-11-09", "2026-11-10"));
    const w = phoneWeek(pack(W1, bars));
    expect(w.chips.filter((c) => c.multi)).toHaveLength(4);
    expect(w.more).toEqual([0, 1, 1, 0, 0, 0, 0]);
    // 다섯 번째 막대 + 그 칸 한 날 일정 1개 = +2
    const w2 = phoneWeek(pack(W1, [...bars, timed(9, "2026-11-10", "09:00", "10:00")]));
    expect(w2.more).toEqual([0, 1, 2, 0, 0, 0, 0]);
  });

  it("기념일, 공휴일 칸은 0번 줄을 비우고 3줄만 쓴다. 그 칸을 지나는 막대는 1번 줄로", () => {
    const reserved = [false, false, true, false, false, false, false];
    const d = "2026-11-10";
    const w = phoneWeek(
      pack(
        W1,
        [1, 2, 3, 4].map((id) => timed(id, d, `0${id}:00`, `0${id}:30`)),
      ),
      4,
      reserved,
    );
    expect(w.chips.map((c) => c.lane)).toEqual([1, 2, 3]);
    expect(w.more[2]).toBe(1);
    const bar = phoneWeek(pack(W1, [allDay(7, "2026-11-09", "2026-11-11")]), 4, reserved);
    expect(briefChips(bar)).toEqual([[7, 1, 1, 3, true, true, true]]);
  });

  it("maxLanes 를 바꿀 수 있다", () => {
    const d = "2026-11-10";
    const w = phoneWeek(
      pack(
        W1,
        [1, 2, 3].map((id) => timed(id, d, `0${id}:00`, `0${id}:30`)),
      ),
      2,
    );
    expect(w.chips).toHaveLength(2);
    expect(w.more[2]).toBe(1);
  });
});
