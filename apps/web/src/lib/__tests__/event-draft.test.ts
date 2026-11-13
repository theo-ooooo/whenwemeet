import { describe, expect, it } from "vitest";
import {
  applyDraft,
  draftChanged,
  draftFromEvent,
  draftTimes,
  draftUntil,
  eventBody,
  eventInput,
  memoHint,
  newDraft,
  quickDetailQuery,
  quickDraft,
  quickInput,
  rangeError,
  ruleChangedOf,
  sentUntilOf,
  timesKeptOf,
  titleError,
  type DraftAction,
  type DraftSpan,
  type EventDraft,
} from "../event-draft";
import { kstToIso } from "../date";
import { MEMBER_COLORS, type EventDetailData, type Member } from "../types";

const D = "2026-11-20";
const run = (d: EventDraft, span: DraftSpan, ...actions: DraftAction[]) => actions.reduce((s, a) => applyDraft(s, a, span), d);
const day = (start = "10:00", end = "11:00") => ({ ...quickDraft(D), startTime: start, endTime: end });
const range = (o: Partial<EventDraft> = {}): EventDraft => ({ ...newDraft({ start: kstToIso(D, "10:00"), end: kstToIso(D, "11:00") }), ...o });

const me: Member = { userId: 1, displayName: "지우", color: MEMBER_COLORS[0], profileImageUrl: null };
const other: Member = { userId: 2, displayName: "하늘", color: MEMBER_COLORS[1], profileImageUrl: null };
const loaded = (o: Partial<EventDetailData> = {}): EventDetailData => ({
  id: 10,
  groupId: 2,
  publicCode: "evnt10xx",
  title: "같이 요리하기",
  startsAt: kstToIso("2026-11-14", "19:30"),
  endsAt: kstToIso("2026-11-14", "21:00"),
  allDay: false,
  memo: "장보기는 번갈아",
  creator: me,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  repeat: null,
  repeatUntil: null,
  occurrence: null,
  seriesStartsAt: null,
  repeatAnchor: null,
  reminder: "MIN_10",
  participants: { all: false, members: [me, other] },
  color: null,
  hasLaterExceptions: false,
  ...o,
});

describe("처음 값", () => {
  it("빠른 추가 기본 10:00~11:00, 그 날 하나", () => {
    expect(quickDraft(D)).toMatchObject({ title: "", allDay: false, startDate: D, endDate: D, startTime: "10:00", endTime: "11:00", reminder: "NONE" });
  });

  it("(#192) 주 보기 빈 칸 시각이면 1시간 뒤까지, 자정에서 멈춘다", () => {
    expect(quickDraft(D, "14:30")).toMatchObject({ startTime: "14:30", endTime: "15:30" });
    expect(quickDraft(D, "23:30")).toMatchObject({ startTime: "23:30", endTime: "24:00" });
  });

  it("새 일정: 주소 시각, 없으면 오늘 10~11시", () => {
    expect(newDraft({ today: D })).toMatchObject({ startDate: D, startTime: "10:00", endDate: D, endTime: "11:00", title: "", allDay: false });
    expect(newDraft({ start: kstToIso(D, "20:00"), end: kstToIso("2026-11-21", "01:00") })).toMatchObject({
      startDate: D,
      startTime: "20:00",
      endDate: "2026-11-21",
      endTime: "01:00",
    });
  });

  it("(#46, #188) 빠른 추가 '자세히' 값: 제목은 50자로 자르고, 종일과 맞지 않는 알림은 없음", () => {
    const q = new URLSearchParams({ title: "가".repeat(60), allDay: "1", reminder: "MIN_10" });
    const d = newDraft({ today: D, query: q });
    expect(d.title).toBe("가".repeat(50));
    expect(d.allDay).toBe(true);
    expect(d.reminder).toBe("NONE");
    expect(newDraft({ today: D, query: new URLSearchParams({ reminder: "DAY_OF_0900", allDay: "1" }) }).reminder).toBe("DAY_OF_0900");
    expect(newDraft({ today: D, query: new URLSearchParams({ reminder: "엉뚱" }) }).reminder).toBe("NONE");
  });

  it("불러온 일정: 종일은 마지막 날 + 00:00, 메모 없음은 빈 칸", () => {
    const d = draftFromEvent(loaded({ allDay: true, startsAt: kstToIso("2026-11-24"), endsAt: kstToIso("2026-11-27"), memo: undefined }), false);
    expect(d).toMatchObject({ allDay: true, startDate: "2026-11-24", endDate: "2026-11-26", endTime: "00:00", memo: "" });
  });

  it("수정은 반복 값 그대로, 복제는 반복 안 함 (QA3-L2). 알림, 참여자, 색은 둘 다 원본", () => {
    const ev = loaded({ repeat: "WEEKLY", repeatUntil: "2026-12-31", color: "#FF8A65" });
    expect(draftFromEvent(ev, false)).toMatchObject({ repeat: "WEEKLY", untilOn: true, untilDate: "2026-12-31", reminder: "MIN_10", pick: [1, 2], color: "#FF8A65" });
    expect(draftFromEvent(ev, true)).toMatchObject({ repeat: null, untilOn: false, untilDate: "", reminder: "MIN_10", pick: [1, 2], color: "#FF8A65" });
  });
});

