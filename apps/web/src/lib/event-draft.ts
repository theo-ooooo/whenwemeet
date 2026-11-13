// (#359) 일정 초안: 빠른 추가(QuickAddForm)와 일정 폼(EventFormScreen)이 같이 쓰는 값, 연동 규칙, 검증, 보낼 본문.
// React 를 import 하지 않는다 (단위 테스트 대상). 화면 상태(펼침, 시트)는 여기 두지 않는다.
//   span "day"   빠른 추가. 날짜 하나 안에서 시각만 고른다. 종료는 자정(24:00) 에서 멈춘다
//   span "range" 일정 폼. 시작, 종료 날짜를 따로 고르고 자정을 넘는 일정, 여러 날 일정이 된다
import { minutesOf, timeOfMinutes } from "@/components/pickers/time";
import { charCount, clampChars } from "./chars";
import { addDays, dateKeyOf, kstToIso, timeOf, todayKey, type DateKey } from "./date";
import { eventColorBody } from "./colors";
import { normalizePick, participantsBody, pickOf, samePick, type ParticipantPick } from "./participants";
import { followingUntil, formRepeatOf, keepsLoadedTimes } from "./recurrence";
import { reminderAfterAllDayChange, reminderOf, reminderToSend } from "./reminder";
import type { EventDetailData, EventInput, EventPatchInput, EventReminder, EventScope, Repeat } from "./types";

// 서버 기준(코드포인트) 글자 수 (#63)
export const TITLE_MAX = 50;
export const MEMO_MAX = 500;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIDNIGHT = 24 * 60;

export type DraftSpan = "day" | "range";

export type EventDraft = {
  title: string;
  allDay: boolean;
  startDate: DateKey;
  startTime: string;
  /** 종일이면 마지막 날 (보낼 때 다음 날 자정으로) */
  endDate: DateKey;
  endTime: string;
  memo: string;
  /** 반복 (#187). untilOn 이 false 면 "계속" */
  repeat: Repeat | null;
  untilOn: boolean;
  untilDate: string;
  /** 알림 시각 (#188). 종일을 바꾸면 맞지 않는 값은 없음으로 */
  reminder: EventReminder;
  /** 참여자 (#248). null = 새 일정 기본값 "나" */
  pick: ParticipantPick | null;
  /** (#343) 일정 색. null = 자동(참여자 색) */
  color: string | null;
};

export type DraftAction =
  | { type: "title"; value: string }
  | { type: "allDay"; value: boolean }
  | { type: "start"; date: DateKey; time: string }
  | { type: "end"; date: DateKey; time: string; by: "date" | "time" }
  | { type: "memo"; value: string }
  | { type: "repeat"; value: Repeat | null }
  | { type: "untilOn"; value: boolean }
  | { type: "untilDate"; value: string }
  | { type: "reminder"; value: EventReminder }
  /** 참여자 시트 완료. 새 일정에서 기본값([나]) 그대로 고르면 null 로 둔다 (작성 중으로 보지 않게) */
  | { type: "pick"; value: ParticipantPick; meId: number | null }
  | { type: "color"; value: string | null };

const BLANK: EventDraft = {
  title: "",
  allDay: false,
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  memo: "",
  repeat: null,
  untilOn: false,
  untilDate: "",
  reminder: "NONE",
  pick: null,
  color: null,
};

/* ---------- 처음 값 ---------- */

/** 빠른 추가 (#46). 처음 시작 'HH:mm'(#192 주 보기 빈 칸) 이 있으면 1시간 뒤(자정에서 멈춘다)까지, 없으면 10:00~11:00 */
export function quickDraft(date: DateKey, initialStart?: string): EventDraft {
  const end = initialStart ? timeOfMinutes(Math.min((minutesOf(initialStart) ?? 600) + 60, MIDNIGHT)) : "11:00";
  return { ...BLANK, startDate: date, endDate: date, startTime: initialStart ?? "10:00", endTime: end };
}

