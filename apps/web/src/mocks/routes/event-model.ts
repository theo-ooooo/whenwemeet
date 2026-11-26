// 일정 응답 모양과 본문 검사 (알림, 참여자, 색, 반복, 장소, 참석 여부와 반응). 일정, 투표, 빈 시간이 같이 쓴다 (#491)
import { dateKeyOf } from "@/lib/date";
import { errorBody } from "@/lib/envelope";
import { REPEAT_PERIOD_DAYS, REPEATS } from "@/lib/recurrence";
import { reminderError } from "@/lib/reminder";
import { MEMBER_COLORS, type EventReminder, type Reaction, type Repeat, type Rsvp } from "@/lib/types";
import { memberOf, mockEventCode, type EventRow, type Store } from "../fixtures";
import { applyException, isOccurrenceDate, originalOccurrence, type MockOccurrence, type MockPlace } from "../recurrence";
import { placeOut, placeProblem, placeValue } from "../places";
import { DAY_MS, err, memberIdsOf, nextId, nowIso, ok, type MockResult } from "./shared";

/* ---------- (#188) 알림 (푸시-알림.md 4-1, 7-1) ---------- */

const REMINDERS: readonly EventReminder[] = ["NONE", "AT_START", "MIN_10", "HOUR_1", "DAY_1", "DAY_OF_0900", "DAY_BEFORE_0900"];

/** 본문의 reminder 를 읽는다. 없으면 undefined, 모르는 값이면 오류 */
export function reminderIn(v: unknown): EventReminder | undefined | MockResult {
  if (v === undefined) return undefined;
  if (!REMINDERS.includes(v as EventReminder))
    return { status: 400, body: errorBody(400, "VALIDATION_FAILED", "알림 값을 확인해 주세요", [{ field: "reminder", message: "알림 값을 확인해 주세요" }]) };
  return v as EventReminder;
}

/** 종일 여부와 맞지 않는 알림 (서버 4-1 과 같은 문장, details[0].field = 'reminder') */
export function reminderFit(r: EventReminder, allDay: boolean): MockResult | null {
  const message = reminderError(r, allDay);
  return message ? { status: 400, body: errorBody(400, "VALIDATION_FAILED", message, [{ field: "reminder", message }]) } : null;
}

/** 수정 결과의 알림: 본문에 있으면 그 값, 없으면 지금 값. 종일이 바뀌어 맞지 않게 되면 NONE (4-1) */
export function mergedReminder(input: EventReminder | undefined, current: EventReminder, allDay: boolean): EventReminder | MockResult {
  if (input !== undefined) return reminderFit(input, allDay) ?? input;
  return reminderError(current, allDay) ? "NONE" : current;
}

/* ---------- (#248) 참여자 (설계 3-2, 4장, 6장) ---------- */

/** 응답 participants: all 이면 지금 멤버 전원, 아니면 참여자 (가입순, 지금 멤버만) */
function participantsOut(s: Store, e: EventRow) {
  const ids = memberIdsOf(s, e.groupId);
  const all = e.allMembers !== false;
  const picked = new Set(e.participantIds ?? []);
  return { all, members: ids.filter((id) => all || picked.has(id)).map((id) => memberOf(s, e.groupId, id)) };
}

export const participantErr = (message: string): MockResult => ({
  status: 400,
  body: errorBody(400, "VALIDATION_FAILED", message, [{ field: "participants", message }]),
});

/** 본문 participants 읽기 (3-2 표). 생략 = undefined */
export function participantsIn(s: Store, groupId: number, v: unknown): { all: boolean; ids: number[] } | undefined | MockResult {
  if (v === undefined) return undefined;
  if (v === "ALL") return { all: true, ids: [] };
  if (!Array.isArray(v) || v.some((x) => typeof x !== "number" || !Number.isInteger(x) || x <= 0) || v.length > 50) {
    return participantErr("participants 는 'ALL' 또는 멤버 id 배열이어야 해요");
  }
  if (v.length === 0) return participantErr("참여자를 한 명 이상 골라 주세요");
  const ids = [...new Set(v as number[])].sort((a, b) => a - b);
  const members = new Set(memberIdsOf(s, groupId));
  if (!ids.every((id) => members.has(id))) return participantErr("이 팀 멤버만 참여자로 고를 수 있어요");
  return { all: false, ids };
}

