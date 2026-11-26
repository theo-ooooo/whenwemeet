// (#278) 팀 만들기 쓰임: 칩, 예시 이름, 첫 단계 요청 본문(커플 COUNT_UP, 스터디 매주 첫 회차와 KST), 시작 안내 줄
import { describe, expect, it } from "vitest";
import {
  afterStartHref,
  firstMeetInput,
  firstMeetingDate,
  firstMeetPreview,
  meetingValid,
  nameForChip,
  parsePreset,
  PRESET_CHIPS,
  PRESET_KEYS,
  presetSteps,
  remainingSteps,
  startHref,
  weeklyMeetingInput,
} from "../team-preset";

describe("쓰임 키와 칩", () => {
  it("칩 5개, 마지막은 직접 정하기(null). 코드 키에 커플 전용 용어가 없다", () => {
    expect(PRESET_CHIPS.map((c) => c.label)).toEqual(["커플", "가족", "친구", "스터디", "직접 정하기"]);
    expect(PRESET_CHIPS.at(-1)?.key).toBeNull();
    expect(PRESET_KEYS.join(",")).not.toMatch(/couple/i);
  });

  it("parsePreset 은 네 값만", () => {
    expect(PRESET_KEYS.map((k) => parsePreset(k))).toEqual(["two", "family", "friends", "study"]);
    expect([null, undefined, "", "couple", "TWO", ["two"]].map((v) => parsePreset(v as never))).toEqual([null, null, null, null, null, null]);
  });

  it("칩을 바꾸면 빈 칸이나 앞 예시 이름만 새 예시로 바꾸고, 고친 이름은 둔다", () => {
    expect(nameForChip("", null, "two")).toBe("우리 둘");
    expect(nameForChip("우리 둘", "two", "family")).toBe("우리 가족");
    expect(nameForChip("우리 둘", "two", null)).toBe("");
    expect(nameForChip("김씨네", "family", "study")).toBe("김씨네");
    expect(nameForChip("우리 둘이", "two", "friends")).toBe("우리 둘이");
    expect(nameForChip("  ", null, "friends")).toBe("친구들");
  });

  it("첫 단계 주소와 끝난 뒤 갈 곳", () => {
    expect(startHref("two")).toBe("/groups/start?preset=two");
    expect(startHref("study", { fromCalendar: true })).toBe("/groups/start?preset=study&from=calendar");
    expect(afterStartHref(false)).toBe("/team?invite=1");
    expect(afterStartHref(true)).toBe("/calendar");
  });
});

describe("커플: 처음 만난 날", () => {
  it("COUNT_UP, 이름을 비우면 기본 이름", () => {
    expect(firstMeetInput("  ", "2025-10-03")).toEqual({ name: "처음 만난 날", date: "2025-10-03", kind: "COUNT_UP" });
    expect(firstMeetInput(" 사귄 날 ", "2025-10-03")).toEqual({ name: "사귄 날", date: "2025-10-03", kind: "COUNT_UP" });
  });

  it("미리보기: 오늘 몇 일째와 다음 N일 (해가 바뀌면 연도)", () => {
    expect(firstMeetPreview("2025-10-03", "2026-11-13")).toBe("오늘이 407일째예요. 500일은 2027년 2월 14일 (일)");
    expect(firstMeetPreview("2026-03-01", "2026-11-13")).toBe("오늘이 258일째예요. 300일은 12월 25일 (금)");
    expect(firstMeetPreview("2026-11-13", "2026-11-13")).toBe("오늘이 1일째예요. 100일은 2027년 2월 20일 (토)");
  });

  it("미래 날짜도 된다 (D-n)", () => {
    expect(firstMeetPreview("2026-11-18", "2026-11-13")).toBe("D-5, 그날부터 1일째로 세요");
  });

  it("천 단위는 쉼표", () => {
    expect(firstMeetPreview("2020-01-01", "2026-11-13")).toMatch(/^오늘이 2,509일째예요\. 3,000일은 /);
  });
});

