import { eventHash, type DeviceEventDetails } from "../plan";
import type { CalendarSnapshot } from "../snapshot";
import { type CalendarApi, DeviceCalendarSync, EMPTY_STATE, loadState, type StateFile, toCalendarPermission } from "../sync";
import { GENERATED, timed } from "./fixture";

type FakeEvent = { calendarId: string; details: DeviceEventDetails };

/** 메모리 기기 캘린더. 사용자 캘린더("내 캘린더")에 일정 하나가 미리 있다 */
function fakeDevice(os: "ios" | "android" = "ios") {
  const calendars = new Map<string, string>([["user", "내 캘린더"]]);
  const events = new Map<string, FakeEvent>([["u1", { calendarId: "user", details: {} as DeviceEventDetails }]]);
  let seq = 0;
  const perm = { status: "undetermined", canAskAgain: true };
  const calls: string[] = [];
  const fail = new Set<string>();
  const api: CalendarApi = {
    os,
    getPermission: async () => ({ ...perm }),
    requestPermission: async () => {
      calls.push("request");
      perm.status = "granted";
      return { ...perm };
    },
    listOurCalendars: async () => [...calendars].filter(([, t]) => t === "언제볼까").map(([id]) => ({ id })),
    createCalendar: async () => {
      const id = `cal${++seq}`;
      calendars.set(id, "언제볼까");
      calls.push(`createCalendar ${id}`);
      return id;
    },
    deleteCalendar: async (id) => {
      if (calendars.get(id) !== "언제볼까") throw new Error("우리 캘린더가 아님");
      calendars.delete(id);
      for (const [eid, e] of events) if (e.calendarId === id) events.delete(eid);
      calls.push(`deleteCalendar ${id}`);
    },
    listEventIds: async (cid) => [...events].filter(([, e]) => e.calendarId === cid).map(([id]) => id),
    createEvent: async (cid, details) => {
      if (fail.has(details.title)) throw new Error("실패");
      const id = `ev${++seq}`;
      events.set(id, { calendarId: cid, details });
      calls.push(`create ${details.title}`);
      return id;
    },
    updateEvent: async (id, details) => {
      if (fail.has(details.title)) throw new Error("실패");
      const e = events.get(id);
      if (!e || calendars.get(e.calendarId) !== "언제볼까") throw new Error("우리 일정이 아님");
      e.details = details;
      calls.push(`update ${details.title}`);
    },
    deleteEvent: async (id) => {
      const e = events.get(id);
      if (!e || calendars.get(e.calendarId) !== "언제볼까") throw new Error("우리 일정이 아님");
      events.delete(id);
      calls.push(`delete ${id}`);
    },
  };
  return { api, calendars, events, perm, calls, fail };
}

function memFile(): StateFile & { text: string | null } {
  const f = {
    text: null as string | null,
    read: () => f.text,
    write: (t: string) => {
      f.text = t;
    },
    remove: () => {
      f.text = null;
    },
  };
  return f;
}

const NOW = Date.parse(GENERATED);
const snap = (...events: ReturnType<typeof timed>[]): CalendarSnapshot => ({ generatedAt: GENERATED, events });
const ours = (d: ReturnType<typeof fakeDevice>) =>
  [...d.events.values()]
    .filter((e) => e.calendarId !== "user")
    .map((e) => e.details.title)
    .sort();

