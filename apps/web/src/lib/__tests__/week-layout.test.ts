import { describe, expect, it } from "vitest";
import { kstToIso } from "../date";
import {
  barTimeText,
  daySegments,
  freeBands,
  hhmm,
  initialTopMinute,
  layoutDay,
  nowMarker,
  segmentLabel,
  slotMinuteAt,
  visualEnd,
  weekDays,
  weekFetchRange,
  weekTitle,
} from "../week-layout";

type Ev = { id: number; title: string; occurrence?: string | null; startsAt: string; endsAt: string; allDay: boolean };

let seq = 0;
const ev = (day: string, start: string, endDay: string, end: string, allDay = false, extra: Partial<Ev> = {}): Ev => ({
  id: ++seq,
  title: `일정${seq}`,
  startsAt: kstToIso(day, start),
  endsAt: kstToIso(endDay, end),
  allDay,
  ...extra,
});
const at = (day: string, start: string, end: string) => ev(day, start, day, end);

// 2026-11-12 는 목요일. 그 주는 11-08(일) ~ 11-14(토)
const DAY = "2026-11-12";

describe("weekDays, weekFetchRange", () => {
  it("일요일 시작 7칸", () => {
    expect(weekDays(DAY)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]);
    expect(weekDays("2026-11-08")[0]).toBe("2026-11-08");
    expect(weekDays("2026-11-14")[0]).toBe("2026-11-08");
  });
  it("앞뒤 1주를 더해 21일", () => {
    expect(weekFetchRange(DAY)).toEqual({ from: "2026-11-01", to: "2026-11-22" });
  });
});

describe("daySegments", () => {
  it("그날 시간 일정만 분 단위로, 종일은 뺀다", () => {
    const a = at(DAY, "18:00", "20:00");
    const b = ev(DAY, "00:00", "2026-11-13", "00:00", true);
    const other = at("2026-11-13", "10:00", "11:00");
    const segs = daySegments([a, b, other], DAY);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ start: 18 * 60, end: 20 * 60, isStart: true, isEnd: true });
  });

  it("자정을 넘는 일정은 날마다 자른다 (끝 날은 00:00 부터)", () => {
    const night = ev(DAY, "23:00", "2026-11-13", "01:30");
    expect(daySegments([night], DAY)[0]).toMatchObject({ start: 23 * 60, end: 1440, isStart: true, isEnd: false });
    expect(daySegments([night], "2026-11-13")[0]).toMatchObject({ start: 0, end: 90, isStart: false, isEnd: true });
  });

  it("사흘에 걸친 시간 일정은 가운데 날을 통째로 덮는다", () => {
    const long = ev("2026-11-11", "20:00", "2026-11-13", "09:00");
    expect(daySegments([long], DAY)[0]).toMatchObject({ start: 0, end: 1440, isStart: false, isEnd: false });
  });

  it("자정에 끝나는 일정은 다음 날에 조각을 만들지 않는다", () => {
    const e = ev(DAY, "22:00", "2026-11-13", "00:00");
    expect(daySegments([e], "2026-11-13")).toHaveLength(0);
    expect(daySegments([e], DAY)[0]).toMatchObject({ end: 1440, isEnd: true });
  });

  it("주를 넘는 일정은 다음 주 첫날에도 조각이 있다", () => {
    const e = ev("2026-11-14", "22:00", "2026-11-15", "02:00");
    expect(daySegments([e], "2026-11-15")[0]).toMatchObject({ start: 0, end: 120 });
  });

  it("길이 0 일정은 시작한 날에만", () => {
    const zero = ev(DAY, "09:00", DAY, "09:00");
    expect(daySegments([zero], DAY)[0]).toMatchObject({ start: 540, end: 540 });
    const midnight = ev("2026-11-13", "00:00", "2026-11-13", "00:00");
    expect(daySegments([midnight], DAY)).toHaveLength(0);
    expect(daySegments([midnight], "2026-11-13")).toHaveLength(1);
  });

  it("같은 회차는 한 번만, 반복 회차는 따로", () => {
    const a = at(DAY, "10:00", "11:00");
    const r1 = { ...at(DAY, "12:00", "13:00"), id: 99, occurrence: "2026-11-12" };
    const r2 = { ...r1, occurrence: "2026-11-05" };
    expect(daySegments([a, a, r1, r2], DAY).map((s) => s.key)).toEqual([`${a.id}:`, "99:2026-11-05", "99:2026-11-12"]);
  });

  it("시작 순, 같으면 긴 것 먼저", () => {
    const short = at(DAY, "10:00", "10:30");
    const long = at(DAY, "10:00", "12:00");
    const early = at(DAY, "09:00", "09:30");
    expect(daySegments([short, long, early], DAY).map((s) => s.event)).toEqual([early, long, short]);
  });
});

