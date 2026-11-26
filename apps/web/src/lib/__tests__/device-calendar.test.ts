// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { appSupportsDeviceCalendar, DEVICE_CALENDAR_UA_TOKEN, encodeBridgeMessage } from "../app-bridge";
import { kstToIso } from "../date";
import {
  allDayRange,
  buildCalendarSnapshot,
  calendarMessageLength,
  calendarWindow,
  CALENDAR_MAX_EVENTS,
  CALENDAR_MESSAGE_MAX,
  decodeCalendarStatus,
  eventUid,
  fitCalendarSnapshot,
  pickTeams,
  rangeChunks,
  readCalendarSettings,
  snapshotKey,
  statusLine,
  storedCalendarEnabled,
  syncedAtText,
  writeCalendarSettings,
  SETTINGS_KEY,
  type CalendarSource,
} from "../device-calendar";
import type { Event, GroupSummary, Member } from "../types";

const ORIGIN = "https://whenwemeet.day";
const TODAY = "2026-11-26";
const NOW = Date.parse(kstToIso(TODAY, "12:00"));
const at = (k: string, t = "00:00") => kstToIso(k, t);
const minji: Member = { userId: 1, displayName: "민지", color: "#5B6CF4", profileImageUrl: null };
const jihun: Member = { userId: 2, displayName: "지훈", color: "#F2994A", profileImageUrl: null };

function ev(id: number, startsAt: string, endsAt: string, extra: Partial<Event> = {}): Event {
  return {
    id,
    groupId: 1,
    publicCode: `code${id}`,
    title: `일정${id}`,
    startsAt,
    endsAt,
    allDay: false,
    memo: "비밀 메모",
    creator: minji,
    createdAt: startsAt,
    updatedAt: startsAt,
    repeat: null,
    repeatUntil: null,
    occurrence: null,
    seriesStartsAt: null,
    repeatAnchor: null,
    participants: { all: false, members: [minji, jihun] },
    ...extra,
  } as Event;
}

function group(id: number, name: string, extra: Partial<GroupSummary> = {}): GroupSummary {
  return { id, type: "TEAM", name, publicCode: `team${id}`.padEnd(8, "x"), memberCount: 2, me: { color: "#5B6CF4", displayName: "나" }, unreadNewsCount: 0, ...extra } as GroupSummary;
}

const src = (groups: GroupSummary[], events: Record<number, Event[]>): CalendarSource => ({
  groups,
  events: new Map(Object.entries(events).map(([k, v]) => [Number(k), v])),
});

describe("(#549) 셸 능력 판정", () => {
  const base = "Mozilla/5.0 (iPhone) WhenwemeetApp/1.3.0 (ios) EmailLogin/1 KakaoShare/1 Widget/1 AccountLink/1";
  it("앱 UA 이고 DeviceCalendar/1 이 있을 때만", () => {
    expect(appSupportsDeviceCalendar(`${base} ${DEVICE_CALENDAR_UA_TOKEN}`)).toBe(true);
    expect(appSupportsDeviceCalendar(base)).toBe(false);
    expect(appSupportsDeviceCalendar("Mozilla/5.0 DeviceCalendar/1")).toBe(false);
    expect(appSupportsDeviceCalendar(`${base} DeviceCalendar/10`)).toBe(false);
    expect(appSupportsDeviceCalendar(null)).toBe(false);
  });
});

describe("(#549) 창과 요청 조각", () => {
  it("과거 30일 ~ 미래 180일, to 는 배타", () => {
    expect(calendarWindow(NOW)).toEqual({ from: "2026-10-27", to: "2027-05-26" });
  });
  it("62일 이하 조각으로 빈틈 없이 (211일 → 4번)", () => {
    const { from, to } = calendarWindow(NOW);
    const c = rangeChunks(from, to);
    expect(c).toHaveLength(4);
    expect(c[0]).toEqual({ from: "2026-10-27", to: "2026-12-28" });
    expect(c[3].to).toBe(to);
    for (let i = 1; i < c.length; i += 1) expect(c[i].from).toBe(c[i - 1].to);
  });
  it("빈 범위는 조각 없음", () => {
    expect(rangeChunks("2026-11-26", "2026-11-26")).toEqual([]);
  });
});