export function applyParticipants(e: EventRow, p: { all: boolean; ids: number[] }) {
  e.allMembers = p.all;
  e.participantIds = p.all ? [] : [...p.ids];
}

/* ---------- (#343) 일정 색 (D-215) ---------- */

export const colorErr = (message: string): MockResult => ({
  status: 400,
  body: errorBody(400, "VALIDATION_FAILED", message, [{ field: "color", message }]),
});

/** 본문 color 읽기. 생략 = undefined, null = 자동, 팔레트 키는 대문자로. 그 밖은 400 (API EventColorConstraint) */
export function colorIn(v: unknown): string | null | undefined | MockResult {
  if (v === undefined || v === null) return v;
  const key = typeof v === "string" ? MEMBER_COLORS.find((c) => c === v.toUpperCase()) : undefined;
  return key ?? colorErr("색은 정해진 8색 중 하나여야 해요");
}

/** (#566) 본문 lunarInput 읽기. 생략 = undefined, 불리언이 아니면 400 (API EventInputDto) */
export function lunarIn(v: unknown): boolean | undefined | MockResult {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  const message = "lunarInput 은 true/false 여야 해요";
  return { status: 400, body: errorBody(400, "VALIDATION_FAILED", message, [{ field: "lunarInput", message }]) };
}

/** 빈 시간 (4장 isBusyForAny): 모두면 바쁨, 아니면 참여자 중 요청 팀 멤버가 있으면. 참여자 없음은 안 바쁨 */
export function isBusyForAny(e: EventRow, memberIds: ReadonlySet<number>): boolean {
  if (e.allMembers !== false) return true;
  return (e.participantIds ?? []).some((id) => memberIds.has(id));
}

/** 한 번짜리면 그대로, 반복이면 첫 회차 (o 를 주면 그 회차) */
export function eventOut(s: Store, e: EventRow, o?: MockOccurrence) {
  const occ = e.repeat ? (o ?? originalOccurrence(e as RepeatRow, dateKeyOf(e.startsAt))) : null;
  const memo = occ?.memo ?? e.memo;
  return {
    id: e.id,
    groupId: e.groupId,
    publicCode: mockEventCode(e.id),
    title: occ?.title ?? e.title,
    startsAt: occ?.startsAt ?? e.startsAt,
    endsAt: occ?.endsAt ?? e.endsAt,
    allDay: occ?.allDay ?? e.allDay,
    memo: memo || undefined,
    creator: memberOf(s, e.groupId, e.creatorId),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    repeat: e.repeat,
    repeatUntil: e.repeatUntil,
    occurrence: occ?.occurrence ?? null,
    seriesStartsAt: e.repeat ? e.startsAt : null,
    repeatAnchor: e.repeat ? (e.repeatAnchor ?? null) : null,
    reminder: occ?.reminder ?? e.reminder ?? "NONE",
    participants: participantsOut(s, e),
    color: e.color ?? null,
    lunarInput: e.lunarInput ?? false,
    // (#199) 회차 예외 장소(이름 '' 은 그 회차만 없음)
    place: placeOut(occ?.place ?? e.place),
  };
}

/* ---------- (#190) 참석 여부와 반응 ---------- */

export type EventOut = ReturnType<typeof eventOut>;
const RSVPS: readonly Rsvp[] = ["GOING", "NOT_GOING", "MAYBE"];
const REACTIONS: readonly Reaction[] = ["LIKE", "EXCITED", "ACK"];

/** 응답이 붙는 회차 날짜. 한 번짜리는 시작 KST 날짜 */
const responseKey = (out: Pick<EventOut, "occurrence" | "startsAt">) => out.occurrence ?? dateKeyOf(out.startsAt);

/** 참여자 집계 (API summarizeRsvp 와 같은 규칙: 지금 참여자만 센다) */
function rsvpSummary(s: Store, out: EventOut, userId: number) {
  const ids = new Set(out.participants.members.map((m) => m.userId));
  const rows = (s.rsvps ?? []).filter((r) => r.eventId === out.id && r.occurrence === responseKey(out) && ids.has(r.userId));
  const count = (v: Rsvp) => rows.filter((r) => r.status === v).length;
  return {
    going: count("GOING"),
    notGoing: count("NOT_GOING"),
    maybe: count("MAYBE"),
    pending: ids.size - rows.length,
    mine: rows.find((r) => r.userId === userId)?.status ?? null,
  };
}