describe("빠른 추가 (span day)", () => {
  it("시작을 옮기면 길이를 유지한다", () => {
    expect(run(day("10:00", "11:30"), "day", { type: "start", date: D, time: "14:00" })).toMatchObject({ startTime: "14:00", endTime: "15:30" });
  });

  it("시작을 옮겨 종료가 자정을 넘으면 자정(24:00) 에서 멈춘다", () => {
    expect(run(day("14:00", "16:30"), "day", { type: "start", date: D, time: "23:00" })).toMatchObject({ startTime: "23:00", endTime: "24:00" });
  });

  it("길이가 0 이하(거꾸로)면 1시간으로 본다", () => {
    expect(run(day("10:00", "10:00"), "day", { type: "start", date: D, time: "12:00" })).toMatchObject({ endTime: "13:00" });
  });

  it("시작이 시각 모양이 아니면 종료는 그대로", () => {
    expect(run(day("10:00", "11:00"), "day", { type: "start", date: D, time: "" })).toMatchObject({ startTime: "", endTime: "11:00" });
  });

  it("(#67) 종료가 시작보다 앞서거나 같으면 시작 1시간 뒤", () => {
    expect(run(day("14:00", "15:00"), "day", { type: "end", date: D, time: "13:00", by: "time" })).toMatchObject({ endTime: "15:00" });
    expect(run(day("14:00", "15:00"), "day", { type: "end", date: D, time: "14:00", by: "time" })).toMatchObject({ endTime: "15:00" });
    expect(run(day("14:00", "15:00"), "day", { type: "end", date: D, time: "16:30", by: "time" })).toMatchObject({ endTime: "16:30" });
  });

  it("(#67) 보정도 자정에서 멈춘다", () => {
    expect(run(day("23:30", "24:00"), "day", { type: "end", date: D, time: "23:00", by: "time" })).toMatchObject({ endTime: "24:00" });
  });

  it("날짜는 바꾸지 않는다 (하루 안)", () => {
    const d = run(day("22:00", "23:00"), "day", { type: "start", date: "2026-11-21", time: "23:30" }, { type: "end", date: "2026-11-25", time: "10:00", by: "time" });
    expect(d).toMatchObject({ startDate: D, endDate: D });
  });

  it("종일 전환은 알림만 맞춘다 (시각은 그대로)", () => {
    const d = run({ ...day("14:00", "15:00"), reminder: "HOUR_1" }, "day", { type: "allDay", value: true });
    expect(d).toMatchObject({ allDay: true, reminder: "NONE", startTime: "14:00", endTime: "15:00" });
    const back = run({ ...d, reminder: "DAY_OF_0900" }, "day", { type: "allDay", value: false });
    expect(back.reminder).toBe("NONE");
  });

  it("범위 오류는 같은 날 시각 순서만 (종일은 없음)", () => {
    expect(rangeError(day("10:00", "11:00"), "day")).toBeNull();
    expect(rangeError(day("10:00", "24:00"), "day")).toBeNull();
    expect(rangeError(day("10:00", "10:00"), "day")).toBe("종료는 시작보다 뒤여야 해요");
    expect(rangeError(day("", "11:00"), "day")).toBe("종료는 시작보다 뒤여야 해요");
    expect(rangeError({ ...day("10:00", "09:00"), allDay: true }, "day")).toBeNull();
  });

  it("저장 본문: 제목 앞뒤 공백 제거, 알림 없음이면 생략, 24:00 은 다음 날 자정", () => {
    expect(quickInput({ ...day("23:00", "24:00"), title: "  야식 " })).toEqual({
      title: "야식",
      startsAt: kstToIso(D, "23:00"),
      endsAt: kstToIso("2026-11-21", "00:00"),
      allDay: false,
    });
    expect(quickInput({ ...day(), title: "a", reminder: "MIN_10" }).reminder).toBe("MIN_10");
  });

  it("저장 본문: 종일은 그날 자정 ~ 다음 날 자정", () => {
    const b = quickInput({ ...day(), title: "a", allDay: true });
    expect(b).toMatchObject({ allDay: true, startsAt: kstToIso(D), endsAt: kstToIso("2026-11-21") });
  });

  it("'자세히' 주소 값: 종일이어도 시각을 넘기고, 빈 제목과 알림 없음은 뺀다", () => {
    const q = quickDetailQuery({ ...day("14:00", "15:00"), title: " 회의 ", allDay: true, reminder: "DAY_OF_0900" });
    expect(Object.fromEntries(q)).toEqual({ start: kstToIso(D, "14:00"), end: kstToIso(D, "15:00"), title: "회의", allDay: "1", reminder: "DAY_OF_0900" });
    expect(Object.fromEntries(quickDetailQuery({ ...day("", ""), title: "  " }))).toEqual({ start: kstToIso(D, "10:00"), end: kstToIso(D, "11:00") });
  });
});

