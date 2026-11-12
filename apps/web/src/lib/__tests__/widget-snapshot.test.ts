import { describe, expect, it } from "vitest";
import { appSupportsWidget, encodeBridgeMessage, WIDGET_UA_TOKEN } from "../app-bridge";
import { isWidgetPath } from "../api";
import { kstToIso } from "../date";
import {
  buildWidgetSnapshot,
  clip,
  colorIndex,
  fitWidgetSnapshot,
  groupColorIndex,
  widgetMessageLength,
  widgetRange,
  widgetTimeText,
  WIDGET_MESSAGE_MAX,
  type WidgetSource,
} from "../widget-snapshot";
import { widgetRefreshDue } from "../useWidgetSync";
import type { Anniversary, Event, GroupSummary, Member } from "../types";

const who: Member = { userId: 1, displayName: "지우", color: "#5B6CF4", profileImageUrl: null };
const TODAY = "2026-11-12"; // 목요일
const NOW = Date.parse(kstToIso(TODAY, "09:00"));
const at = (k: string, t: string) => kstToIso(k, t);

let seq = 0;
function ev(groupId: number, start: string, end: string, extra: Partial<Event> = {}): Event {
  seq += 1;
  return {
    id: seq,
    groupId,
    title: `일정${seq}`,
    startsAt: start,
    endsAt: end,
    allDay: false,
    memo: "비밀 메모",
    location: "집",
    creator: who,
    createdAt: start,
    updatedAt: start,
    repeat: null,
    repeatUntil: null,
    occurrence: null,
    seriesStartsAt: null,
    repeatAnchor: null,
    participants: { all: true, members: [who] },
    ...extra,
  } as Event;
}

function group(id: number, name: string, color = "#F26D6D"): GroupSummary {
  return { id, type: "TEAM", name, publicCode: `team${id}`.padEnd(8, "x"), memberCount: 2, me: { color, displayName: "나" }, unreadNewsCount: 0 } as GroupSummary;
}

function ann(groupId: number, id: number, name: string, date: string, kind: Anniversary["kind"] = "YEARLY"): Anniversary {
  return { id, groupId, name, date, kind, creator: who, createdAt: date } as Anniversary;
}

function source(groups: GroupSummary[], events: Record<number, Event[]>, anns: Record<number, Anniversary[]> = {}): WidgetSource {
  return {
    groups,
    events: new Map(Object.entries(events).map(([k, v]) => [Number(k), v])),
    anniversaries: new Map(Object.entries(anns).map(([k, v]) => [Number(k), v])),
  };
}