function reactionSummary(s: Store, out: EventOut, userId: number) {
  const ids = new Set(memberIdsOf(s, out.groupId));
  const rows = (s.reactions ?? []).filter((r) => r.eventId === out.id && r.occurrence === responseKey(out) && ids.has(r.userId));
  const count = (k: Reaction) => rows.filter((r) => r.kind === k).length;
  return { LIKE: count("LIKE"), EXCITED: count("EXCITED"), ACK: count("ACK"), mine: rows.find((r) => r.userId === userId)?.kind ?? null };
}

/** 목록, 단건 공통 집계를 붙인다 */
export function withResponses(s: Store, out: EventOut, userId: number) {
  return { ...out, rsvp: rsvpSummary(s, out, userId), reactions: reactionSummary(s, out, userId) };
}

/** 단건만: 참여자별 응답(가입순, stale), 반응한 사람 */
export function withResponseMembers(s: Store, out: EventOut, userId: number) {
  const key = responseKey(out);
  const rsvps = (s.rsvps ?? []).filter((r) => r.eventId === out.id && r.occurrence === key);
  const reactions = (s.reactions ?? []).filter((r) => r.eventId === out.id && r.occurrence === key);
  return {
    ...withResponses(s, out, userId),
    rsvpMembers: out.participants.members.map((member) => {
      const row = rsvps.find((r) => r.userId === member.userId);
      return row
        ? { member, status: row.status, respondedAt: row.updatedAt, stale: row.seenStartsAt !== out.startsAt || row.seenEndsAt !== out.endsAt }
        : { member, status: null, respondedAt: null, stale: false };
    }),
    reactionMembers: memberIdsOf(s, out.groupId).flatMap((id) => {
      const row = reactions.find((r) => r.userId === id);
      return row ? [{ member: memberOf(s, out.groupId, id), reaction: row.kind }] : [];
    }),
  };
}

/** PUT rsvp, reaction (api.md 2.3 참석 여부). out 은 그 회차 */
export function responseRoute(s: Store, out: EventOut, userId: number, kind: string, body: Record<string, unknown> | null): MockResult {
  const key = responseKey(out);
  if (kind === "rsvp") {
    const status = (body ?? {}).status;
    if (status !== null && !RSVPS.includes(status as Rsvp)) {
      const message = "status 는 GOING, NOT_GOING, MAYBE 또는 null 이어야 해요";
      return { status: 400, body: errorBody(400, "VALIDATION_FAILED", message, [{ field: "status", message }]) };
    }
    if (!out.participants.members.some((m) => m.userId === userId)) return err(403, "NOT_PARTICIPANT", "이 일정의 참여자만 응답할 수 있어요");
    const rows = (s.rsvps ??= []);
    const at = rows.findIndex((r) => r.eventId === out.id && r.occurrence === key && r.userId === userId);
    const current = at >= 0 ? rows[at].status : null;
    if (current !== status) {
      if (at >= 0) rows.splice(at, 1);
      if (status !== null)
        rows.push({
          eventId: out.id,
          occurrence: key,
          userId,
          status: status as Rsvp,
          seenStartsAt: out.startsAt,
          seenEndsAt: out.endsAt,
          updatedAt: nowIso(),
        });
      // 새 소식: 2분 안 같은 회차는 그 줄을 고치고, 취소는 그 줄만 지운다 (D-227)
      const acts = (s.activities ??= []);
      const since = new Date(Date.now() - 2 * 60_000).toISOString();
      const same = acts.find(
        (a) =>
          a.type === "EVENT_RSVP" &&
          a.actorId === userId &&
          a.createdAt >= since &&
          a.payload.eventId === out.id &&
          (a.payload.occurrence ?? null) === out.occurrence,
      );
      if (status === null) {
        if (same) s.activities = acts.filter((a) => a !== same);
      } else {
        const payload = {
          eventId: out.id,
          eventCode: out.publicCode,
          occurrence: out.occurrence,
          title: out.title,
          startsAt: out.startsAt,
          endsAt: out.endsAt,
          allDay: out.allDay,
          status: status as Rsvp,
        };
        if (same) Object.assign(same, { payload, createdAt: nowIso() });
        else
          acts.push({
            id: nextId(),
            groupId: out.groupId,
            type: "EVENT_RSVP",
            actorId: userId,
            actorName: memberOf(s, out.groupId, userId).displayName,
            anniversaryId: null,
            payload,
            createdAt: nowIso(),
          });
      }
    }
    return ok(rsvpSummary(s, out, userId));
  }
  const reaction = (body ?? {}).reaction;
  if (reaction !== null && !REACTIONS.includes(reaction as Reaction)) {
    const message = "reaction 은 LIKE, EXCITED, ACK 또는 null 이어야 해요";
    return { status: 400, body: errorBody(400, "VALIDATION_FAILED", message, [{ field: "reaction", message }]) };
  }
  const rows = (s.reactions ??= []);
  const at = rows.findIndex((r) => r.eventId === out.id && r.occurrence === key && r.userId === userId);
  if (at >= 0) rows.splice(at, 1);
  if (reaction !== null) rows.push({ eventId: out.id, occurrence: key, userId, kind: reaction as Reaction });
  return ok(reactionSummary(s, out, userId));
}

