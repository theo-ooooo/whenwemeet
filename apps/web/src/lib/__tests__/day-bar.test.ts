// (#378) 하루 막대 배치: 합치기, 자르기, 뒤집기, 모두 비는 시간, % 위치, 30분 고르기, 눈금, 지금, 멤버별 바쁜 시간
import { describe, expect, it } from "vitest";
import { kstToIso } from "../date";
import {
  barSegments,
  barTicks,
  busyByMember,
  busyMarks,
  clipIntervals,
  dayWindow,
  everyoneFree,
  invertIntervals,
  mergeIntervals,
  nowLeft,
  pickStart,
  timeAt,
  totalMinutes,
} from "../day-bar";
import type { Member } from "../types";

const D = "2026-11-17";
const t = (hm: string, day = D) => Date.parse(kstToIso(day, hm));
const iv = (a: string, b: string) => ({ start: t(a), end: t(b) });
const win = dayWindow(D);
const m = (id: number): Member => ({ userId: id, displayName: `멤버${id}`, color: "#F26D6D", profileImageUrl: null });

describe("구간 계산", () => {
  it("창은 KST 8시 ~ 23시, 24시는 다음 날 0시", () => {
    expect(win).toEqual(iv("08:00", "23:00"));
    expect(dayWindow(D, 9, 24).end).toBe(t("00:00", "2026-11-18"));
  });

  it("겹치거나 맞닿으면 합치고, 길이 0 은 버린다", () => {
    expect(mergeIntervals([iv("10:00", "11:00"), iv("09:00", "10:00"), iv("10:30", "12:00"), iv("13:00", "13:00")])).toEqual([iv("09:00", "12:00")]);
  });

  it("창 밖은 자른다 (전날부터 이어진 일정, 자정 넘는 일정)", () => {
    const prev = { start: t("22:00", "2026-11-16"), end: t("09:00") };
    expect(clipIntervals([prev, iv("22:00", "23:30")], win)).toEqual([iv("08:00", "09:00"), iv("22:00", "23:00")]);
    expect(clipIntervals([iv("06:00", "07:00")], win)).toEqual([]);
  });

  it("뒤집으면 빈 구간", () => {
    expect(invertIntervals([iv("09:00", "10:00"), iv("12:00", "14:00")], win)).toEqual([iv("08:00", "09:00"), iv("10:00", "12:00"), iv("14:00", "23:00")]);
    expect(invertIntervals([], win)).toEqual([win]);
    expect(invertIntervals([iv("07:00", "23:30")], win)).toEqual([]);
  });

  it("모두 비는 시간: 누구라도 바쁘면 바쁨", () => {
    const a = [iv("08:00", "09:00"), iv("18:00", "19:00")];
    const b = [iv("08:30", "10:00"), iv("21:00", "21:30")];
    expect(everyoneFree([a, b], win)).toEqual([iv("10:00", "18:00"), iv("19:00", "21:00"), iv("21:30", "23:00")]);
    expect(totalMinutes(everyoneFree([a, b], win))).toBe(480 + 120 + 90);
  });
});

describe("막대 조각", () => {
  it("빈 구간과 바쁜 구간을 빈틈없이 잇고 % 로 둔다 (15시간 창)", () => {
    const segs = barSegments([iv("09:00", "10:00"), iv("12:00", "14:00")], win);
    expect(segs.map((s) => s.kind)).toEqual(["busy", "free", "busy", "free", "busy"]);
    expect(segs[1]).toMatchObject({ left: 6.67, width: 6.67 });
    expect(segs.reduce((n, s) => n + s.width, 0)).toBeCloseTo(100, 1);
    expect(segs[segs.length - 1].end).toBe(win.end);
  });

  it("창 밖으로 나간 빈 구간은 자르고, 창 전체가 비면 조각 하나", () => {
    expect(barSegments([iv("06:00", "09:00")], win)[0]).toMatchObject({ kind: "free", start: win.start, left: 0 });
    expect(barSegments([win], win)).toEqual([{ kind: "free", ...win, left: 0, width: 100 }]);
    expect(barSegments([], { start: 1, end: 1 })).toEqual([]);
  });

  it("멤버별 바쁜 표시", () => {
    expect(busyMarks([iv("08:00", "09:00")], win)).toEqual([{ kind: "busy", ...iv("08:00", "09:00"), left: 0, width: 6.67 }]);
  });
});

