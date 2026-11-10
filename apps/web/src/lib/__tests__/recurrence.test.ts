import { describe, expect, it } from "vitest";
import { eventCopyHref, eventEditHref, eventKey, repeatRuleError } from "../recurrence";
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
    expect(eventEditHref(2, { id: 5, occurrence: null })).toBe("/g/2/events/5");
    expect(eventEditHref(2, { id: 5, occurrence: "2026-11-18" })).toBe("/g/2/events/5?occurrence=2026-11-18");
    expect(eventCopyHref(2, { id: 5, occurrence: "2026-11-18" })).toBe("/g/2/events/new?copy=5&occurrence=2026-11-18");
  });
});