export type RepeatRow = EventRow & { repeat: Repeat };

/** 반복 원본의 회차 하나 (취소, 규칙 밖이면 null) */
export function occurrenceOf(e: RepeatRow, date: string): MockOccurrence | null {
  if (!isOccurrenceDate(e, date)) return null;
  return applyException(
    originalOccurrence(e, date),
    e.exceptions.find((x) => x.occurrence === date),
  );
}

/** 반복 규칙 검사 (설계 4-1). repeat 가 null 이면 통과 */
export function repeatCheck(repeat: Repeat | null, until: string | null, startsAt: string, endsAt: string): MockResult | null {
  if (until && !repeat) return err(400, "VALIDATION_FAILED", "반복 주기 없이 종료 날짜만 정할 수 없어요");
  if (!repeat) return null;
  if (Date.parse(endsAt) - Date.parse(startsAt) >= REPEAT_PERIOD_DAYS[repeat] * DAY_MS) {
    return err(400, "EVENT_RANGE_INVALID", "반복 간격보다 긴 일정은 반복할 수 없어요");
  }
  if (until && until < dateKeyOf(startsAt)) return err(400, "EVENT_RANGE_INVALID", "종료 날짜는 시작 날짜 뒤여야 해요");
  return null;
}

/** (#199) 본문 place → 저장 값 (undefined = 생략). 틀리면 400 */
export function placeIn(v: unknown): MockPlace | null | undefined | MockResult {
  const problem = placeProblem(v);
  if (problem) return err(400, "VALIDATION_FAILED", problem);
  return placeValue(v);
}

export function repeatOf(v: unknown): Repeat | null | "bad" {
  if (v === undefined || v === null) return null;
  return REPEATS.includes(v as Repeat) ? (v as Repeat) : "bad";
}

export function validateEvent(input: Partial<EventRow>, partial: boolean): MockResult | null {
  if (!partial || input.title !== undefined) {
    const t = typeof input.title === "string" ? input.title.trim() : "";
    if (t.length < 1 || t.length > 50) {
      return err(400, "VALIDATION_FAILED", "제목은 1~50자로 입력해 주세요");
    }
  }
  if (input.memo !== undefined && input.memo !== null && String(input.memo).length > 500) {
    return err(400, "VALIDATION_FAILED", "메모는 500자까지 쓸 수 있어요");
  }
  return null;
}

export function rangeCheck(startsAt: string, endsAt: string): MockResult | null {
  const s = Date.parse(startsAt);
  const e = Date.parse(endsAt);
  if (Number.isNaN(s) || Number.isNaN(e)) {
    return err(400, "VALIDATION_FAILED", "시작과 종료 시각을 확인해 주세요");
  }
  if (e <= s) return err(400, "EVENT_RANGE_INVALID", "종료 시각은 시작보다 뒤여야 해요");
  if (e - s > 30 * DAY_MS) return err(400, "EVENT_RANGE_INVALID", "일정은 30일을 넘길 수 없어요");
  return null;
}

/** 한 번짜리 PATCH 본문 반영 */
export function applyInput(e: EventRow, input: Partial<EventRow>) {
  if (input.title !== undefined) e.title = String(input.title).trim();
  if (input.startsAt !== undefined) e.startsAt = new Date(String(input.startsAt)).toISOString();
  if (input.endsAt !== undefined) e.endsAt = new Date(String(input.endsAt)).toISOString();
  if (input.allDay !== undefined) e.allDay = Boolean(input.allDay);
  if (input.memo !== undefined) e.memo = input.memo ? String(input.memo) : null;
}