const seg = (key: string, start: number, end: number) => ({ event: key, key, start, end, isStart: true, isEnd: true });
const cols = (l: ReturnType<typeof layoutDay<string>>) => Object.fromEntries(l.placed.map((p) => [p.key, `${p.col}/${p.cols}`]));

describe("layoutDay 겹침 열 배치", () => {
  it.each([
    {
      name: "안 겹치면 모두 한 열",
      segs: [seg("a", 600, 660), seg("b", 660, 720)],
      want: { a: "0/1", b: "0/1" },
    },
    {
      name: "둘이 겹치면 반씩",
      segs: [seg("a", 600, 720), seg("b", 630, 690)],
      want: { a: "0/2", b: "1/2" },
    },
    {
      name: "셋이 겹치면 3등분",
      segs: [seg("a", 600, 720), seg("b", 610, 720), seg("c", 620, 720)],
      want: { a: "0/3", b: "1/3", c: "2/3" },
    },
    {
      name: "빈 열은 다시 쓴다 (a 와 c 는 안 겹친다)",
      segs: [seg("a", 600, 660), seg("b", 600, 780), seg("c", 690, 720)],
      want: { b: "0/2", a: "1/2", c: "1/2" },
    },
    {
      name: "묶음이 끝나면 다음 묶음은 다시 한 열",
      segs: [seg("a", 600, 660), seg("b", 630, 690), seg("c", 700, 760)],
      want: { a: "0/2", b: "1/2", c: "0/1" },
    },
    {
      name: "짧은 일정은 30분으로 보고 겹침을 판단한다",
      segs: [seg("a", 600, 605), seg("b", 620, 680)],
      want: { a: "0/2", b: "1/2" },
    },
    {
      name: "끝과 시작이 같으면 겹치지 않는다",
      segs: [seg("a", 600, 660), seg("b", 660, 720)],
      want: { a: "0/1", b: "0/1" },
    },
  ])("$name", ({ segs, want }) => {
    const l = layoutDay(segs);
    expect(cols(l)).toEqual(want);
    expect(l.more).toEqual([]);
  });

  it("4개 이상 겹치면 2열 + 셋째 열 +N", () => {
    const l = layoutDay([seg("a", 600, 720), seg("b", 610, 720), seg("c", 620, 720), seg("d", 630, 700)]);
    expect(cols(l)).toEqual({ a: "0/3", b: "1/3" });
    expect(l.more).toEqual([{ start: 620, end: 720, col: 2, cols: 3, events: ["c", "d"] }]);
  });

  it("maxCols 를 바꿀 수 있다", () => {
    const l = layoutDay([seg("a", 600, 720), seg("b", 610, 720)], 1);
    expect(l.placed).toEqual([]);
    expect(l.more[0].events).toEqual(["a", "b"]);
  });

  it("visualEnd 는 자정에서 멈춘다", () => {
    expect(visualEnd({ start: 1430, end: 1435 })).toBe(1440);
    expect(visualEnd({ start: 600, end: 700 })).toBe(700);
  });
});

describe("slotMinuteAt, hhmm", () => {
  it.each([
    [0, 48, 0],
    [47, 48, 30],
    [48, 48, 60],
    [24 * 48 + 50, 48, 1410],
    [-5, 40, 0],
    [400, 40, 600],
    [419, 40, 600],
    [420, 40, 630],
  ])("%ipx / 시간 %ipx → %i분", (px, hour, want) => {
    expect(slotMinuteAt(px, hour)).toBe(want);
  });
  it("hhmm", () => {
    expect(hhmm(0)).toBe("00:00");
    expect(hhmm(630)).toBe("10:30");
    expect(hhmm(1440)).toBe("24:00");
  });
});