describe("(#549) ICS 와 같은 매핑", () => {
  it("UID: 한 번짜리 e{id}, 반복 회차 e{id}-{원래 날짜}", () => {
    expect(eventUid({ id: 7, repeat: null, occurrence: null })).toBe("e7@whenwemeet.day");
    expect(eventUid({ id: 7, repeat: "WEEKLY", occurrence: "2026-12-03" })).toBe("e7-20261203@whenwemeet.day");
  });

  it("종일: KST 날짜, 끝 배타 (끝 순간 바로 앞 날 + 1)", () => {
    expect(allDayRange(at("2026-11-28"), at("2026-11-29"))).toEqual({ start: "2026-11-28", end: "2026-11-29" });
    expect(allDayRange(at("2026-11-28"), at("2026-12-01"))).toEqual({ start: "2026-11-28", end: "2026-12-01" });
    // 자정이 아닌 끝도 그날까지
    expect(allDayRange(at("2026-11-28"), at("2026-11-28", "23:59"))).toEqual({ start: "2026-11-28", end: "2026-11-29" });
  });
});

describe("(#549) buildCalendarSnapshot", () => {
  it("시간 일정과 종일, 참여자 줄, 상세 주소, 메모는 넣지 않는다", () => {
    const g = group(1, "우리 둘");
    const s = buildCalendarSnapshot(
      src([g], {
        1: [
          ev(1, at("2026-11-27", "19:00"), at("2026-11-27", "21:00"), { title: "저녁", place: { text: "성수 카페", query: null, kakaoPlaceId: null, url: null } }),
          ev(2, at("2026-11-28"), at("2026-11-29"), { allDay: true, title: "여행", participants: { all: true, members: [minji, jihun] } }),
        ],
      }),
      NOW,
      ORIGIN,
    );
    expect(s.generatedAt).toBe(new Date(NOW).toISOString());
    expect(s.events).toEqual([
      {
        uid: "e1@whenwemeet.day",
        title: "저녁",
        allDay: false,
        start: "2026-11-27T10:00:00.000Z",
        end: "2026-11-27T12:00:00.000Z",
        location: "성수 카페",
        notes: "참여: 민지, 지훈",
        url: "https://whenwemeet.day/events/code1?team=team1xxx",
      },
      { uid: "e2@whenwemeet.day", title: "여행", allDay: true, start: "2026-11-28", end: "2026-11-29", notes: "참여: 모두", url: "https://whenwemeet.day/events/code2?team=team1xxx" },
    ]);
    expect(JSON.stringify(s)).not.toContain("비밀 메모");
  });

  it("반복 회차(API 가 펼친 것)는 회차마다 UID, 상세 주소에 occurrence. 예외 제목도 그대로", () => {
    const g = group(1, "우리 둘");
    const s = buildCalendarSnapshot(
      src([g], {
        1: [
          ev(5, at("2026-12-03", "10:00"), at("2026-12-03", "11:00"), { repeat: "WEEKLY", occurrence: "2026-12-03" }),
          ev(5, at("2026-12-11", "10:00"), at("2026-12-11", "11:00"), { repeat: "WEEKLY", occurrence: "2026-12-10", title: "옮긴 회차" }),
        ],
      }),
      NOW,
      ORIGIN,
    );
    expect(s.events.map((e) => [e.uid, e.title, e.url])).toEqual([
      ["e5-20261203@whenwemeet.day", "일정5", "https://whenwemeet.day/events/code5?team=team1xxx&occurrence=2026-12-03"],
      ["e5-20261210@whenwemeet.day", "옮긴 회차", "https://whenwemeet.day/events/code5?team=team1xxx&occurrence=2026-12-10"],
    ]);
  });

  it("조각 경계에 걸쳐 두 번 온 일정은 한 번만, 창 밖 일정은 뺀다", () => {
    const g = group(1, "우리 둘");
    const cross = ev(9, at("2026-12-27", "22:00"), at("2026-12-28", "02:00"));
    const s = buildCalendarSnapshot(
      src([g], {
        1: [cross, cross, ev(10, at("2026-10-01"), at("2026-10-01", "01:00")), ev(11, at("2027-06-30"), at("2027-06-30", "01:00")), ev(12, at("2026-10-26", "23:00"), at("2026-10-27", "01:00"))],
      }),
      NOW,
      ORIGIN,
    );
    expect(s.events.map((e) => e.uid)).toEqual(["e12@whenwemeet.day", "e9@whenwemeet.day"]);
  });

  it("개인 팀은 참여자 줄 없음, 팀이 둘 이상이면 팀 줄", () => {
    const personal = group(1, "내 일정", { type: "PERSONAL", memberCount: 1 });
    const team = group(2, "가족");
    const s = buildCalendarSnapshot(
      src([personal, team], {
        1: [ev(1, at("2026-11-27", "09:00"), at("2026-11-27", "10:00"))],
        2: [ev(2, at("2026-11-27", "11:00"), at("2026-11-27", "12:00"), { groupId: 2, participants: { all: false, members: [] } })],
      }),
      NOW,
      ORIGIN,
    );
    expect(s.events.map((e) => e.notes)).toEqual(["팀: 내 일정", "팀: 가족"]);
    const single = buildCalendarSnapshot(src([personal], { 1: [ev(1, at("2026-11-27", "09:00"), at("2026-11-27", "10:00"))] }), NOW, ORIGIN);
    expect(single.events[0].notes).toBeUndefined();
  });

  it("옛 API(participants 없음)는 등록자 한 명", () => {
    const s = buildCalendarSnapshot(src([group(1, "a")], { 1: [ev(1, at("2026-11-27", "09:00"), at("2026-11-27", "10:00"), { participants: undefined })] }), NOW, ORIGIN);
    expect(s.events[0].notes).toBe("참여: 민지");
  });

  it("제목은 제어문자를 띄어쓰기로, 200자에서 자른다", () => {
    const s = buildCalendarSnapshot(src([group(1, "a")], { 1: [ev(1, at("2026-11-27", "09:00"), at("2026-11-27", "10:00"), { title: `줄\n바꿈${"가".repeat(300)}` })] }), NOW, ORIGIN);
    expect(s.events[0].title.startsWith("줄 바꿈")).toBe(true);
    expect(s.events[0].title.length).toBeLessThanOrEqual(200);
  });

  it("시작 순 정렬, 3000개를 넘으면 먼 미래부터 뺀다", () => {
    const many = Array.from({ length: CALENDAR_MAX_EVENTS + 5 }, (_, i) => ev(i + 1, new Date(NOW + (CALENDAR_MAX_EVENTS + 5 - i) * 60_000).toISOString(), new Date(NOW + (CALENDAR_MAX_EVENTS + 6 - i) * 60_000).toISOString()));
    const s = buildCalendarSnapshot(src([group(1, "a")], { 1: many }), NOW, ORIGIN);
    expect(s.events).toHaveLength(CALENDAR_MAX_EVENTS);
    expect(s.events[0].uid).toBe(`e${CALENDAR_MAX_EVENTS + 5}@whenwemeet.day`);
    expect(s.events.some((e) => e.uid === "e1@whenwemeet.day")).toBe(false);
  });
});