describe("일정 폼 (span range)", () => {
  it("(#67) 시각 일정: 시작을 옮기면 분 단위 길이를 유지하고 날짜를 넘긴다", () => {
    const d = run(range({ startTime: "20:00", endTime: "22:30" }), "range", { type: "start", date: D, time: "23:00" });
    expect(d).toMatchObject({ startDate: D, startTime: "23:00", endDate: "2026-11-21", endTime: "01:30" });
  });

  it("(#67) 여러 날 시각 일정: 시작 날짜를 옮기면 끝도 같이 민다", () => {
    const d = run(range({ endDate: "2026-11-23", endTime: "11:00" }), "range", { type: "start", date: "2026-11-21", time: "10:00" });
    expect(d).toMatchObject({ startDate: "2026-11-21", endDate: "2026-11-24", endTime: "11:00" });
  });

  it("거꾸로 된 값에서 시작을 옮기면 1시간으로 본다", () => {
    const d = run(range({ startTime: "15:00", endTime: "14:00" }), "range", { type: "start", date: D, time: "09:00" });
    expect(d).toMatchObject({ endDate: D, endTime: "10:00" });
  });

  it("(#67) 종일: 시작을 옮기면 일 수를 유지한다", () => {
    const d = run(range({ allDay: true, endDate: "2026-11-23" }), "range", { type: "start", date: "2026-11-25", time: "10:00" });
    expect(d).toMatchObject({ startDate: "2026-11-25", endDate: "2026-11-28" });
  });

  it("(#67) 종료 시각만 시작보다 앞으로 옮기면 다음 날 그 시각 (밤샘 일정)", () => {
    const d = run(range({ startTime: "20:00", endTime: "21:00" }), "range", { type: "end", date: D, time: "19:00", by: "time" });
    expect(d).toMatchObject({ endDate: "2026-11-21", endTime: "19:00" });
  });

  it("(#67) 종료 날짜를 시작보다 앞으로 옮기면 시작 1시간 뒤", () => {
    const d = run(range({ startTime: "20:00", endDate: "2026-11-21", endTime: "19:00" }), "range", { type: "end", date: D, time: "19:00", by: "date" });
    expect(d).toMatchObject({ endDate: D, endTime: "21:00" });
  });

  it("(#67) 시작 1시간 뒤가 자정을 넘으면 다음 날로", () => {
    const d = run(range({ startTime: "23:30", endTime: "23:45" }), "range", { type: "end", date: "2026-11-19", time: "10:00", by: "date" });
    expect(d).toMatchObject({ endDate: "2026-11-21", endTime: "00:30" });
  });

  it("종료가 뒤면 그대로 둔다", () => {
    const d = run(range(), "range", { type: "end", date: "2026-11-22", time: "09:00", by: "date" });
    expect(d).toMatchObject({ endDate: "2026-11-22", endTime: "09:00" });
  });

  it("종일 종료 날짜는 시작일보다 앞서지 않는다", () => {
    expect(run(range({ allDay: true }), "range", { type: "end", date: "2026-11-18", time: "", by: "date" }).endDate).toBe(D);
    expect(run(range({ allDay: true }), "range", { type: "end", date: "2026-11-22", time: "", by: "date" }).endDate).toBe("2026-11-22");
  });

  it("종일을 켜면 종료일을 시작일에 맞추고, 끄면 같은 날 거꾸로 된 시각을 1시간 뒤로 (23시에서 멈춤)", () => {
    expect(run(range({ endDate: "2026-11-19" }), "range", { type: "allDay", value: true })).toMatchObject({ allDay: true, endDate: D });
    expect(run(range({ allDay: true, startTime: "14:30", endTime: "00:00" }), "range", { type: "allDay", value: false })).toMatchObject({ endTime: "15:30" });
    expect(run(range({ allDay: true, startTime: "23:30", endTime: "00:00" }), "range", { type: "allDay", value: false })).toMatchObject({ endTime: "23:30" });
    // 여러 날이면 시각을 건드리지 않는다
    expect(run(range({ allDay: true, endDate: "2026-11-22", endTime: "00:00" }), "range", { type: "allDay", value: false }).endTime).toBe("00:00");
  });

  it("종일 전환에서 알림이 맞지 않으면 없음", () => {
    expect(run(range({ reminder: "HOUR_1" }), "range", { type: "allDay", value: true }).reminder).toBe("NONE");
    expect(run(range({ reminder: "NONE" }), "range", { type: "allDay", value: true }).reminder).toBe("NONE");
  });

  it("범위 오류: 날짜 없음, 거꾸로(종일 문구 따로), 30일 상한", () => {
    expect(rangeError(range(), "range")).toBeNull();
    expect(rangeError(range({ endDate: "" }), "range")).toBe("날짜를 입력해 주세요");
    expect(rangeError(range({ endTime: "09:00" }), "range")).toBe("종료는 시작보다 뒤여야 해요");
    expect(rangeError(range({ allDay: true, endDate: "2026-11-19" }), "range")).toBe("종료일은 시작일과 같거나 뒤여야 해요");
    expect(rangeError(range({ endDate: "2026-12-20", endTime: "10:00" }), "range")).toBeNull();
    expect(rangeError(range({ endDate: "2026-12-20", endTime: "10:30" }), "range")).toBe("일정은 30일까지만 만들 수 있어요");
  });

  it("반복 종료: 처음 켜면 시작 30일 뒤, 이미 고른 날짜(시작 뒤)는 둔다", () => {
    const on = run(range({ repeat: "WEEKLY" }), "range", { type: "untilOn", value: true });
    expect(on).toMatchObject({ untilOn: true, untilDate: "2026-12-20" });
    expect(draftUntil(on)).toBe("2026-12-20");
    const kept = run(range({ repeat: "WEEKLY", untilDate: "2026-12-01" }), "range", { type: "untilOn", value: true });
    expect(kept.untilDate).toBe("2026-12-01");
    const before = run(range({ repeat: "WEEKLY", untilDate: "2026-11-01" }), "range", { type: "untilOn", value: true });
    expect(before.untilDate).toBe("2026-12-20");
    expect(draftUntil(run(on, "range", { type: "untilOn", value: false }))).toBeNull();
    expect(draftUntil({ ...on, repeat: null })).toBeNull();
  });

  it("제목 50자, 메모 500자로 자른다", () => {
    const d = run(range(), "range", { type: "title", value: "가".repeat(60) }, { type: "memo", value: "나".repeat(510) });
    expect(d.title).toHaveLength(50);
    expect(memoHint(d)).toBe("500/500");
  });

  it("(#248) 참여자: 새 일정에서 기본값 [나] 그대로 고르면 null 로 둔다", () => {
    expect(run(range(), "range", { type: "pick", value: [1], meId: 1 }).pick).toBeNull();
    expect(run(range(), "range", { type: "pick", value: [2, 1], meId: 1 }).pick).toEqual([1, 2]);
    expect(run(range({ pick: [1, 2] }), "range", { type: "pick", value: [1], meId: 1 }).pick).toEqual([1]);
    expect(run(range(), "range", { type: "pick", value: "ALL", meId: 1 }).pick).toBe("ALL");
  });

  it("색, 반복, 알림은 그대로 바꾼다", () => {
    const d = run(range(), "range", { type: "color", value: "#FF8A65" }, { type: "repeat", value: "MONTHLY" }, { type: "reminder", value: "DAY_1" }, { type: "untilDate", value: "2027-01-01" });
    expect(d).toMatchObject({ color: "#FF8A65", repeat: "MONTHLY", reminder: "DAY_1", untilDate: "2027-01-01" });
  });
});

