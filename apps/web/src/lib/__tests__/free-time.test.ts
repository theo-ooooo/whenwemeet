import { describe, expect, it } from "vitest";
import { ceilToStep, upcomingSlots } from "../free-time";

const t = (iso: string) => Date.parse(iso);
const slot = (s: string, e: string) => ({ startsAt: s, endsAt: e });

describe("ceilToStep (api.md 2.5, D-30)", () => {
  it.each([
    ["2026-11-10T04:07:00.000Z", "2026-11-10T04:30:00.000Z"], // 13:07 KST → 13:30
    ["2026-11-10T05:37:00.000Z", "2026-11-10T06:00:00.000Z"], // 14:37 → 15:00
    ["2026-11-10T05:00:00.000Z", "2026-11-10T05:00:00.000Z"], // 경계는 그대로
    ["2026-11-10T05:00:00.001Z", "2026-11-10T05:30:00.000Z"],
  ])("%s → %s", (input, expected) => {
    expect(new Date(ceilToStep(t(input))).toISOString()).toBe(expected);
  });

  it("단위를 바꿀 수 있다", () => {
    expect(new Date(ceilToStep(t("2026-11-10T05:07:00.000Z"), 15)).toISOString()).toBe("2026-11-10T05:15:00.000Z");
  });
});

describe("upcomingSlots — 달력 개요와 빈 시간 찾기가 같은 값 (#136)", () => {
  const now = t("2026-11-10T04:07:00.000Z"); // 13:07 KST

  it("지금이 걸친 구간은 30분 올림한 시각부터", () => {
    const out = upcomingSlots([slot("2026-11-10T00:00:00.000Z", "2026-11-10T10:30:00.000Z")], 60, now);
    expect(out).toEqual([slot("2026-11-10T04:30:00.000Z", "2026-11-10T10:30:00.000Z")]);
  });

  it("서버가 이미 올려 준 값(13:30)이면 그대로 둔다", () => {
    const s = slot("2026-11-10T04:30:00.000Z", "2026-11-10T10:30:00.000Z");
    expect(upcomingSlots([s], 60, now)).toEqual([s]);
  });

  it("미래 구간은 문자열 그대로", () => {
    const s = slot("2026-11-11T09:00:00+09:00", "2026-11-11T23:00:00+09:00");
    expect(upcomingSlots([s], 120, now)[0]).toBe(s);
  });

  it("잘린 뒤 최소 길이보다 짧으면 뺀다", () => {
    // 12:00~14:00 은 13:30~14:00 (30분) 이 남아 1시간 조건에서 빠진다
    expect(upcomingSlots([slot("2026-11-10T03:00:00.000Z", "2026-11-10T05:00:00.000Z")], 60, now)).toEqual([]);
    expect(upcomingSlots([slot("2026-11-10T03:00:00.000Z", "2026-11-10T05:00:00.000Z")], 30, now)).toHaveLength(1);
  });

  it("이미 지난 구간은 뺀다", () => {
    expect(upcomingSlots([slot("2026-11-10T00:00:00.000Z", "2026-11-10T03:00:00.000Z")], 30, now)).toEqual([]);
  });

  it("두 화면이 같은 응답에서 같은 첫 구간을 고른다", () => {
    const res = [slot("2026-11-10T04:07:00.000Z", "2026-11-10T10:30:00.000Z"), slot("2026-11-11T00:00:00.000Z", "2026-11-11T14:00:00.000Z")];
    const calendar = upcomingSlots(res, 60, now)[0];
    const finder = upcomingSlots(res, 120, now)[0];
    expect(calendar).toEqual(finder);
    expect(calendar.startsAt).toBe("2026-11-10T04:30:00.000Z");
  });

  it("빈 입력", () => {
    expect(upcomingSlots(undefined, 60, now)).toEqual([]);
  });
});
