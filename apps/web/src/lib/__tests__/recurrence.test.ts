import { describe, expect, it } from "vitest";
import { eventKey, followingUntil, formRepeatOf, keepsLoadedTimes, repeatRuleError } from "../recurrence";
import { eventCopyHref, eventEditHref } from "../routes";
import { kstToIso } from "../date";

const ms = (k: string, t = "00:00") => Date.parse(kstToIso(k, t));

describe("eventKey", () => {
  it("한 번짜리는 id 뒤 빈 칸, 회차는 날짜", () => {
    expect(eventKey({ id: 3, occurrence: null })).toBe("3:");
    expect(eventKey({ id: 3, occurrence: "2026-11-18" })).toBe("3:2026-11-18");
  });
});

describe("repeatRuleError (설계 4-1)", () => {
  it("반복 안 함이면 검사하지 않는다", () => {
    expect(repeatRuleError(null, ms("2026-11-11"), ms("2026-11-20"), "2026-11-11", null)).toBeNull();
  });
  it("길이가 주기 이상이면 거부 (매주 8일, 정확히 7일)", () => {
    expect(repeatRuleError("WEEKLY", ms("2026-11-11"), ms("2026-11-19"), "2026-11-11", null)).toBe("반복 간격보다 긴 일정은 반복할 수 없어요");
    expect(repeatRuleError("WEEKLY", ms("2026-11-11"), ms("2026-11-18"), "2026-11-11", null)).toBe("반복 간격보다 긴 일정은 반복할 수 없어요");
    expect(repeatRuleError("WEEKLY", ms("2026-11-14"), ms("2026-11-16"), "2026-11-14", null)).toBeNull();
    expect(repeatRuleError("BIWEEKLY", ms("2026-11-11"), ms("2026-11-19"), "2026-11-11", null)).toBeNull();
    expect(repeatRuleError("MONTHLY", ms("2026-11-01"), ms("2026-11-29"), "2026-11-01", null)).toBe("반복 간격보다 긴 일정은 반복할 수 없어요");
  });
  it("종료 날짜는 첫 회차 날짜와 같거나 뒤", () => {
    const s = ms("2026-11-11", "19:00");
    const e = ms("2026-11-11", "21:00");
    expect(repeatRuleError("WEEKLY", s, e, "2026-11-11", "2026-11-10")).toBe("종료 날짜는 시작 날짜 뒤여야 해요");
    expect(repeatRuleError("WEEKLY", s, e, "2026-11-11", "2026-11-11")).toBeNull();
    expect(repeatRuleError("WEEKLY", s, e, "2026-11-11", "2026-11-25")).toBeNull();
  });
});

describe("수정, 복제 주소", () => {
  it("회차면 occurrence 를 싣는다", () => {
    expect(eventEditHref({ publicCode: "evntcode", occurrence: null })).toBe("/events/evntcode/edit");
    expect(eventEditHref({ publicCode: "evntcode", occurrence: "2026-11-18" })).toBe("/events/evntcode/edit?occurrence=2026-11-18");
    expect(eventEditHref({ publicCode: "evntcode", occurrence: "2026-11-18" }, "following")).toBe("/events/evntcode/edit?occurrence=2026-11-18&scope=following");
    expect(eventCopyHref({ publicCode: "evntcode", occurrence: "2026-11-18" })).toBe("/events/new?copy=evntcode&occurrence=2026-11-18");
    expect(eventCopyHref({ publicCode: "evntcode", occurrence: null })).toBe("/events/new?copy=evntcode");
  });
});

describe("followingUntil — 이후 모두 의 종료 날짜 (QA3-L1)", () => {
  it("원본 종료 날짜 그대로면 보내지 않는다 (서버가 이어받고 필요하면 늘린다)", () => {
    expect(followingUntil("2026-11-25", "2026-11-25")).toBeUndefined();
  });

  it("바꿨거나 끄거나(계속) 켰으면 그 값을 보낸다", () => {
    expect(followingUntil("2026-12-31", "2026-11-25")).toBe("2026-12-31");
    expect(followingUntil(null, "2026-11-25")).toBeNull();
    expect(followingUntil("2026-12-31", null)).toBe("2026-12-31");
    expect(followingUntil(null, null)).toBeNull();
  });
});

describe("keepsLoadedTimes — 이후 모두 의 시작, 종료 (QA3-M3)", () => {
  const loaded = { startsAt: "2027-02-28T00:00:00.000Z", endsAt: "2027-02-28T01:00:00.000Z" };
  it("같은 순간이면 그대로 (표기 차이 무시)", () => {
    expect(keepsLoadedTimes({ startsAt: "2027-02-28T09:00:00+09:00", endsAt: "2027-02-28T10:00:00+09:00" }, loaded)).toBe(true);
  });
  it("시작이나 종료가 다르면 바뀜", () => {
    expect(keepsLoadedTimes({ startsAt: "2027-02-28T10:00:00+09:00", endsAt: "2027-02-28T10:00:00+09:00" }, loaded)).toBe(false);
    expect(keepsLoadedTimes({ startsAt: "2027-02-28T09:00:00+09:00", endsAt: "2027-02-28T11:00:00+09:00" }, loaded)).toBe(false);
  });
});

describe("formRepeatOf — 복제는 한 번짜리로 (QA3-L2)", () => {
  it("복제면 반복 안 함, 종료 없음", () => {
    expect(formRepeatOf({ repeat: "WEEKLY", repeatUntil: "2026-12-31" }, true)).toEqual({ repeat: null, until: null });
  });
  it("수정이면 불러온 값 그대로", () => {
    expect(formRepeatOf({ repeat: "WEEKLY", repeatUntil: "2026-12-31" }, false)).toEqual({ repeat: "WEEKLY", until: "2026-12-31" });
    expect(formRepeatOf({ repeat: null, repeatUntil: null }, false)).toEqual({ repeat: null, until: null });
  });
});