describe("제목 오류", () => {
  it("touched 뒤 빈 제목(공백만 포함)만 오류", () => {
    expect(titleError(range({ title: " " }), false)).toBeNull();
    expect(titleError(range({ title: " " }), true)).toBe("제목을 입력해 주세요");
    expect(titleError(range({ title: "a" }), true)).toBeNull();
  });
});

describe("(#137) 처음 값과 비교", () => {
  it("같은 값이면 바뀌지 않음. 앞뒤 공백, 종일의 시각, 참여자 순서, 색 대소문자는 보지 않는다", () => {
    const a = range({ title: "a", pick: [1, 2], color: "#ff8a65" });
    expect(draftChanged(a, a)).toBe(false);
    expect(draftChanged({ ...a, title: " a ", pick: [2, 1], color: "#FF8A65" }, a)).toBe(false);
    expect(draftChanged({ ...a, allDay: true, startTime: "01:00" }, { ...a, allDay: true })).toBe(false);
    expect(draftChanged({ ...a, untilOn: true, untilDate: "2026-12-01" }, a)).toBe(false);
  });

  it("값이 바뀌면 바뀜", () => {
    const a = range();
    for (const b of [
      { ...a, title: "x" },
      { ...a, startTime: "11:00" },
      { ...a, endDate: "2026-11-21" },
      { ...a, memo: "m" },
      { ...a, repeat: "WEEKLY" as const },
      { ...a, repeat: "WEEKLY" as const, untilOn: true, untilDate: "2026-12-01" },
      { ...a, reminder: "MIN_10" as const },
      { ...a, pick: [1] },
      { ...a, color: "#FF8A65" },
      { ...a, allDay: true },
    ]) {
      expect(draftChanged(b, a)).toBe(true);
    }
  });
});