/**
 * 새 일정 폼. 시작, 종료(ISO) 는 주소로 받은 값, 없으면 오늘 10:00~11:00.
 * 빠른 추가의 "자세히"(#46) 가 넘긴 제목, 종일, 알림(#188) 을 채운다. 알림이 종일 여부와 맞지 않으면 없음
 */
export function newDraft(o: { start?: string | null; end?: string | null; query?: URLSearchParams | null; today?: DateKey }): EventDraft {
  const today = o.today ?? todayKey();
  const start = o.start ?? kstToIso(today, "10:00");
  const end = o.end ?? kstToIso(today, "11:00");
  const q = o.query ?? null;
  const allDay = q?.get("allDay") === "1";
  return {
    ...BLANK,
    title: clampChars(q?.get("title") ?? "", TITLE_MAX),
    allDay,
    startDate: dateKeyOf(start),
    startTime: timeOf(start),
    endDate: dateKeyOf(end),
    endTime: timeOf(end),
    reminder: reminderAfterAllDayChange(reminderOf(q?.get("reminder") ?? null), allDay),
  };
}

/** 불러온 일정으로 채운다. 복제(copy) 는 반복 안 함, 종료 없음으로 시작한다 (QA3-L2). 알림, 참여자, 색은 그 회차 값 그대로 (#188, D-215) */
export function draftFromEvent(ev: EventDetailData, copy: boolean): EventDraft {
  const formRepeat = formRepeatOf(ev, copy);
  return {
    title: ev.title,
    allDay: ev.allDay,
    startDate: dateKeyOf(ev.startsAt),
    startTime: timeOf(ev.startsAt),
    endDate: ev.allDay ? addDays(dateKeyOf(ev.endsAt), -1) : dateKeyOf(ev.endsAt),
    endTime: ev.allDay ? "00:00" : timeOf(ev.endsAt),
    memo: ev.memo ?? "",
    repeat: formRepeat.repeat,
    untilOn: Boolean(formRepeat.until),
    untilDate: formRepeat.until ?? "",
    reminder: reminderOf(ev.reminder),
    pick: pickOf(ev),
    color: ev.color ?? null,
  };
}

/* ---------- 바꾸기 ---------- */

export function applyDraft(d: EventDraft, a: DraftAction, span: DraftSpan): EventDraft {
  switch (a.type) {
    case "title":
      return { ...d, title: clampChars(a.value, TITLE_MAX) };
    case "memo":
      return { ...d, memo: clampChars(a.value, MEMO_MAX) };
    case "allDay":
      return toggleAllDay(d, a.value, span);
    case "start":
      return span === "day" ? startInDay(d, a.time) : startInRange(d, a.date, a.time);
    case "end":
      return span === "day" ? endInDay(d, a.time) : endInRange(d, a.date, a.time, a.by);
    case "repeat":
      return { ...d, repeat: a.value };
    case "untilOn":
      // 반복을 바꾸려는 날짜까지로: 처음 켜면 시작 30일 뒤를 기본으로
      return { ...d, untilOn: a.value, untilDate: a.value && (!d.untilDate || d.untilDate < d.startDate) ? addDays(d.startDate, 30) : d.untilDate };
    case "untilDate":
      return { ...d, untilDate: a.value };
    case "reminder":
      return { ...d, reminder: a.value };
    case "pick":
      return { ...d, pick: d.pick === null && a.meId !== null && samePick(a.value, [a.meId]) ? null : normalizePick(a.value) };
    case "color":
      return { ...d, color: a.value };
  }
}

/** 종일 전환. 알림은 맞지 않으면 없음. 일정 폼은 종일을 켜면 종료일이 시작일보다 앞서지 않게, 끄면 같은 날 거꾸로 된 시각을 1시간 뒤로 */
function toggleAllDay(d: EventDraft, allDay: boolean, span: DraftSpan): EventDraft {
  const next = { ...d, allDay, reminder: reminderAfterAllDayChange(d.reminder, allDay) };
  if (span === "day") return next;
  if (allDay && next.endDate < next.startDate) next.endDate = next.startDate;
  if (!allDay && next.endDate === next.startDate && next.endTime <= next.startTime) {
    const [h] = next.startTime.split(":").map(Number);
    next.endTime = `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${next.startTime.split(":")[1]}`;
  }
  return next;
}