describe("(#549) 크기와 비교 키", () => {
  it("1.5MB 를 넘으면 뒤(먼 미래)부터 뺀다", () => {
    const events = Array.from({ length: 3000 }, (_, i) => ({ uid: `e${i}@whenwemeet.day`, title: "가".repeat(200), allDay: false as const, start: "2026-11-27T00:00:00.000Z", end: "2026-11-27T01:00:00.000Z", notes: "n".repeat(400) }));
    const big = { generatedAt: new Date(NOW).toISOString(), events };
    expect(calendarMessageLength(big)).toBeGreaterThan(CALENDAR_MESSAGE_MAX);
    const fit = fitCalendarSnapshot(big);
    expect(calendarMessageLength(fit)).toBeLessThanOrEqual(CALENDAR_MESSAGE_MAX);
    expect(fit.events[0].uid).toBe("e0@whenwemeet.day");
    expect(fit.events.length).toBeGreaterThan(2000);
  });
  it("작으면 그대로, 실제 보낼 문자열 길이와 같은 계산", () => {
    const s = buildCalendarSnapshot(src([group(1, "a")], { 1: [ev(1, at("2026-11-27", "09:00"), at("2026-11-27", "10:00"))] }), NOW, ORIGIN);
    expect(fitCalendarSnapshot(s)).toEqual(s);
    expect(calendarMessageLength(s, "abc")).toBe(encodeBridgeMessage({ type: "calendarSync", snapshot: s, id: "abc" }).length);
  });
  it("비교 키는 만든 시각과 무관", () => {
    const a = buildCalendarSnapshot(src([group(1, "a")], { 1: [ev(1, at("2026-11-27", "09:00"), at("2026-11-27", "10:00"))] }), NOW, ORIGIN);
    const b = { ...a, generatedAt: "2026-11-27T00:00:00.000Z" };
    expect(snapshotKey(a)).toBe(snapshotKey(b));
  });
});