describe("스터디: 매주 정기 모임", () => {
  // 2026-11-13 은 금요일. 09:00Z = KST 18:00
  const fri1800 = new Date("2026-11-13T09:00:00Z");
  const fri1930 = new Date("2026-11-13T10:30:00Z");

  it("오늘이 그 요일이고 시작 전이면 오늘, 지났거나 같으면 다음 주", () => {
    expect(firstMeetingDate(5, "19:00", fri1800)).toBe("2026-11-13");
    expect(firstMeetingDate(5, "19:00", fri1930)).toBe("2026-11-20");
    expect(firstMeetingDate(5, "18:00", fri1800)).toBe("2026-11-20");
  });

  it("다른 요일은 다가오는 그 요일", () => {
    expect(firstMeetingDate(6, "10:00", fri1800)).toBe("2026-11-14");
    expect(firstMeetingDate(4, "19:00", fri1800)).toBe("2026-11-19");
    expect(firstMeetingDate(0, "19:00", fri1800)).toBe("2026-11-15");
  });

  it("KST 기준 날짜 (UTC 로는 전날이어도)", () => {
    // 2026-11-13T16:00Z = KST 11월 14일(토) 01:00
    expect(firstMeetingDate(6, "19:00", new Date("2026-11-13T16:00:00Z"))).toBe("2026-11-14");
  });

  it("요청 본문: 매주, 모두, KST 시각을 UTC ISO 로", () => {
    expect(weeklyMeetingInput({ title: " ", dow: 4, start: "19:00", end: "21:00" }, fri1800)).toEqual({
      title: "정기 모임",
      startsAt: "2026-11-19T10:00:00.000Z",
      endsAt: "2026-11-19T12:00:00.000Z",
      allDay: false,
      repeat: "WEEKLY",
    });
  });

  it("시작이 끝보다 앞이어야 저장", () => {
    const m = { title: "정기 모임", dow: 1, start: "19:00", end: "21:00" };
    expect(meetingValid(m)).toBe(true);
    expect(meetingValid({ ...m, end: "19:00" })).toBe(false);
    expect(meetingValid({ ...m, end: "18:30" })).toBe(false);
    expect(meetingValid({ ...m, title: "가".repeat(51) })).toBe(false);
  });
});

describe("달력 시작 안내 줄", () => {
  it("쓰임마다 세 줄, 첫 줄이 첫 단계", () => {
    expect(presetSteps("two").map((s) => s.href)).toEqual(["/groups/start?preset=two&from=calendar", "/todos?new=1", "/team?feed=1"]);
    expect(presetSteps("family").map((s) => [s.label, s.href])).toEqual([
      ["내 생일 넣기", "/me#birthday"],
      ["가족 기념일 넣기", "/anniversaries"],
      ["다른 캘린더 앱에서 보기", "/team?feed=1"],
    ]);
    expect(presetSteps("friends").map((s) => s.href)).toEqual(["/free", "/events/new", "/todos?new=1"]);
    expect(presetSteps("study").map((s) => s.href)).toEqual(["/groups/start?preset=study&from=calendar", "/calendar?view=week", "/todos?new=1"]);
  });

  it("저장해야 끝나는 단계는 첫 단계 화면이 있는 커플, 스터디의 첫 줄뿐", () => {
    const saves = PRESET_KEYS.flatMap((k) =>
      presetSteps(k)
        .filter((s) => s.saves)
        .map((s) => `${k}:${s.id}`),
    );
    expect(saves).toEqual(["two:first", "study:first"]);
  });

  it("화면 글자에 '구독' 을 쓰지 않는다", () => {
    for (const k of PRESET_KEYS) for (const s of presetSteps(k)) expect(s.label).not.toContain("구독");
  });

  it("끝낸 줄은 빠진다", () => {
    expect(remainingSteps("two", ["first", "feed"]).map((s) => s.id)).toEqual(["todos"]);
    expect(remainingSteps("family", [])).toHaveLength(3);
  });
});