describe("buildWidgetSnapshot", () => {
  it("여러 팀 일정을 날마다 모으고 팀, 색, 메모/장소/참여자는 넣지 않는다", () => {
    const s = buildWidgetSnapshot(
      source([group(1, "우리 둘", "#5B6CF4"), group(2, "가족", "#F2994A")], {
        1: [ev(1, at(TODAY, "19:00"), at(TODAY, "21:00"), { title: "저녁" })],
        2: [ev(2, at(TODAY, "08:00"), at(TODAY, "09:00"), { title: "아침" }), ev(2, at("2026-11-14", "10:00"), at("2026-11-14", "11:00"))],
      }),
      NOW,
    );
    expect(s.groups).toEqual([
      { id: 1, name: "우리 둘", color: 5, code: "team1xxx" },
      { id: 2, name: "가족", color: 1, code: "team2xxx" },
    ]);
    expect(s.days.map((d) => d.date)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"]);
    expect(s.days[0]).toEqual({
      date: TODAY,
      events: [
        { g: 2, title: "아침", time: "08:00" },
        { g: 1, title: "저녁", time: "19:00" },
      ],
      total: 2,
    });
    expect(s.days[2].total).toBe(1);
    const json = JSON.stringify(s);
    expect(json).not.toContain("비밀");
    expect(json).not.toContain("집");
    expect(json).not.toContain("지우");
  });

  it("반복 회차: 같은 일정 id 의 다른 회차는 각 날에, 같은 회차가 두 번 오면 한 번", () => {
    const base = { id: 900, repeat: "WEEKLY" as const };
    const a = ev(1, at(TODAY, "07:00"), at(TODAY, "08:00"), { ...base, occurrence: TODAY, title: "운동" });
    const b = ev(1, at("2026-11-19", "07:00"), at("2026-11-19", "08:00"), { ...base, occurrence: "2026-11-19", title: "운동" });
    const c = ev(1, at("2026-11-13", "07:00"), at("2026-11-13", "08:00"), { ...base, occurrence: "2026-11-13", title: "운동" });
    const s = buildWidgetSnapshot(source([group(1, "나")], { 1: [a, a, c, b] }), NOW);
    expect(s.days[0].total).toBe(1);
    expect(s.days[1].events).toEqual([{ g: 1, title: "운동", time: "07:00" }]);
    expect(s.days.find((d) => d.date === "2026-11-19")).toBeUndefined();
  });

  it("여러 날 일정: 걸친 날마다, 가운데 날 종일, 마지막 날 ~끝 시각. 종일 먼저, 그다음 시작 순(진행 중인 것이 앞)", () => {
    const trip = ev(1, at("2026-11-11", "22:00"), at("2026-11-13", "10:00"), { title: "여행" });
    const lunch = ev(1, at("2026-11-13", "09:00"), at("2026-11-13", "10:00"), { title: "점심" });
    const holiday = ev(1, at(TODAY, "00:00"), at("2026-11-14", "00:00"), { allDay: true, title: "휴가" });
    const s = buildWidgetSnapshot(source([group(1, "나")], { 1: [lunch, trip, holiday] }), NOW);
    expect(s.days[0].events).toEqual([
      { g: 1, title: "여행", time: "종일" },
      { g: 1, title: "휴가", time: "종일" },
    ]);
    expect(s.days[1].events).toEqual([
      { g: 1, title: "휴가", time: "종일" },
      { g: 1, title: "여행", time: "~10:00" },
      { g: 1, title: "점심", time: "09:00" },
    ]);
    expect(s.days[2].total).toBe(0);
  });

  it("종일: 끝 자정 앞날까지만", () => {
    const one = ev(1, at(TODAY, "00:00"), at("2026-11-13", "00:00"), { allDay: true });
    expect(widgetTimeText(one, TODAY)).toBe("종일");
    const s = buildWidgetSnapshot(source([group(1, "나")], { 1: [one] }), NOW);
    expect(s.days[0].total).toBe(1);
    expect(s.days[1].total).toBe(0);
  });

  it("KST 자정 경계: 15:00Z 는 다음 날이 오늘, 23:59 KST 시작 일정은 그날", () => {
    const late = ev(1, at(TODAY, "23:59"), at("2026-11-13", "00:30"));
    const justBefore = Date.parse("2026-11-12T14:59:59.000Z");
    const after = Date.parse("2026-11-12T15:00:00.000Z");
    expect(buildWidgetSnapshot(source([group(1, "나")], { 1: [late] }), justBefore).days[0]).toMatchObject({ date: TODAY, total: 1 });
    const next = buildWidgetSnapshot(source([group(1, "나")], { 1: [late] }), after);
    expect(next.days[0]).toMatchObject({ date: "2026-11-13", events: [{ time: "~00:30" }] });
    expect(widgetRange(justBefore)).toEqual({ from: TODAY, to: "2026-11-19" });
    expect(widgetRange(after)).toEqual({ from: "2026-11-13", to: "2026-11-20" });
  });

  it("하루 3개 + 전체 수, 제목 30자 자르기", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      ev(1, at(TODAY, `1${i}:00`), at(TODAY, `1${i}:30`), { title: i === 0 ? "가".repeat(40) : `일${i}` }),
    );
    const s = buildWidgetSnapshot(source([group(1, "나")], { 1: many }), NOW);
    expect(s.days[0].events).toHaveLength(3);
    expect(s.days[0].total).toBe(5);
    expect(s.days[0].events[0].title).toHaveLength(30);
    expect(s.days[0].events[0].title.endsWith("…")).toBe(true);
  });

  it("가장 가까운 기념일 3개 (여러 팀, 오늘 포함, 지난 ONCE 제외)", () => {
    const s = buildWidgetSnapshot(
      source([group(1, "우리 둘"), group(2, "가족")], { 1: [], 2: [] }, {
        1: [ann(1, 1, "처음 만난 날", "2026-02-07", "COUNT_UP"), ann(1, 2, "지난 일", "2026-01-01", "ONCE")],
        2: [ann(2, 3, "엄마 생신", "1960-11-12"), ann(2, 4, "결혼기념일", "2020-12-25"), ann(2, 5, "설", "2020-02-01")],
      }),
      NOW,
    );
    expect(s.anniversaries).toEqual([
      { g: 2, title: "엄마 생신", date: TODAY },
      { g: 1, title: "처음 만난 날 300일", date: "2026-12-03" },
      { g: 2, title: "결혼기념일", date: "2026-12-25" },
    ]);
  });

  it("팀은 앞 10개까지, 이름 20자", () => {
    const groups = Array.from({ length: 12 }, (_, i) => group(i + 1, i === 0 ? "팀".repeat(25) : `팀${i}`));
    const s = buildWidgetSnapshot(source(groups, {}), NOW);
    expect(s.groups).toHaveLength(10);
    expect(s.groups[0].name).toHaveLength(20);
  });
});