describe("nowMarker, initialTopMinute", () => {
  const days = weekDays(DAY);
  const now = Date.parse(kstToIso(DAY, "14:20"));
  it("이번 주면 그 칸과 분", () => {
    expect(nowMarker(days, now)).toEqual({ col: 4, minute: 14 * 60 + 20 });
    expect(nowMarker(weekDays("2026-11-20"), now)).toBeNull();
  });
  it("이번 주면 지금 - 1시간", () => {
    expect(initialTopMinute(days, [], now)).toBe(13 * 60 + 20);
    expect(initialTopMinute(days, [], Date.parse(kstToIso(DAY, "00:30")))).toBe(0);
  });
  it("다른 주면 그 주에서 가장 이른 시간 일정 30분 앞 (30분 단위), 없으면 07:00", () => {
    const next = weekDays("2026-11-19");
    // 화요일 15:10 보다 수요일 08:00 이 이르다 → 07:30 (첫 칸 순서가 아니라 주 전체에서 가장 이른 시각)
    expect(initialTopMinute(next, [at("2026-11-17", "15:10", "16:00"), at("2026-11-18", "08:00", "09:00")], now)).toBe(7 * 60 + 30);
    expect(initialTopMinute(next, [at("2026-11-17", "15:10", "16:00")], now)).toBe(14 * 60 + 30);
    expect(initialTopMinute(next, [ev("2026-11-17", "00:00", "2026-11-18", "00:00", true)], now)).toBe(7 * 60);
    expect(initialTopMinute(next, null, now)).toBe(7 * 60);
  });
  it("(QA) 일요일 저녁 일정이 있어도 월, 화 아침 일정이 위로 숨지 않는다", () => {
    const w = weekDays("2026-11-22");
    const list = [at("2026-11-22", "19:00", "21:00"), at("2026-11-23", "09:00", "10:00"), at("2026-11-24", "08:30", "09:00")];
    expect(initialTopMinute(w, list, now)).toBe(8 * 60);
  });
  it("앞 주에서 자정을 넘어 이어지는 조각은 진짜 시작이 있으면 보지 않는다", () => {
    const w = weekDays("2026-11-22");
    // 토 11/21 23:00 ~ 일 11/22 01:00 은 일요일 칸에 00:00 조각
    const spill = ev("2026-11-21", "23:00", "2026-11-22", "01:00");
    expect(initialTopMinute(w, [spill, at("2026-11-25", "10:00", "11:00")], now)).toBe(9 * 60 + 30);
    expect(initialTopMinute(w, [spill], now)).toBe(0);
  });
});

describe("weekTitle", () => {
  it.each([
    [["2026-11-08", "2026-11-14"], false, "11월 8일 ~ 14일"],
    [["2026-11-29", "2026-12-05"], false, "11월 29일 ~ 12월 5일"],
    [["2027-12-26", "2028-01-01"], false, "2027년 12월 26일 ~ 2028년 1월 1일"],
    [["2027-03-07", "2027-03-13"], false, "2027년 3월 7일 ~ 13일"],
    [["2026-11-08", "2026-11-14"], true, "11월 8~14일"],
    [["2026-11-29", "2026-12-05"], true, "11/29~12/5"],
  ])("%j short=%s → %s", (days, short, want) => {
    expect(weekTitle(days as string[], 2026, short as boolean)).toBe(want);
  });
});

describe("freeBands", () => {
  it("그날 범위로 자른다", () => {
    const slots = [
      { startsAt: kstToIso("2026-11-11", "22:00"), endsAt: kstToIso(DAY, "09:00") },
      { startsAt: kstToIso(DAY, "13:00"), endsAt: kstToIso(DAY, "15:30") },
      { startsAt: kstToIso("2026-11-13", "09:00"), endsAt: kstToIso("2026-11-13", "10:00") },
    ];
    expect(freeBands(slots, DAY)).toEqual([
      { start: 0, end: 540 },
      { start: 780, end: 930 },
    ]);
  });
});

describe("segmentLabel", () => {
  it.each([
    [at(DAY, "18:00", "20:00"), "11월 12일 오후 6시부터 8시까지"],
    [at(DAY, "09:30", "13:00"), "11월 12일 오전 9시 30분부터 오후 1시까지"],
    [ev(DAY, "22:00", "2026-11-13", "00:00"), "11월 12일 오후 10시부터 자정까지"],
    [ev(DAY, "23:00", "2026-11-13", "01:30"), "11월 12일 오후 11시부터 11월 13일 오전 1시 30분까지"],
  ])("%#", (e, want) => {
    expect(segmentLabel({ ...e, title: "저녁 약속" })).toBe(`저녁 약속, ${want}`);
  });
});

describe("barTimeText (QA: 자정 넘는 막대 시각)", () => {
  it("같은 날이면 그 시각", () => {
    expect(barTimeText(at("2026-11-12", "09:00", "10:30"))).toBe("09:00~10:30");
  });
  it("다음 날에 끝나면 조각 범위(24:00)가 아니라 진짜 끝 시각", () => {
    expect(barTimeText(ev("2026-11-14", "22:00", "2026-11-15", "02:00"))).toBe("22:00~02:00");
    expect(barTimeText(ev("2026-11-14", "23:00", "2026-11-15", "01:30"))).toBe("23:00~01:30");
  });
  it("다음 날 자정에 끝나면 24:00", () => {
    expect(barTimeText(ev("2026-11-14", "22:00", "2026-11-15", "00:00"))).toBe("22:00~24:00");
  });
  it("이틀 넘게 걸치면 끝 날짜까지", () => {
    expect(barTimeText(ev("2026-11-14", "22:00", "2026-11-16", "02:00"))).toBe("22:00~11/16 02:00");
  });
});