describe("빈 구간 누르기 (30분 단위)", () => {
  const seg = iv("12:10", "18:00");

  it("누른 시각을 30분으로 내린다", () => {
    expect(pickStart(seg, t("14:44"))).toBe(t("14:30"));
  });

  it("구간 시작보다 앞이면 구간 시작(30분 올림)", () => {
    expect(pickStart(seg, t("12:15"))).toBe(t("12:30"));
  });

  it("30분이 구간 끝을 넘으면 한 칸 앞으로", () => {
    expect(pickStart(seg, t("17:50"))).toBe(t("17:30"));
  });

  it("키보드(at 없음)는 구간 시작", () => {
    expect(pickStart(seg)).toBe(t("12:30"));
    expect(pickStart(iv("09:00", "10:00"))).toBe(t("09:00"));
  });

  it("30분보다 짧은 구간은 구간 시작 (넘치지 않게 끝으로 자른다)", () => {
    expect(pickStart(iv("09:10", "09:25"), t("09:20"))).toBe(t("09:25"));
  });

  it("막대 위 비율 → 시각 (밖은 양 끝)", () => {
    expect(timeAt(win, 0.5)).toBe(t("15:30"));
    expect(timeAt(win, -1)).toBe(win.start);
    expect(timeAt(win, 2)).toBe(win.end);
  });
});

describe("눈금과 지금", () => {
  it("8~23 은 3시간마다 8 11 14 17 20 23", () => {
    expect(barTicks(8, 23).map((x) => x.hour)).toEqual([8, 11, 14, 17, 20, 23]);
    expect(barTicks(8, 23)[1].left).toBe(20);
  });

  it("끝 눈금은 늘 넣고, 앞 눈금과 1시간 이하로 붙으면 앞 것을 뺀다", () => {
    expect(barTicks(9, 23).map((x) => x.hour)).toEqual([9, 12, 15, 18, 21, 23]);
    expect(barTicks(9, 22).map((x) => x.hour)).toEqual([9, 12, 15, 18, 22]);
    expect(barTicks(9, 9)).toEqual([]);
  });

  it("지금은 창 안일 때만", () => {
    expect(nowLeft(win, t("15:30"))).toBe(50);
    expect(nowLeft(win, t("07:59"))).toBeNull();
    expect(nowLeft(win, t("23:01"))).toBeNull();
  });
});

describe("멤버별 바쁜 시간", () => {
  const ev = (s: string, e: string, who: number[] | "all", allDay = false) => ({
    startsAt: kstToIso(D, s),
    endsAt: kstToIso(D, e),
    allDay,
    creator: m(1),
    participants: { all: who === "all", members: who === "all" ? [m(1), m(2)] : who.map(m) },
  });

  it("참여자만 바쁨, 모두는 전원, 종일은 기본 제외, 창으로 자른다", () => {
    const events = [ev("07:00", "09:00", [1]), ev("12:00", "13:00", "all"), ev("00:00", "23:59", [2], true), ev("15:00", "16:00", [])];
    const r = busyByMember(events, [m(1), m(2)], win);
    expect(r[0].busy).toEqual([iv("08:00", "09:00"), iv("12:00", "13:00")]);
    expect(r[1].busy).toEqual([iv("12:00", "13:00")]);
    expect(busyByMember(events, [m(2)], win, { includeAllDay: true })[0].busy).toEqual([win]);
  });

  it("옛 API(participants 없음)는 등록자만", () => {
    const old = { startsAt: kstToIso(D, "10:00"), endsAt: kstToIso(D, "11:00"), allDay: false, creator: m(2) };
    const r = busyByMember([old], [m(1), m(2)], win);
    expect(r.map((x) => x.busy.length)).toEqual([0, 1]);
  });
});