/** 빠른 추가: 시작을 바꾸면 길이(기본 1시간)를 유지하게 종료를 같이 민다. 하루 안이라 자정(24:00) 에서 멈춘다 */
function startInDay(d: EventDraft, time: string): EventDraft {
  const s0 = minutesOf(d.startTime);
  const e0 = minutesOf(d.endTime);
  const len = s0 !== null && e0 !== null && e0 > s0 ? e0 - s0 : 60;
  const s = minutesOf(time);
  if (s === null) return { ...d, startTime: time };
  return { ...d, startTime: time, endTime: timeOfMinutes(Math.min(s + len, MIDNIGHT)) };
}

/** 빠른 추가: 종료가 시작보다 앞서면 시작 1시간 뒤(자정까지) 로 맞춘다 (#67) */
function endInDay(d: EventDraft, time: string): EventDraft {
  const s = minutesOf(d.startTime);
  const e = minutesOf(time);
  if (s !== null && e !== null && e <= s) return { ...d, endTime: timeOfMinutes(Math.min(s + 60, MIDNIGHT)) };
  return { ...d, endTime: time };
}

const endFromIso = (d: EventDraft, iso: string): EventDraft => ({ ...d, endDate: dateKeyOf(iso), endTime: timeOf(iso) });

/** 일정 폼: 시작을 옮기면 길이를 유지하게 종료도 같이 민다 (#67). 종일은 일 수, 시각 일정은 분 단위 길이 */
function startInRange(d: EventDraft, date: DateKey, time: string): EventDraft {
  if (d.allDay) {
    const diff = d.startDate && d.endDate ? Math.max(0, Math.round((Date.parse(d.endDate) - Date.parse(d.startDate)) / DAY_MS)) : 0;
    return { ...d, startDate: date, startTime: time, endDate: date ? addDays(date, diff) : d.endDate };
  }
  const oldS = Date.parse(kstToIso(d.startDate, d.startTime || "00:00"));
  const oldE = Date.parse(kstToIso(d.endDate, d.endTime || "00:00"));
  const len = oldE > oldS ? oldE - oldS : HOUR_MS;
  return endFromIso({ ...d, startDate: date, startTime: time }, new Date(Date.parse(kstToIso(date, time)) + len).toISOString());
}

/** 일정 폼: 종료가 시작보다 앞서면 자동으로 맞춘다 (#67). 시각만 바꿨으면 다음 날 그 시각(밤샘 일정), 날짜를 바꿨으면 시작 1시간 뒤 */
function endInRange(d: EventDraft, date: DateKey, time: string, by: "date" | "time"): EventDraft {
  if (d.allDay) return { ...d, endDate: date < d.startDate ? d.startDate : date };
  const s = Date.parse(kstToIso(d.startDate, d.startTime || "00:00"));
  const e = Date.parse(kstToIso(date, time || "00:00"));
  if (e > s) return { ...d, endDate: date, endTime: time };
  if (by === "time" && date === d.startDate) return { ...d, endDate: addDays(date, 1), endTime: time };
  return endFromIso(d, new Date(s + HOUR_MS).toISOString());
}

/* ---------- 읽기, 검증 ---------- */

/** 보낼 시작, 끝 (종일이면 KST 자정 ~ 마지막 날 다음 자정). 날짜가 비면 null */
export function draftTimes(d: EventDraft): { startsAt: string; endsAt: string } | null {
  if (!d.startDate || !d.endDate) return null;
  return {
    startsAt: d.allDay ? kstToIso(d.startDate) : kstToIso(d.startDate, d.startTime || "00:00"),
    endsAt: d.allDay ? kstToIso(addDays(d.endDate, 1)) : kstToIso(d.endDate, d.endTime || "00:00"),
  };
}