describe("크기 상한 16KB", () => {
  it("넘으면 뒤쪽 날부터 빼고, 오늘 하나로도 넘으면 null", () => {
    const groups = Array.from({ length: 10 }, (_, i) => group(i + 1, `팀이름${i}`.padEnd(20, "가")));
    const s = buildWidgetSnapshot(source(groups, {}), NOW);
    expect(fitWidgetSnapshot(s)).toEqual(s);
    expect(widgetMessageLength(s)).toBe(encodeBridgeMessage({ type: "widgetSnapshot", snapshot: s }).length);
    const small = widgetMessageLength({ ...s, days: s.days.slice(0, 3) }) + 1;
    expect(fitWidgetSnapshot(s, small)?.days).toHaveLength(3);
    expect(fitWidgetSnapshot(s, 100)).toBeNull();
    expect(WIDGET_MESSAGE_MAX).toBe(16_384);
  });

  it("최대치(팀 10, 날마다 30자 제목 3개, 기념일 3개)도 16KB 안", () => {
    const groups = Array.from({ length: 10 }, (_, i) => group(i + 1, "가".repeat(20)));
    const events: Record<number, Event[]> = {};
    for (const g of groups)
      events[g.id] = Array.from({ length: 7 }, (_, d) => ev(g.id, at(`2026-11-${12 + d}`, "10:00"), at(`2026-11-${12 + d}`, "11:00"), { title: "가".repeat(40) }));
    const s = buildWidgetSnapshot(source(groups, events), NOW);
    expect(widgetMessageLength(s)).toBeLessThan(WIDGET_MESSAGE_MAX);
    expect(fitWidgetSnapshot(s)?.days).toHaveLength(7);
  });
});

describe("도우미", () => {
  it("clip: 제어문자, 빈 값, 서로게이트 쌍을 자르지 않는다", () => {
    expect(clip("a\nb", 10, "x")).toBe("a b");
    expect(clip("   ", 10, "x")).toBe("x");
    const r = clip("😀".repeat(20), 30, "x");
    expect(r.length).toBeLessThanOrEqual(30);
    expect(r).toBe(`${"😀".repeat(14)}…`);
  });
  it("colorIndex: 화면 색 순번 0~7 (핑크 7), 팔레트 밖은 슬레이트 (#343)", () => {
    expect(colorIndex("#F26D6D")).toBe(0);
    expect(colorIndex("#f279b5")).toBe(7);
    expect(colorIndex("#000000")).toBe(6);
    expect(colorIndex(null)).toBe(6);
  });
  it("groupColorIndex: 팀 색은 지금 셸이 받는 0~6. 핑크는 슬레이트 (#343)", () => {
    expect(groupColorIndex("#F26D6D")).toBe(0);
    expect(groupColorIndex("#A66CF4")).toBe(6);
    expect(groupColorIndex("#F279B5")).toBe(6);
  });
  it("일정 색을 고른 일정만 c (화면 색 순번), 자동은 싣지 않는다. 팀 색이 핑크여도 팀 color 는 0~6 (#343)", () => {
    const s = buildWidgetSnapshot(
      source([group(1, "우리 둘", "#F279B5")], {
        1: [
          ev(1, at(TODAY, "08:00"), at(TODAY, "09:00"), { title: "핑크", color: "#F279B5" }),
          ev(1, at(TODAY, "10:00"), at(TODAY, "11:00"), { title: "자동", color: null }),
          ev(1, at(TODAY, "12:00"), at(TODAY, "13:00"), { title: "블루", color: "#f26d6d" }),
        ],
      }),
      NOW,
    );
    expect(s.groups[0].color).toBe(6);
    expect(s.days[0].events).toEqual([
      { g: 1, title: "핑크", time: "08:00", c: 7 },
      { g: 1, title: "자동", time: "10:00" },
      { g: 1, title: "블루", time: "12:00", c: 0 },
    ]);
  });
  it("Widget/1 토큰이 있는 앱 UA 만", () => {
    const base = "Mozilla/5.0 WhenwemeetApp/1.2.0 (ios) EmailLogin/1";
    expect(appSupportsWidget(`${base} KakaoShare/1 ${WIDGET_UA_TOKEN}`)).toBe(true);
    expect(appSupportsWidget(`${base} Widget/1`)).toBe(true);
    expect(appSupportsWidget(base)).toBe(false);
    expect(appSupportsWidget("Mozilla/5.0 Safari Widget/1")).toBe(false);
    expect(appSupportsWidget(`${base} Widget/10`)).toBe(false);
  });
  it("변경 경로 판정: /groups 아래만", () => {
    expect(isWidgetPath("/groups")).toBe(true);
    expect(isWidgetPath("/groups/3/events")).toBe(true);
    expect(isWidgetPath("/groups/join")).toBe(true);
    expect(isWidgetPath("/me")).toBe(false);
    expect(isWidgetPath("/me/push-devices")).toBe(false);
  });
  it("다시 보낼 때: 처음, 10분 지남, KST 날 바뀜", () => {
    expect(widgetRefreshDue(null, NOW)).toBe(true);
    expect(widgetRefreshDue(NOW, NOW + 9 * 60_000)).toBe(false);
    expect(widgetRefreshDue(NOW, NOW + 10 * 60_000)).toBe(true);
    const lateNight = Date.parse("2026-11-12T14:58:00.000Z");
    expect(widgetRefreshDue(lateNight, lateNight + 3 * 60_000)).toBe(true);
  });
});