describe("일정 폼 본문", () => {
  it("draftTimes: 종일은 KST 자정 ~ 마지막 날 다음 자정, 빈 시각은 00:00", () => {
    expect(draftTimes(range({ allDay: true, endDate: "2026-11-22" }))).toEqual({ startsAt: kstToIso(D), endsAt: kstToIso("2026-11-23") });
    expect(draftTimes(range({ startTime: "", endTime: "" }))).toEqual({ startsAt: kstToIso(D), endsAt: kstToIso(D) });
    expect(draftTimes(range({ startDate: "" }))).toBeNull();
  });

  it("eventInput: 생성은 빈 메모, 알림 없음을 싣지 않는다", () => {
    const b = eventInput(range({ title: " 회의 " }), null)!;
    expect(JSON.parse(JSON.stringify(b))).toEqual({ title: "회의", startsAt: kstToIso(D, "10:00"), endsAt: kstToIso(D, "11:00"), allDay: false });
  });

  it("eventInput: 수정은 빈 메모를 '' 로 지우고, 알림을 아는 API 면 늘 싣는다", () => {
    expect(eventInput(range({ memo: "  " }), { reminder: "NONE" })).toMatchObject({ memo: "", reminder: "NONE" });
    expect(eventInput(range({ memo: " m " }), {})).toMatchObject({ memo: "m" });
    expect(eventInput(range(), {})).not.toHaveProperty("reminder");
  });

  const base = { editing: false, personal: false, showParticipants: true, currentPick: [1] as number[], initialPick: null, initialColor: null };

  it("새 일정: 참여자 늘, 고른 색, 반복은 켰을 때 종료 날짜와 함께", () => {
    const d = range({ title: "a", color: "#FF8A65", repeat: "WEEKLY", untilOn: true, untilDate: "2026-12-01" });
    const body = eventBody({ ...base, draft: d, input: eventInput(d, null)!, scope: null, series: null });
    expect(body).toMatchObject({ participants: [1], color: "#FF8A65", repeat: "WEEKLY", repeatUntil: "2026-12-01" });
    const plain = range({ title: "a" });
    const b2 = eventBody({ ...base, draft: plain, input: eventInput(plain, null)!, scope: null, series: null });
    expect(b2).not.toHaveProperty("repeat");
    expect(b2).not.toHaveProperty("color");
  });

  it("개인 팀, 참여자 줄 숨김이면 참여자를 싣지 않는다", () => {
    const d = range({ title: "a" });
    expect(eventBody({ ...base, personal: true, draft: d, input: eventInput(d, null)!, scope: null, series: null })).not.toHaveProperty("participants");
    expect(eventBody({ ...base, showParticipants: false, draft: d, input: eventInput(d, null)!, scope: null, series: null })).not.toHaveProperty("participants");
  });

  it("한 번짜리 수정: 바꾼 참여자, 색만", () => {
    const ev = loaded();
    const d = draftFromEvent(ev, false);
    const edit = { ...base, editing: true, initialPick: d.pick, initialColor: d.color, series: null, scope: null };
    const same = eventBody({ ...edit, draft: d, input: eventInput(d, ev)!, currentPick: d.pick });
    expect(same).not.toHaveProperty("participants");
    expect(same).not.toHaveProperty("color");
    const changed = { ...d, color: "#FF8A65" };
    const body = eventBody({ ...edit, draft: changed, input: eventInput(changed, ev)!, currentPick: [1] });
    expect(body).toMatchObject({ participants: [1], color: "#FF8A65" });
  });

  it("반복 일정 '이 일정만': 기본 본문만 (참여자, 색, 반복 없음)", () => {
    const ev = loaded({ repeat: "WEEKLY", occurrence: "2026-11-14" });
    const d = { ...draftFromEvent(ev, false), color: "#FF8A65", title: "x" };
    const input = eventInput(d, ev)!;
    expect(eventBody({ ...base, editing: true, draft: d, input, scope: "this", series: ev, currentPick: [1], initialPick: [1, 2], initialColor: null })).toEqual(input);
  });

  it("(QA3-M3, QA3-L1) 반복 일정 '이후 모두': 시각, 종료 날짜를 그대로 두면 보내지 않는다", () => {
    const ev = loaded({ repeat: "WEEKLY", repeatUntil: "2026-12-31", occurrence: "2026-11-14" });
    const d = draftFromEvent(ev, false);
    const input = eventInput(d, ev)!;
    expect(timesKeptOf(input, ev)).toBe(true);
    expect(sentUntilOf(d, ev)).toBeUndefined();
    const body = eventBody({ ...base, editing: true, draft: d, input, scope: "following", series: ev, currentPick: d.pick, initialPick: d.pick, initialColor: null });
    expect(body).not.toHaveProperty("startsAt");
    expect(body).not.toHaveProperty("repeatUntil");
    expect(body).toMatchObject({ repeat: "WEEKLY", title: ev.title });

    const moved = run(d, "range", { type: "start", date: "2026-11-14", time: "20:00" }, { type: "untilDate", value: "2027-01-31" });
    const input2 = eventInput(moved, ev)!;
    const body2 = eventBody({ ...base, editing: true, draft: moved, input: input2, scope: "following", series: ev, currentPick: [1], initialPick: d.pick, initialColor: null });
    expect(body2).toMatchObject({ startsAt: kstToIso("2026-11-14", "20:00"), repeatUntil: "2027-01-31", participants: [1] });
  });

  it("반복 규칙을 바꿨는지 (범위 시트 '이 일정만' 막기)", () => {
    const ev = loaded({ repeat: "WEEKLY", repeatUntil: null });
    const d = draftFromEvent(ev, false);
    expect(ruleChangedOf(d, ev)).toBe(false);
    expect(ruleChangedOf(d, null)).toBe(false);
    expect(ruleChangedOf({ ...d, repeat: "MONTHLY" }, ev)).toBe(true);
    expect(ruleChangedOf(run(d, "range", { type: "untilOn", value: true }), ev)).toBe(true);
  });

  it("반복 없는 새 일정이면 sentUntil 은 지금 값", () => {
    expect(sentUntilOf(range({ repeat: "WEEKLY", untilOn: true, untilDate: "2026-12-01" }), null)).toBe("2026-12-01");
    expect(timesKeptOf(null, loaded())).toBe(false);
  });
});