describe("(#549) DeviceCalendarSync", () => {
  it("켜기 전에는 스냅샷을 무시한다", async () => {
    const d = fakeDevice();
    const s = new DeviceCalendarSync(d.api, memFile(), () => NOW);
    await s.sync(snap(timed(1)));
    expect(d.calls).toEqual([]);
    expect((await s.status("a")).enabled).toBe(false);
  });

  it("켜기: 권한 요청 → 캘린더 만들기 → 맞추기 → 상태", async () => {
    const d = fakeDevice();
    const file = memFile();
    const s = new DeviceCalendarSync(d.api, file, () => NOW);
    const r = await s.enable("e1");
    expect(r).toMatchObject({ v: 1, type: "calendarStatus", id: "e1", permission: "granted", enabled: true, count: 0, lastSyncedAt: null, failed: false });
    expect(d.calls).toEqual(["request", "createCalendar cal1"]);

    await s.sync(snap(timed(1), timed(2)));
    expect(ours(d)).toEqual(["일정 1", "일정 2"]);
    const st = await s.status("s1");
    expect(st).toMatchObject({ enabled: true, count: 2, failed: false, lastSyncedAt: GENERATED });
    expect(loadState(file).events[timed(1).uid].h).toBe(eventHash(timed(1)));
  });

  it("두 번째 맞추기: 바뀐 것만 고치고 빠진 것은 지운다. 사용자 캘린더는 건드리지 않는다", async () => {
    const d = fakeDevice();
    const s = new DeviceCalendarSync(d.api, memFile(), () => NOW);
    await s.enable("e");
    await s.sync(snap(timed(1), timed(2), timed(3)));
    d.calls.length = 0;
    await s.sync(snap(timed(1), timed(2, { title: "바뀐 2" })));
    expect(d.calls.filter((c) => !c.startsWith("delete"))).toEqual(["update 바뀐 2"]);
    expect(d.calls.filter((c) => c.startsWith("delete"))).toHaveLength(1);
    expect(ours(d)).toEqual(["바뀐 2", "일정 1"]);
    expect(d.events.has("u1")).toBe(true);
  });

  it("그대로면 아무것도 쓰지 않는다", async () => {
    const d = fakeDevice();
    const s = new DeviceCalendarSync(d.api, memFile(), () => NOW);
    await s.enable("e");
    await s.sync(snap(timed(1)));
    d.calls.length = 0;
    await s.sync(snap(timed(1)));
    expect(d.calls).toEqual([]);
  });

  it("사용자가 휴대폰에서 지운 일정은 다시 만든다", async () => {
    const d = fakeDevice();
    const s = new DeviceCalendarSync(d.api, memFile(), () => NOW);
    await s.enable("e");
    await s.sync(snap(timed(1)));
    for (const [id, e] of d.events) if (e.details.title === "일정 1") d.events.delete(id);
    await s.sync(snap(timed(1)));
    expect(ours(d)).toEqual(["일정 1"]);
  });

  it("일부 실패: 실패한 것은 다음에 다시, failed 표시와 마지막 시각 유지", async () => {
    const d = fakeDevice();
    const s = new DeviceCalendarSync(d.api, memFile(), () => NOW);
    await s.enable("e");
    d.fail.add("일정 2");
    await s.sync(snap(timed(1), timed(2)));
    expect(await s.status("x")).toMatchObject({ count: 1, failed: true, lastSyncedAt: null });
    d.fail.clear();
    await s.sync(snap(timed(1), timed(2)));
    expect(ours(d)).toEqual(["일정 1", "일정 2"]);
    expect(await s.status("x")).toMatchObject({ count: 2, failed: false });
  });

  it("고치기 실패면 옛 해시를 남겨 다음에 다시 고친다", async () => {
    const d = fakeDevice();
    const file = memFile();
    const s = new DeviceCalendarSync(d.api, file, () => NOW);
    await s.enable("e");
    await s.sync(snap(timed(1)));
    d.fail.add("새 제목");
    await s.sync(snap(timed(1, { title: "새 제목" })));
    expect(loadState(file).events[timed(1).uid].h).toBe(eventHash(timed(1)));
    d.fail.clear();
    await s.sync(snap(timed(1, { title: "새 제목" })));
    expect(ours(d)).toEqual(["새 제목"]);
  });

  it("끄기: 우리 캘린더만 통째로 지우고 상태를 비운다", async () => {
    const d = fakeDevice();
    const file = memFile();
    const s = new DeviceCalendarSync(d.api, file, () => NOW);
    await s.enable("e");
    await s.sync(snap(timed(1)));
    const r = await s.disable("off");
    expect(r).toMatchObject({ id: "off", enabled: false, count: 0, lastSyncedAt: null });
    expect([...d.calendars.keys()]).toEqual(["user"]);
    expect(d.events.has("u1")).toBe(true);
    expect(file.text).toBeNull();
  });

  it("저장된 캘린더가 사라졌으면(사용자가 지움) 같은 이름의 남은 것을 지우고 새로 만든다", async () => {
    const d = fakeDevice();
    const s = new DeviceCalendarSync(d.api, memFile(), () => NOW);
    await s.enable("e");
    await s.sync(snap(timed(1)));
    // 사용자가 언제볼까 캘린더를 지움 (일정도 같이 사라짐) + 재설치로 남은 같은 이름 캘린더
    d.calendars.delete("cal1");
    for (const [id, e] of d.events) if (e.calendarId === "cal1") d.events.delete(id);
    d.calendars.set("orphan", "언제볼까");
    await s.sync(snap(timed(1)));
    expect([...d.calendars.keys()].filter((k) => k !== "user")).toHaveLength(1);
    expect(d.calls).toContain("deleteCalendar orphan");
    expect(ours(d)).toEqual(["일정 1"]);
  });

  it("권한을 기기 설정에서 끄면 켜짐으로 보이지 않고 맞추기는 failed", async () => {
    const d = fakeDevice();
    const s = new DeviceCalendarSync(d.api, memFile(), () => NOW);
    await s.enable("e");
    d.perm.status = "denied";
    d.perm.canAskAgain = false;
    await s.sync(snap(timed(1)));
    expect(await s.status("x")).toMatchObject({ permission: "denied", enabled: false, failed: true });
  });

  it("거부하면 켜지지 않는다 (다시 물을 수 없으면 창 없이)", async () => {
    const d = fakeDevice();
    d.perm.status = "denied";
    d.perm.canAskAgain = false;
    const s = new DeviceCalendarSync(d.api, memFile(), () => NOW);
    expect(await s.enable("e")).toMatchObject({ permission: "denied", enabled: false });
    expect(d.calls).toEqual([]);
  });

  it("맞추는 사이 여러 번 오면 가장 새 것 하나만 이어서 돈다", async () => {
    const d = fakeDevice();
    const s = new DeviceCalendarSync(d.api, memFile(), () => NOW);
    await s.enable("e");
    const p1 = s.sync(snap(timed(1)));
    const p2 = s.sync(snap(timed(2)));
    const p3 = s.sync(snap(timed(3)));
    await Promise.all([p1, p2, p3]);
    expect(ours(d)).toEqual(["일정 3"]);
  });

  it("clear(로그아웃): 켠 적 없으면 아무것도 안 하고, 켰으면 지운다", async () => {
    const d = fakeDevice();
    d.perm.status = "granted";
    d.calendars.set("mine", "언제볼까");
    const s = new DeviceCalendarSync(d.api, memFile(), () => NOW);
    await s.clear();
    expect(d.calls).toEqual([]);
    await s.enable("e");
    await s.clear();
    expect([...d.calendars.keys()]).toEqual(["user"]);
  });

  it("깨진 상태 파일은 빈 상태", () => {
    const f = memFile();
    f.text = "{not json";
    expect(loadState(f)).toEqual(EMPTY_STATE);
    f.text = JSON.stringify({ v: 2, enabled: true });
    expect(loadState(f)).toEqual(EMPTY_STATE);
    f.text = JSON.stringify({ v: 1, enabled: true, calendarId: "c", events: { a: { id: "1", h: "x" }, b: { id: 2 } }, lastSyncedAt: null });
    expect(loadState(f).events).toEqual({ a: { id: "1", h: "x" } });
  });

  it("toCalendarPermission", () => {
    expect(toCalendarPermission({ status: "granted", canAskAgain: true })).toBe("granted");
    expect(toCalendarPermission({ status: "denied", canAskAgain: true })).toBe("undetermined");
    expect(toCalendarPermission({ status: "denied", canAskAgain: false })).toBe("denied");
    expect(toCalendarPermission({ status: "undetermined", canAskAgain: true })).toBe("undetermined");
  });
});
