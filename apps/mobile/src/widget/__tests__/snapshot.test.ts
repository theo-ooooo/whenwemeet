import {
  addDays,
  dateText,
  dayLink,
  isDateKey,
  kstDateKey,
  kstMidnight,
  parseWidgetSnapshot,
  SIGNED_OUT_PROPS,
  timelineEntries,
  timelineTimes,
  widgetProps,
} from "../snapshot";

import { NOW, sample } from "./fixture";

describe("KST 날짜", () => {
  it("자정 경계: 14:59:59Z 는 그날, 15:00Z 는 다음 날", () => {
    expect(kstDateKey(Date.parse("2026-11-12T14:59:59.999Z"))).toBe("2026-11-12");
    expect(kstDateKey(Date.parse("2026-11-12T15:00:00.000Z"))).toBe("2026-11-13");
    expect(kstMidnight("2026-11-13")).toBe(Date.parse("2026-11-12T15:00:00.000Z"));
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(dateText("2026-11-12")).toBe("11월 12일 목");
  });
  it("isDateKey 는 없는 날을 버린다", () => {
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2026-1-1")).toBe(false);
  });
});

describe("parseWidgetSnapshot", () => {
  it("정상 스냅샷은 쓰는 칸만 옮긴다", () => {
    const raw = { ...sample(), extra: "x", groups: [{ id: 1, name: "우리 둘", color: 0, code: "team1xxx", memo: "비밀" }] };
    raw.days = raw.days.map((d) => ({ ...d, events: d.events.filter((e) => e.g === 1) }));
    raw.anniversaries = raw.anniversaries.filter((a) => a.g === 1);
    const s = parseWidgetSnapshot(raw);
    expect(s).not.toBeNull();
    expect(s?.groups).toEqual([{ id: 1, name: "우리 둘", color: 0, code: "team1xxx" }]);
    expect(s).not.toHaveProperty("extra");
  });

  it.each([
    ["generatedAt 없음", { generatedAt: "아님" }],
    ["팀 색 범위 밖", { groups: [{ id: 1, name: "a", color: 8, code: "team1xxx" }] }],
    ["(#311) 팀 코드 없음", { groups: [{ id: 1, name: "a", color: 0, code: "team1xxx" }] }],
    ["(#311) 팀 코드 모양 틀림", { groups: [{ id: 1, name: "a", color: 0, code: "TEAM-1" }] }],
    ["팀 이름 21자", { groups: [{ id: 1, name: "가".repeat(21), color: 0, code: "team1xxx" }] }],
    ["8일", { days: Array.from({ length: 8 }, (_, i) => ({ date: addDays("2026-11-12", i), events: [], total: 0 })) }],
    ["날이 이어지지 않음", { days: [{ date: "2026-11-12", events: [], total: 0 }, { date: "2026-11-14", events: [], total: 0 }] }],
    ["하루 일정 4개", { days: [{ date: "2026-11-12", events: Array(4).fill({ g: 1, title: "a", time: "1" }), total: 4 }] }],
    ["total 이 보이는 수보다 작음", { days: [{ date: "2026-11-12", events: [{ g: 1, title: "a", time: "1" }], total: 0 }] }],
    ["목록에 없는 팀의 일정", { days: [{ date: "2026-11-12", events: [{ g: 9, title: "a", time: "1" }], total: 1 }] }],
    ["제목 31자", { days: [{ date: "2026-11-12", events: [{ g: 1, title: "가".repeat(31), time: "1" }], total: 1 }] }],
    ["제목 제어문자", { days: [{ date: "2026-11-12", events: [{ g: 1, title: "a\nb", time: "1" }], total: 1 }] }],
    ["기념일 4개", { anniversaries: Array(4).fill({ g: 1, title: "a", date: "2026-11-20" }) }],
    ["기념일 날짜 틀림", { anniversaries: [{ g: 1, title: "a", date: "2026-13-01" }] }],
  ])("스키마 위반: %s → null", (_name, over) => {
    expect(parseWidgetSnapshot({ ...sample(), ...over })).toBeNull();
  });

  it("객체가 아니면 null", () => {
    expect(parseWidgetSnapshot(null)).toBeNull();
    expect(parseWidgetSnapshot([])).toBeNull();
    expect(parseWidgetSnapshot("x")).toBeNull();
  });
});