/** 반복 종료 날짜. "계속" 이거나 반복 안 함이면 null */
export function draftUntil(d: EventDraft): string | null {
  return d.repeat && d.untilOn && d.untilDate ? d.untilDate : null;
}

/** 빈 제목 오류. 저장을 눌렀거나(touched) 고친 뒤 벗어났을 때만 띄운다 (#80) */
export function titleError(d: EventDraft, touched: boolean): string | null {
  return touched && d.title.trim().length === 0 ? "제목을 입력해 주세요" : null;
}

/** 시작, 종료 오류. 빠른 추가는 같은 날 시각 순서만, 일정 폼은 날짜, 순서, 30일 상한까지 */
export function rangeError(d: EventDraft, span: DraftSpan): string | null {
  if (span === "day") {
    return !d.allDay && (!d.startTime || !d.endTime || (minutesOf(d.endTime) ?? 0) <= (minutesOf(d.startTime) ?? 0)) ? "종료는 시작보다 뒤여야 해요" : null;
  }
  const t = draftTimes(d);
  if (!t) return "날짜를 입력해 주세요";
  const s = Date.parse(t.startsAt);
  const e = Date.parse(t.endsAt);
  if (e <= s) return d.allDay ? "종료일은 시작일과 같거나 뒤여야 해요" : "종료는 시작보다 뒤여야 해요";
  if (e - s > 30 * DAY_MS) return "일정은 30일까지만 만들 수 있어요";
  return null;
}

/** 메모 글자 수 표시 "12/500" */
export function memoHint(d: EventDraft): string {
  return `${charCount(d.memo)}/${MEMO_MAX}`;
}

/** 이탈 확인용 값 요약 (#137). 같은 값이면 같은 문자열. 앞뒤 공백, 종일의 시각, 참여자 순서, 색 대소문자는 보지 않는다 */
function snapshot(d: EventDraft): string {
  return JSON.stringify([
    d.title.trim(),
    d.allDay,
    d.startDate,
    d.allDay ? "" : d.startTime,
    d.endDate,
    d.allDay ? "" : d.endTime,
    d.memo.trim(),
    d.repeat,
    draftUntil(d),
    d.reminder,
    d.pick === null ? null : normalizePick(d.pick),
    d.color === null ? null : d.color.toUpperCase(),
  ]);
}

/** 처음 값과 달라졌는지 */
export function draftChanged(d: EventDraft, initial: EventDraft): boolean {
  return snapshot(d) !== snapshot(initial);
}

/* ---------- 보낼 본문 ---------- */

/** 빠른 추가 저장 본문. 알림은 "없음" 이면 생략 */
export function quickInput(d: EventDraft): EventInput {
  const t = draftTimes(d)!;
  const sent = reminderToSend(d.reminder, null);
  return { title: d.title.trim(), startsAt: t.startsAt, endsAt: t.endsAt, allDay: d.allDay, ...(sent ? { reminder: sent } : {}) };
}

/** 빠른 추가 "자세히" 가 새 일정 폼에 넘길 주소 값. 종일이어도 시각은 그대로 넘긴다 (폼에서 종일을 끄면 그 시각이 보인다) */
export function quickDetailQuery(d: EventDraft): URLSearchParams {
  const q = new URLSearchParams({ start: kstToIso(d.startDate, d.startTime || "10:00"), end: kstToIso(d.startDate, d.endTime || "11:00") });
  if (d.title.trim()) q.set("title", d.title.trim());
  if (d.allDay) q.set("allDay", "1");
  if (d.reminder !== "NONE") q.set("reminder", d.reminder);
  return q;
}

/**
 * 일정 폼의 기본 본문 (반복, 참여자, 색 제외). 날짜가 비면 null.
 * 수정에서 메모를 비우면 "" 를 보내 지운다 (생략하면 서버가 기존 메모를 유지한다).
 * 알림은 생성에서 "없음" 이면 생략, 수정은 API 가 아는 필드면 늘 싣는다 (lib/reminder reminderToSend)
 */
