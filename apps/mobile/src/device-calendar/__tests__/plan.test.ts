import { addDateKey, allDayDates, eventHash, FORMAT_VERSION, hashText, planSync, runPool, toDeviceEvent } from "../plan";
import { allDay, timed } from "./fixture";

/** 고정 시차(시간) 기기의 그 시각 (CI 시간대와 무관하게) */
const offsetLocal = (hours: number) => (y: number, mi: number, d: number, h: number, min: number, sec: number) =>
  new Date(Date.UTC(y, mi, d, h, min, sec) - hours * 60 * 60 * 1000);
const KST = offsetLocal(9);
const LA = offsetLocal(-8);

describe("(#549) 종일 날짜 변환 (ICS: KST 날짜, 배타 끝)", () => {
  it("Android: UTC 자정, 끝 배타, 시간대 UTC (기기 시간대와 무관)", () => {
    for (const local of [KST, LA, offsetLocal(0)]) {
      const d = allDayDates("2026-11-28", "2026-11-29", "android", local);
      expect(d.startDate.toISOString()).toBe("2026-11-28T00:00:00.000Z");
      expect(d.endDate.toISOString()).toBe("2026-11-29T00:00:00.000Z");
      expect(d.timeZone).toBe("UTC");
      expect(d.endTimeZone).toBe("UTC");
    }
  });

  it("Android 여러 날: 11/28 ~ 11/30 (끝 12/1 배타)", () => {
    const d = allDayDates("2026-11-28", "2026-12-01", "android");
    expect(d.startDate.toISOString()).toBe("2026-11-28T00:00:00.000Z");
    expect(d.endDate.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("iOS (KST 기기): 그날 0시 ~ 마지막 날 23:59:59, 시간대 없음(떠 있는 날짜)", () => {
    const d = allDayDates("2026-11-28", "2026-11-29", "ios", KST);
    expect(d.startDate.toISOString()).toBe("2026-11-27T15:00:00.000Z"); // KST 11/28 00:00
    expect(d.endDate.toISOString()).toBe("2026-11-28T14:59:59.000Z"); // KST 11/28 23:59:59
    expect(d.timeZone).toBeUndefined();
  });

  it("iOS 여러 날과 달 넘김 (KST): 11/30 ~ 12/2", () => {
    const d = allDayDates("2026-11-30", "2026-12-03", "ios", KST);
    expect(d.startDate.toISOString()).toBe("2026-11-29T15:00:00.000Z");
    expect(d.endDate.toISOString()).toBe("2026-12-02T14:59:59.000Z");
  });

  it("iOS 해외 기기(LA)에서도 날짜는 그대로 (기기 시간대의 그날)", () => {
    const d = allDayDates("2026-11-28", "2026-11-29", "ios", LA);
    expect(d.startDate.toISOString()).toBe("2026-11-28T08:00:00.000Z"); // LA 11/28 00:00 (PST)
    expect(d.endDate.toISOString()).toBe("2026-11-29T07:59:59.000Z"); // LA 11/28 23:59:59
  });

  it("iOS 기본값은 실행 중인 기기 시간대의 그날 0시 ~ 23:59:59", () => {
    const d = allDayDates("2026-11-28", "2026-11-29", "ios");
    expect([d.startDate.getFullYear(), d.startDate.getMonth() + 1, d.startDate.getDate(), d.startDate.getHours()]).toEqual([2026, 11, 28, 0]);
    expect([d.endDate.getMonth() + 1, d.endDate.getDate(), d.endDate.getHours(), d.endDate.getMinutes(), d.endDate.getSeconds()]).toEqual([11, 28, 23, 59, 59]);
  });

  it("addDateKey: 해 넘김, 윤년", () => {
    expect(addDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDateKey("2028-03-01", -1)).toBe("2028-02-29");
  });
});

describe("(#549) toDeviceEvent", () => {
  it("시간 일정: 순간 그대로, 시간대 Asia/Seoul. 알림 없음은 글루가 넣는다", () => {
    const d = toDeviceEvent(timed(1, { location: "성수", notes: "참여: 모두" }), "android");
    expect(d).toEqual({
      title: "일정 1",
      allDay: false,
      startDate: new Date("2026-11-27T10:00:00.000Z"),
      endDate: new Date("2026-11-27T11:00:00.000Z"),
      timeZone: "Asia/Seoul",
      endTimeZone: "Asia/Seoul",
      location: "성수",
      // Android 는 URL 칸이 없어 메모 끝 줄로
      notes: "참여: 모두\n\nhttps://whenwemeet.day/events/abc1?team=team1xxx",
    });
    const ios = toDeviceEvent(timed(1, { notes: "참여: 모두" }), "ios");
    expect(ios.endTimeZone).toBeUndefined();
    expect(ios.notes).toBe("참여: 모두");
    expect(ios.url).toBe("https://whenwemeet.day/events/abc1?team=team1xxx");
    expect(toDeviceEvent(timed(1), "android").notes).toBe("https://whenwemeet.day/events/abc1?team=team1xxx");
  });

  it("빈 장소, 메모는 빈 글자 (고칠 때 이전 값을 지운다)", () => {
    const d = toDeviceEvent(allDay(2, "2026-11-28", "2026-11-29"), "android");
    expect(d.location).toBe("");
    expect(d.notes).toBe("");
    expect(d.allDay).toBe(true);
    expect(d.url).toBeUndefined();
  });
});

describe("(#549) 해시", () => {
  it("같은 내용은 같은 해시, 어느 칸이 바뀌어도 다른 해시", () => {
    const a = timed(1);
    expect(eventHash(a)).toBe(eventHash({ ...a }));
    expect(eventHash(a)).toMatch(/^[0-9a-f]{16}$/);
    for (const over of [
      { title: "x" },
      { start: "2026-11-27T10:30:00.000Z" },
      { end: "2026-11-27T12:00:00.000Z" },
      { location: "a" },
      { notes: "n" },
      { url: "https://whenwemeet.day/x" },
    ]) {
      expect(eventHash(timed(1, over))).not.toBe(eventHash(a));
    }
    expect(eventHash(allDay(1, "2026-11-27", "2026-11-28"))).not.toBe(eventHash(timed(1)));
  });

  it("UID 는 해시에 넣지 않는다 (매핑 키라)", () => {
    expect(eventHash(timed(1))).toBe(eventHash({ ...timed(1), uid: "e2@whenwemeet.day" }));
  });

  it("hashText 는 결정적이고 한글을 구분한다", () => {
    expect(hashText("민지")).toBe(hashText("민지"));
    expect(hashText("민지")).not.toBe(hashText("지훈"));
    expect(FORMAT_VERSION).toBe(1);
  });
});

describe("(#549) planSync", () => {
  const a = timed(1);
  const b = timed(2);
  const c = timed(3);

  it("처음: 전부 만든다", () => {
    const p = planSync([a, b], {}, new Set());
    expect(p.create.map((x) => x.ev.uid)).toEqual([a.uid, b.uid]);
    expect(p.update).toEqual([]);
    expect(p.remove).toEqual([]);
  });

  it("같으면 그대로, 바뀌면 고치고, 빠지면 지운다", () => {
    const mapping = {
      [a.uid]: { id: "d1", h: eventHash(a) },
      [b.uid]: { id: "d2", h: "old" },
      [c.uid]: { id: "d3", h: eventHash(c) },
    };
    const p = planSync([a, b], mapping, new Set(["d1", "d2", "d3"]));
    expect(p.keep).toEqual({ [a.uid]: mapping[a.uid] });
    expect(p.update).toEqual([{ ev: b, h: eventHash(b), id: "d2" }]);
    expect(p.remove).toEqual([{ uid: c.uid, id: "d3" }]);
    expect(p.create).toEqual([]);
  });

  it("사용자가 휴대폰에서 지웠거나 다른 캘린더로 옮긴 일정: 그 id 는 건드리지 않고 새로 만든다", () => {
    const mapping = { [a.uid]: { id: "gone", h: eventHash(a) }, [c.uid]: { id: "moved", h: eventHash(c) } };
    const p = planSync([a], mapping, new Set());
    expect(p.create.map((x) => x.ev.uid)).toEqual([a.uid]);
    // 빠진 c 도 우리 캘린더에 없으므로 지우지 않는다 (다른 캘린더의 일정을 지우지 않음)
    expect(p.remove).toEqual([]);
  });

  it("빈 스냅샷: 매핑된 것 전부 지운다", () => {
    const mapping = { [a.uid]: { id: "d1", h: eventHash(a) } };
    expect(planSync([], mapping, new Set(["d1"])).remove).toEqual([{ uid: a.uid, id: "d1" }]);
  });

  it("present 가 null 이면 매핑을 믿는다", () => {
    const mapping = { [a.uid]: { id: "d1", h: "old" } };
    expect(planSync([a], mapping, null).update).toHaveLength(1);
  });
});

describe("runPool", () => {
  it("동시 실행 수를 넘지 않고 모두 돈다", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      done.push(n);
      running -= 1;
    });
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });
  it("빈 목록", async () => {
    await expect(runPool([], 4, async () => undefined)).resolves.toBeUndefined();
  });
});