describe("widgetProps", () => {
  it("스냅샷이 없으면 로그인 안내", () => {
    expect(widgetProps(null, NOW)).toEqual(SIGNED_OUT_PROPS);
  });

  it("오늘 일정, +N개, 팀 이름(팀이 둘 이상), 가까운 기념일 D-day, 누름 주소", () => {
    const p = widgetProps(sample(), NOW);
    expect(p.kind).toBe("today");
    expect(p.dateText).toBe("11월 12일 목");
    expect(p.rows).toEqual([
      { title: "저녁 약속", time: "19:00", color: 0, team: "우리 둘" },
      { title: "엄마 생신", time: "종일", color: 3, team: "가족" },
    ]);
    expect(p.more).toBe(3);
    expect(p.known).toBe(true);
    expect(p.stale).toBe(false);
    expect(p.anniversary).toEqual({ title: "처음 만난 날 300일", dday: "D-12", url: "whenwemeet://anniversaries?team=team1xxx" });
    expect(p.url).toBe("whenwemeet://calendar?date=2026-11-12&day=1&team=team1xxx");
    expect(p.url).toBe(dayLink("team1xxx", "2026-11-12"));
  });

  it("팀이 하나면 팀 이름을 빼고, 일정 없는 날은 빈 목록 + 첫 팀의 그날", () => {
    const s = sample({ groups: [{ id: 1, name: "나", color: 2, code: "team1xxx" }], anniversaries: [] });
    s.days = s.days.map((d) => ({ ...d, events: [], total: 0 }));
    const p = widgetProps(s, NOW);
    expect(p.rows).toEqual([]);
    expect(p.more).toBe(0);
    expect(p.anniversary).toBeNull();
    expect(p.url).toBe("whenwemeet://calendar?date=2026-11-12&day=1&team=team1xxx");
  });

  it("KST 자정이 지나면 다음 날 값, 지난 기념일은 건너뛴다", () => {
    const s = sample({
      anniversaries: [
        { g: 1, title: "오늘 기념일", date: "2026-11-12" },
        { g: 2, title: "내일 기념일", date: "2026-11-13" },
      ],
    });
    expect(widgetProps(s, NOW).anniversary?.dday).toBe("D-day");
    const next = widgetProps(s, Date.parse("2026-11-12T15:00:00.000Z"));
    expect(next.dateText).toBe("11월 13일 금");
    expect(next.rows).toEqual([]);
    expect(next.anniversary).toEqual({ title: "내일 기념일", dday: "D-day", url: "whenwemeet://anniversaries?team=team2xxx" });
  });

  it("24시간 지나면 stale, 범위 밖 날이면 known=false", () => {
    const s = sample();
    expect(widgetProps(s, NOW + 24 * 3600_000).stale).toBe(false);
    expect(widgetProps(s, NOW + 24 * 3600_000 + 1).stale).toBe(true);
    const after = widgetProps(s, kstMidnight("2026-11-19"));
    expect(after.known).toBe(false);
    expect(after.rows).toEqual([]);
  });

  it("팀이 없고 기념일도 없으면 앱만 연다", () => {
    expect(widgetProps(sample({ groups: [], days: [], anniversaries: [] }), NOW).url).toBe("whenwemeet://");
  });
});

describe("timeline", () => {
  it("지금, 매 KST 자정(범위 끝 다음 날까지), 오래됨 시각", () => {
    const t = timelineTimes(sample(), NOW);
    expect(t[0]).toBe(NOW);
    expect(t).toContain(kstMidnight("2026-11-13"));
    expect(t).toContain(kstMidnight("2026-11-19"));
    expect(t).not.toContain(kstMidnight("2026-11-20"));
    expect(t).toContain(NOW + 24 * 3600_000 + 1);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(t).toHaveLength(1 + 7 + 1);
  });

  it("항목마다 그 시각의 값", () => {
    const e = timelineEntries(sample(), NOW);
    const midnight = e.find((x) => x.date.getTime() === kstMidnight("2026-11-13"));
    expect(midnight?.props.dateText).toBe("11월 13일 금");
    const last = e[e.length - 1];
    expect(last.props.known).toBe(false);
  });
});

describe("(#350) 8색과 일정 색", () => {
  it("팀 색 7(핑크)을 받는다", () => {
    const s = parseWidgetSnapshot(sample({ groups: [{ id: 1, name: "우리 둘", color: 7, code: "team1xxx" }, { id: 2, name: "가족", color: 3, code: "team2xxx" }] }));
    expect(s?.groups[0].color).toBe(7);
  });

  it("팀 c 가 있으면 color 보다 c", () => {
    const s = parseWidgetSnapshot(sample({ groups: [{ id: 1, name: "우리 둘", color: 6, c: 7, code: "team1xxx" } as never, { id: 2, name: "가족", color: 3, code: "team2xxx" }] }));
    expect(s?.groups[0].color).toBe(7);
  });

  it("팀 c 가 틀리면 color 로", () => {
    const s = parseWidgetSnapshot(sample({ groups: [{ id: 1, name: "우리 둘", color: 6, c: 99, code: "team1xxx" } as never, { id: 2, name: "가족", color: 3, code: "team2xxx" }] }));
    expect(s?.groups[0].color).toBe(6);
  });

  it("일정 c 가 있으면 그 색, 틀린 c 는 버리고 팀 색", () => {
    const raw = sample();
    raw.days[0].events = [
      { g: 1, title: "핑크 데이트", time: "10:00", c: 7 },
      { g: 2, title: "이상한 색", time: "11:00", c: "x" } as never,
    ];
    raw.days[0].total = 2;
    const s = parseWidgetSnapshot(raw);
    expect(s?.days[0].events).toEqual([
      { g: 1, title: "핑크 데이트", time: "10:00", c: 7 },
      { g: 2, title: "이상한 색", time: "11:00" },
    ]);
    const p = widgetProps(s, Date.parse(`${raw.days[0].date}T12:00:00+09:00`));
    expect(p.rows.map((r) => r.color)).toEqual([7, 3]);
  });
});