export function eventInput(d: EventDraft, editing: { reminder?: unknown } | null): EventInput | null {
  const t = draftTimes(d);
  if (!t) return null;
  const sentReminder = reminderToSend(d.reminder, editing);
  return {
    title: d.title.trim(),
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    allDay: d.allDay,
    memo: d.memo.trim() || (editing ? "" : undefined),
    ...(sentReminder === undefined ? {} : { reminder: sentReminder }),
  };
}

/** 반복 일정 수정에서 쓰는 원본 값 */
type Series = { startsAt: string; endsAt: string; repeat: Repeat | null; repeatUntil: string | null };

/** "이후 모두" 에서 종료 날짜를 원본 그대로 두었으면 보내지 않는다 (undefined). 서버가 이어받고 필요하면 늘린다 (QA3-L1) */
export function sentUntilOf(d: EventDraft, series: Series | null): string | null | undefined {
  const until = draftUntil(d);
  return series ? followingUntil(until, series.repeatUntil) : until;
}

/** "이후 모두" 에서 시작, 종료를 불러온 값 그대로 두었는지. 그러면 보내지 않고 서버가 그 회차의 규칙 자리에서 잇는다 (QA3-M3) */
export function timesKeptOf(input: EventInput | null, series: Series | null): boolean {
  return Boolean(series && input && keepsLoadedTimes(input, series));
}

/** 반복 규칙을 바꿨는지. 바꿨으면 범위 시트에서 "이 일정만" 을 막는다 */
export function ruleChangedOf(d: EventDraft, series: Series | null): boolean {
  return Boolean(series) && (d.repeat !== series?.repeat || draftUntil(d) !== series?.repeatUntil);
}

/**
 * 일정 폼이 보낼 본문 (api.md 2.3). 반복 필드는 새 일정/한 번짜리 수정에서 켰을 때, 반복 일정은 "이후 모두" 일 때만 싣는다.
 * - 참여자 (#248, D-142): 생성은 팀이면 늘, 수정은 바꿨을 때만. "이 일정만" 은 싣지 않는다 (서버 400)
 * - 색 (#343): 생성은 고른 색만, 수정은 바꿨을 때만. "이 일정만" 은 싣지 않는다 (서버 400)
 * - "이후 모두" 에서 시작, 종료, 반복 종료 날짜를 불러온 값 그대로 두었으면 보내지 않는다 (QA3-M3, QA3-L1)
 */
export function eventBody(o: {
  draft: EventDraft;
  input: EventInput;
  scope: EventScope | null;
  /** 수정 중인 반복 일정. 한 번짜리 수정, 새 일정, 복제는 null */
  series: Series | null;
  editing: boolean;
  personal: boolean;
  showParticipants: boolean;
  /** 참여자 지금 값 (새 일정 기본 [나], 복제는 지금 멤버로 거른 값) */
  currentPick: ParticipantPick | null;
  /** 수정이면 불러온 값. 새 일정, 복제는 null */
  initialPick: ParticipantPick | null;
  initialColor: string | null;
}): EventPatchInput {
  const { draft: d, input, scope, series, editing } = o;
  const sentParticipants = o.showParticipants
    ? participantsBody({ editing, personal: o.personal, scope: series ? scope : null, current: o.currentPick, initial: o.initialPick })
    : undefined;
  const sentColor = eventColorBody({ editing, thisOnly: Boolean(series) && scope === "this", current: d.color, initial: o.initialColor });
  const full = {
    ...input,
    ...(sentParticipants === undefined ? {} : { participants: sentParticipants }),
    ...(sentColor === undefined ? {} : { color: sentColor }),
  };
  if (series && scope === "following") {
    const { startsAt, endsAt, ...rest } = full;
    const sentUntil = sentUntilOf(d, series);
    return {
      ...rest,
      ...(timesKeptOf(input, series) ? {} : { startsAt, endsAt }),
      repeat: d.repeat,
      ...(sentUntil === undefined ? {} : { repeatUntil: sentUntil }),
    };
  }
  if (series) return input;
  return d.repeat ? { ...full, repeat: d.repeat, repeatUntil: draftUntil(d) } : full;
}