describe("(#549) 팀 고르기", () => {
  const gs = [group(1, "a"), group(2, "b", { hidden: { reason: "x", hiddenAt: "2026-11-01T00:00:00Z" } }), group(3, "c")];
  it("null 이면 전부(숨김 팀 제외), 고른 것 중 없어진 팀은 무시", () => {
    expect(pickTeams(gs, null).map((g) => g.id)).toEqual([1, 3]);
    expect(pickTeams(gs, [3, 2, 99]).map((g) => g.id)).toEqual([3]);
  });
});

describe("(#549) 설정 저장", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it("사용자마다: 다른 사용자 설정은 기본값", () => {
    const s = mem();
    writeCalendarSettings({ userId: 1, enabled: true, teams: [3] }, s);
    expect(readCalendarSettings(1, s)).toEqual({ userId: 1, enabled: true, teams: [3] });
    expect(readCalendarSettings(2, s)).toEqual({ userId: 2, enabled: false, teams: null });
    expect(storedCalendarEnabled(s)).toBe(true);
  });
  it("깨진 값은 기본값", () => {
    const s = mem();
    s.m.set(SETTINGS_KEY, "{oops");
    expect(readCalendarSettings(1, s)).toEqual({ userId: 1, enabled: false, teams: null });
    expect(storedCalendarEnabled(s)).toBe(false);
    s.m.set(SETTINGS_KEY, JSON.stringify({ userId: 1, enabled: true, teams: [1, "x", -1, 2] }));
    expect(readCalendarSettings(1, s).teams).toEqual([1, 2]);
  });
  it("저장하면 설정 이벤트를 쏜다", () => {
    const fn = vi.fn();
    window.addEventListener("wwm:device-calendar-settings", fn);
    writeCalendarSettings({ userId: 1, enabled: false, teams: null }, mem());
    window.removeEventListener("wwm:device-calendar-settings", fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("(#549) 셸 응답", () => {
  const ok = { v: 1, type: "calendarStatus", id: "c1", permission: "granted", canAskAgain: true, enabled: true, lastSyncedAt: "2026-11-26T03:00:00.000Z", count: 3, failed: false };
  it("모양이 맞을 때만", () => {
    expect(decodeCalendarStatus(ok)).toEqual({ id: "c1", permission: "granted", canAskAgain: true, enabled: true, lastSyncedAt: "2026-11-26T03:00:00.000Z", count: 3, failed: false });
    expect(decodeCalendarStatus({ ...ok, type: "pushStatus" })).toBeNull();
    expect(decodeCalendarStatus({ ...ok, permission: "maybe" })).toBeNull();
    expect(decodeCalendarStatus({ ...ok, enabled: "yes" })).toBeNull();
    expect(decodeCalendarStatus({ ...ok, v: 2 })).toBeNull();
    expect(decodeCalendarStatus({ ...ok, count: -1, lastSyncedAt: "어제" })).toMatchObject({ count: 0, lastSyncedAt: null });
  });
});

describe("(#549) 상태 줄", () => {
  afterEach(() => vi.useRealTimers());
  it("오늘, 어제, 그 전 (KST)", () => {
    expect(syncedAtText(kstToIso(TODAY, "09:05"), NOW)).toBe("오늘 09:05");
    expect(syncedAtText(kstToIso("2026-11-25", "21:30"), NOW)).toBe("어제 21:30");
    expect(syncedAtText(kstToIso("2026-11-20", "08:00"), NOW)).toBe("11월 20일 08:00");
  });
  it("실패, 아직, 맞춤", () => {
    expect(statusLine({ lastSyncedAt: null, count: 0, failed: false }, NOW)).toContain("아직");
    expect(statusLine({ lastSyncedAt: kstToIso(TODAY, "09:05"), count: 12, failed: false }, NOW)).toBe("마지막으로 맞춘 시각 오늘 09:05, 일정 12개");
    expect(statusLine({ lastSyncedAt: null, count: 0, failed: true }, NOW)).toContain("넣지 못했어요");
  });
});
