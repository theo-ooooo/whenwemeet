// API_MOCK=1 메모리 API. api.md 의 봉투와 상태 코드를 그대로 따른다. 응답은 전부 ok / err 를 거친다 (봉투 모양은 lib/envelope.ts).
import { addDays, dateKeyOf, kstToIso } from "@/lib/date";
import { errorBody, okBody } from "@/lib/envelope";
import { ceilToStep } from "@/lib/free-time";
import { parseId } from "@/lib/id";
import { REPEAT_PERIOD_DAYS, REPEATS } from "@/lib/recurrence";
import { PUSH_TOKEN_RE } from "@/lib/app-bridge";
import { reminderError } from "@/lib/reminder";
import { MEMBER_COLORS, type EventReminder, type NotificationSettings, type Reaction, type Repeat, type Rsvp } from "@/lib/types";
import {
  buildStore,
  inviteMarkerOf,
  inviteUrlOf,
  ME_ID,
  memberOf,
  type EventLogRow,
  type EventRow,
  type CalendarFeedRow,
  type Store, mockEventCode, mockGroupCode, mockTodoCode, type TodoItemRow, type TodoListRow } from "./fixtures";
import { mockEmailLogin } from "./email-login";
import { applyException, expand, isOccurrenceDate, originalOccurrence, type MockOccurrence } from "./recurrence";

export type MockResult = { status: number; body: unknown };

type Ctx = {
  method: string;
  path: string; // '/groups/2/events'
  query: URLSearchParams;
  body: Record<string, unknown> | null;
  userId: number | null;
};

// dev HMR 로 모듈이 다시 평가돼도 상태가 남도록 globalThis 에 둔다
const g = globalThis as unknown as { __wwmMockStore?: Store };
function store(): Store {
  if (!g.__wwmMockStore) g.__wwmMockStore = buildStore();
  return g.__wwmMockStore;
}

const ok = (data: unknown, status = 200): MockResult => ({ status, body: okBody(data, status) });
/** (#300) 처음 여는 달력 기본값 */
const START_LAST = { mode: "LAST", groupId: null } as const;

const err = (status: number, code: string, message: string): MockResult => ({
  status,
  body: errorBody(status, code, message),
});

const nextId = () => (store().seq += 1);
const nowIso = () => new Date().toISOString();

const DAY_MS = 86_400_000;

function groupDetail(s: Store, groupId: number, userId: number) {
  const grp = s.groups.find((x) => x.id === groupId)!;
  const members = s.memberships
    .filter((m) => m.groupId === groupId)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    .map((m) => memberOf(s, groupId, m.userId));
  return {
    id: grp.id,
    type: grp.type,
    name: grp.name,
    inviteCode: grp.inviteCode,
    inviteUrl: grp.inviteCode ? inviteUrlOf(grp.inviteCode) : null,
    inviteShareUrl: grp.inviteCode ? `${inviteUrlOf(grp.inviteCode)}?by=${inviteMarkerOf(groupId, userId)}` : null,
    publicCode: mockGroupCode(grp.id),
    createdAt: grp.createdAt,
    members,
    me: myMember(s, groupId, userId),
  };
}

/* ---------- (#193) 외부 캘린더 구독 주소 ---------- */

const MOCK_FEED_ORIGIN = "https://api.whenwemeet.day";

function mockFeedToken(): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return Array.from({ length: 43 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
}

function calendarFeedView(row: CalendarFeedRow) {
  const httpsUrl = `${MOCK_FEED_ORIGIN}/v1/ics/${row.token}.ics`;
  const webcalUrl = httpsUrl.replace(/^https?:/, "webcal:");
  return {
    httpsUrl,
    webcalUrl,
    googleAddUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`,
    includeMemo: row.includeMemo,
    includeAnniversaries: row.includeAnniversaries,
    createdAt: row.createdAt,
    lastFetchedAt: row.lastFetchedAt,
  };
}

function calendarFeedRoute(
  s: Store,
  method: string,
  rest: string[],
  body: Record<string, unknown> | null,
  groupId: number,
  userId: number,
): MockResult {
  const feeds = (s.calendarFeeds ??= []);
  const mine = feeds.find((f) => f.userId === userId && f.groupId === groupId);
  if (rest.length === 0 && method === "GET") return ok(mine ? calendarFeedView(mine) : null);
  if (rest.length === 0 && method === "PUT") {
    for (const key of Object.keys(body ?? {})) {
      if (key !== "includeMemo" && key !== "includeAnniversaries") return err(400, "VALIDATION_FAILED", `property ${key} should not exist`);
      if (typeof body?.[key] !== "boolean") return err(400, "VALIDATION_FAILED", `${key} 는 true/false 여야 해요`);
    }
    const settings = body as { includeMemo?: boolean; includeAnniversaries?: boolean } | null;
    if (mine) {
      if (settings?.includeMemo !== undefined) mine.includeMemo = settings.includeMemo;
      if (settings?.includeAnniversaries !== undefined) mine.includeAnniversaries = settings.includeAnniversaries;
      return ok(calendarFeedView(mine));
    }
    const row: CalendarFeedRow = {
      userId,
      groupId,
      token: mockFeedToken(),
      includeMemo: settings?.includeMemo ?? false,
      includeAnniversaries: settings?.includeAnniversaries ?? true,
      createdAt: nowIso(),
      lastFetchedAt: null,
    };
    feeds.push(row);
    return ok(calendarFeedView(row));
  }
  if (rest.length === 0 && method === "DELETE") {
    s.calendarFeeds = feeds.filter((f) => f !== mine);
    return ok({ ok: true });
  }
  if (rest[0] === "rotate" && rest.length === 1 && method === "POST") {
    if (!mine) return err(404, "NOT_FOUND", "연결 주소가 없어요");
    mine.token = mockFeedToken();
    return ok(calendarFeedView(mine));
  }
  return err(404, "NOT_FOUND", "찾을 수 없어요");
}

/** 나 자신의 멤버 정보. (#188) notify 는 내 행에만 싣는다 (7-2) */
function myMember(s: Store, groupId: number, userId: number) {
  const ms = s.memberships.find((m) => m.groupId === groupId && m.userId === userId);
  return { ...memberOf(s, groupId, userId), notify: ms?.notify ?? true };
}

/* ---------- (#188) 알림 (푸시-알림.md 4-1, 7-1) ---------- */

const REMINDERS: readonly EventReminder[] = ["NONE", "AT_START", "MIN_10", "HOUR_1", "DAY_1", "DAY_OF_0900", "DAY_BEFORE_0900"];
const DEFAULT_NOTIFY: NotificationSettings = { reminder: true, change: true, anniversary: true, join: true, weekly: true, weeklyNudge: false };
const NOTIFY_KEYS = Object.keys(DEFAULT_NOTIFY) as (keyof NotificationSettings)[];

/** 본문의 reminder 를 읽는다. 없으면 undefined, 모르는 값이면 오류 */
function reminderIn(v: unknown): EventReminder | undefined | MockResult {
  if (v === undefined) return undefined;
  if (!REMINDERS.includes(v as EventReminder)) return { status: 400, body: errorBody(400, "VALIDATION_FAILED", "알림 값을 확인해 주세요", [{ field: "reminder", message: "알림 값을 확인해 주세요" }]) };
  return v as EventReminder;
}

/** 종일 여부와 맞지 않는 알림 (서버 4-1 과 같은 문장, details[0].field = 'reminder') */
function reminderFit(r: EventReminder, allDay: boolean): MockResult | null {
  const message = reminderError(r, allDay);
  return message ? { status: 400, body: errorBody(400, "VALIDATION_FAILED", message, [{ field: "reminder", message }]) } : null;
}

const isResult = (v: unknown): v is MockResult => typeof v === "object" && v !== null && "status" in v && "body" in v;

/** 수정 결과의 알림: 본문에 있으면 그 값, 없으면 지금 값. 종일이 바뀌어 맞지 않게 되면 NONE (4-1) */
function mergedReminder(input: EventReminder | undefined, current: EventReminder, allDay: boolean): EventReminder | MockResult {
  if (input !== undefined) return reminderFit(input, allDay) ?? input;
  return reminderError(current, allDay) ? "NONE" : current;
}

/* ---------- (#248) 참여자 (설계 3-2, 4장, 6장) ---------- */

/** 그 팀 지금 멤버 userId (가입순) */
function memberIdsOf(s: Store, groupId: number): number[] {
  return s.memberships
    .filter((m) => m.groupId === groupId)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    .map((m) => m.userId);
}

/** 응답 participants: all 이면 지금 멤버 전원, 아니면 참여자 (가입순, 지금 멤버만) */
function participantsOut(s: Store, e: EventRow) {
  const ids = memberIdsOf(s, e.groupId);
  const all = e.allMembers !== false;
  const picked = new Set(e.participantIds ?? []);
  return { all, members: ids.filter((id) => all || picked.has(id)).map((id) => memberOf(s, e.groupId, id)) };
}

const participantErr = (message: string): MockResult => ({
  status: 400,
  body: errorBody(400, "VALIDATION_FAILED", message, [{ field: "participants", message }]),
});

/** 본문 participants 읽기 (3-2 표). 생략 = undefined */
function participantsIn(s: Store, groupId: number, v: unknown): { all: boolean; ids: number[] } | undefined | MockResult {
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

function applyParticipants(e: EventRow, p: { all: boolean; ids: number[] }) {
  e.allMembers = p.all;
  e.participantIds = p.all ? [] : [...p.ids];
}

/* ---------- (#343) 일정 색 (D-215) ---------- */

const colorErr = (message: string): MockResult => ({
  status: 400,
  body: errorBody(400, "VALIDATION_FAILED", message, [{ field: "color", message }]),
});

/** 본문 color 읽기. 생략 = undefined, null = 자동, 팔레트 키는 대문자로. 그 밖은 400 (API EventColorConstraint) */
function colorIn(v: unknown): string | null | undefined | MockResult {
  if (v === undefined || v === null) return v;
  const key = typeof v === "string" ? MEMBER_COLORS.find((c) => c === v.toUpperCase()) : undefined;
  return key ?? colorErr("색은 정해진 8색 중 하나여야 해요");
}

/** 빈 시간 (4장 isBusyForAny): 모두면 바쁨, 아니면 참여자 중 요청 팀 멤버가 있으면. 참여자 없음은 안 바쁨 */
function isBusyForAny(e: EventRow, memberIds: ReadonlySet<number>): boolean {
  if (e.allMembers !== false) return true;
  return (e.participantIds ?? []).some((id) => memberIds.has(id));
}

/** 한 번짜리면 그대로, 반복이면 첫 회차 (o 를 주면 그 회차) */
function eventOut(s: Store, e: EventRow, o?: MockOccurrence) {
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
  };
}

/* ---------- (#190) 참석 여부와 반응 ---------- */

type EventOut = ReturnType<typeof eventOut>;
const RSVPS: readonly Rsvp[] = ["GOING", "NOT_GOING", "MAYBE"];
const REACTIONS: readonly Reaction[] = ["LIKE", "EXCITED", "ACK"];

/** 응답이 붙는 회차 날짜. 한 번짜리는 시작 KST 날짜 */
const responseKey = (out: Pick<EventOut, "occurrence" | "startsAt">) => out.occurrence ?? dateKeyOf(out.startsAt);

/** 참여자 집계 (API summarizeRsvp 와 같은 규칙: 지금 참여자만 센다) */
function rsvpSummary(s: Store, out: EventOut, userId: number) {
  const ids = new Set(out.participants.members.map((m) => m.userId));
  const rows = (s.rsvps ?? []).filter((r) => r.eventId === out.id && r.occurrence === responseKey(out) && ids.has(r.userId));
  const count = (v: Rsvp) => rows.filter((r) => r.status === v).length;
  return { going: count("GOING"), notGoing: count("NOT_GOING"), maybe: count("MAYBE"), pending: ids.size - rows.length, mine: rows.find((r) => r.userId === userId)?.status ?? null };
}

function reactionSummary(s: Store, out: EventOut, userId: number) {
  const ids = new Set(memberIdsOf(s, out.groupId));
  const rows = (s.reactions ?? []).filter((r) => r.eventId === out.id && r.occurrence === responseKey(out) && ids.has(r.userId));
  const count = (k: Reaction) => rows.filter((r) => r.kind === k).length;
  return { LIKE: count("LIKE"), EXCITED: count("EXCITED"), ACK: count("ACK"), mine: rows.find((r) => r.userId === userId)?.kind ?? null };
}

/** 목록, 단건 공통 집계를 붙인다 */
function withResponses(s: Store, out: EventOut, userId: number) {
  return { ...out, rsvp: rsvpSummary(s, out, userId), reactions: reactionSummary(s, out, userId) };
}

/** 단건만: 참여자별 응답(가입순, stale), 반응한 사람 */
function withResponseMembers(s: Store, out: EventOut, userId: number) {
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
function responseRoute(s: Store, out: EventOut, userId: number, kind: string, body: Record<string, unknown> | null): MockResult {
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
      if (status !== null) rows.push({ eventId: out.id, occurrence: key, userId, status: status as Rsvp, seenStartsAt: out.startsAt, seenEndsAt: out.endsAt, updatedAt: nowIso() });
      // 새 소식: 2분 안 같은 회차는 그 줄을 고치고, 취소는 그 줄만 지운다 (D-227)
      const acts = (s.activities ??= []);
      const since = new Date(Date.now() - 2 * 60_000).toISOString();
      const same = acts.find((a) => a.type === "EVENT_RSVP" && a.actorId === userId && a.createdAt >= since && a.payload.eventId === out.id && (a.payload.occurrence ?? null) === out.occurrence);
      if (status === null) {
        if (same) s.activities = acts.filter((a) => a !== same);
      } else {
        const payload = { eventId: out.id, eventCode: out.publicCode, occurrence: out.occurrence, title: out.title, startsAt: out.startsAt, endsAt: out.endsAt, allDay: out.allDay, status: status as Rsvp };
        if (same) Object.assign(same, { payload, createdAt: nowIso() });
        else acts.push({ id: nextId(), groupId: out.groupId, type: "EVENT_RSVP", actorId: userId, actorName: memberOf(s, out.groupId, userId).displayName, anniversaryId: null, payload, createdAt: nowIso() });
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

type RepeatRow = EventRow & { repeat: Repeat };

/** 반복 원본의 회차 하나 (취소, 규칙 밖이면 null) */
function occurrenceOf(e: RepeatRow, date: string): MockOccurrence | null {
  if (!isOccurrenceDate(e, date)) return null;
  return applyException(originalOccurrence(e, date), e.exceptions.find((x) => x.occurrence === date));
}

/** 반복 규칙 검사 (설계 4-1). repeat 가 null 이면 통과 */
function repeatCheck(repeat: Repeat | null, until: string | null, startsAt: string, endsAt: string): MockResult | null {
  if (until && !repeat) return err(400, "VALIDATION_FAILED", "반복 주기 없이 종료 날짜만 정할 수 없어요");
  if (!repeat) return null;
  if (Date.parse(endsAt) - Date.parse(startsAt) >= REPEAT_PERIOD_DAYS[repeat] * DAY_MS) {
    return err(400, "EVENT_RANGE_INVALID", "반복 간격보다 긴 일정은 반복할 수 없어요");
  }
  if (until && until < dateKeyOf(startsAt)) return err(400, "EVENT_RANGE_INVALID", "종료 날짜는 시작 날짜 뒤여야 해요");
  return null;
}

function repeatOf(v: unknown): Repeat | null | "bad" {
  if (v === undefined || v === null) return null;
  return REPEATS.includes(v as Repeat) ? (v as Repeat) : "bad";
}

function unread(s: Store, groupId: number, userId: number) {
  const ms = s.memberships.find((m) => m.groupId === groupId && m.userId === userId);
  const seen = ms?.lastSeenAt ?? "";
  // (#191) 일정 기록 + 팀 활동 기록
  const byOthers = (r: { groupId: number; actorId: number | null; createdAt: string }) =>
    r.groupId === groupId && r.actorId !== userId && r.createdAt > seen;
  return s.logs.filter(byOthers).length + (s.activities ?? []).filter(byOthers).length;
}

function validateEvent(input: Partial<EventRow>, partial: boolean): MockResult | null {
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

function rangeCheck(startsAt: string, endsAt: string): MockResult | null {
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
function applyInput(e: EventRow, input: Partial<EventRow>) {
  if (input.title !== undefined) e.title = String(input.title).trim();
  if (input.startsAt !== undefined) e.startsAt = new Date(String(input.startsAt)).toISOString();
  if (input.endsAt !== undefined) e.endsAt = new Date(String(input.endsAt)).toISOString();
  if (input.allDay !== undefined) e.allDay = Boolean(input.allDay);
  if (input.memo !== undefined) e.memo = input.memo ? String(input.memo) : null;
}

function leastUsedColor(s: Store, groupId: number): string {
  const used = s.memberships.filter((m) => m.groupId === groupId).map((m) => m.color);
  let best: string = MEMBER_COLORS[0];
  let bestCount = Infinity;
  for (const c of MEMBER_COLORS) {
    const n = used.filter((u) => u.toUpperCase() === c).length;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

function freeSlots(s: Store, groupId: number, q: URLSearchParams): MockResult {
  const fromRaw = q.get("from");
  const toRaw = q.get("to");
  if (!fromRaw || !toRaw) return err(400, "VALIDATION_FAILED", "조회 기간을 입력해 주세요");
  let from = Date.parse(fromRaw);
  const to = Date.parse(toRaw);
  if (Number.isNaN(from) || Number.isNaN(to) || to - from > 31 * DAY_MS || to <= from) {
    return err(400, "EVENT_RANGE_INVALID", "조회 기간은 31일 이내로 잡아 주세요");
  }
  // api.md 2.5: from 이 과거면 지금을 다음 30분 경계로 올려 자른다 (서버 ceilToSlotStep 과 같은 규칙, #136)
  if (from < Date.now()) from = ceilToStep(Date.now());
  const dayStart = q.get("dayStart") ?? "09:00";
  const dayEnd = q.get("dayEnd") ?? "23:00";
  const minMinutes = Number(q.get("minMinutes") ?? 120);
  const includeAllDay = q.get("includeAllDay") === "true";
  if (dayStart >= dayEnd || minMinutes < 30 || minMinutes > 720) {
    return err(400, "VALIDATION_FAILED", "시간대와 최소 길이를 확인해 주세요");
  }

  const memberIds = s.memberships.filter((m) => m.groupId === groupId).map((m) => m.userId);
  const allGroupIds = new Set(
    s.memberships.filter((m) => memberIds.includes(m.userId)).map((m) => m.groupId),
  );
  const memberSet = new Set(memberIds);
  const busy = s.events
    .filter((e) => allGroupIds.has(e.groupId) && isBusyForAny(e, memberSet))
    .flatMap((e): { startsAt: string; endsAt: string; allDay: boolean }[] => (e.repeat ? expand(e as RepeatRow, e.exceptions, from, to) : [e]))
    .filter((e) => Date.parse(e.startsAt) < to && Date.parse(e.endsAt) > from && (includeAllDay || !e.allDay))
    .map((e) => [Date.parse(e.startsAt), Date.parse(e.endsAt)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const b of busy) {
    const last = merged[merged.length - 1];
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]);
    else merged.push([b[0], b[1]]);
  }

  const slots: { startsAt: string; endsAt: string }[] = [];
  let dayKey = dateKeyOf(from);
  const endKey = dateKeyOf(to - 1);
  while (dayKey <= endKey && slots.length < 100) {
    const ws = Math.max(Date.parse(kstToIso(dayKey, dayStart)), from);
    const we = Math.min(Date.parse(kstToIso(dayKey, dayEnd)), to);
    let cursor = ws;
    for (const [bs, be] of merged) {
      if (be <= cursor) continue;
      if (bs >= we) break;
      if (bs - cursor >= minMinutes * 60000) {
        slots.push({ startsAt: new Date(cursor).toISOString(), endsAt: new Date(bs).toISOString() });
      }
      cursor = Math.max(cursor, be);
    }
    if (we - cursor >= minMinutes * 60000) {
      slots.push({ startsAt: new Date(cursor).toISOString(), endsAt: new Date(we).toISOString() });
    }
    dayKey = addDays(dayKey, 1);
  }
  return ok({ slots: slots.slice(0, 100), memberCount: memberIds.length });
}

/* ---------- (#276) 할 일 목록 (api.md 2.11) ---------- */

const TODO_LIST_LIMIT = 20;
const TODO_ITEM_LIMIT = 300;

function todoListOut(s: Store, l: TodoListRow) {
  return {
    id: l.id,
    publicCode: mockTodoCode(l.id),
    groupId: l.groupId,
    groupCode: mockGroupCode(l.groupId),
    name: l.name,
    creator: memberOf(s, l.groupId, l.creatorId),
    editor: memberOf(s, l.groupId, l.editorId),
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

function todoItemOut(s: Store, groupId: number, i: TodoItemRow) {
  return {
    id: i.id,
    listId: i.listId,
    text: i.text,
    done: i.done,
    doneAt: i.done ? i.doneAt : null,
    doneBy: i.done ? memberOf(s, groupId, i.doneById) : null,
    creator: memberOf(s, groupId, i.creatorId),
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

/** 미완료 추가순, 완료 최신순 (D-207) */
function sortedTodoItems(items: TodoItemRow[]): TodoItemRow[] {
  const open = items.filter((i) => !i.done).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  const done = items.filter((i) => i.done).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "") || b.id - a.id);
  return [...open, ...done];
}

const todoTextErr = (field: "name" | "text", max: number, label: string): MockResult => ({
  status: 400,
  body: errorBody(400, "VALIDATION_FAILED", `${label}은 1~${max}자여야 해요`, [{ field, message: `${label}은 1~${max}자여야 해요` }]),
});

/** 글 검사 (앞뒤 공백을 자른 길이). 맞으면 잘린 글, 아니면 오류 */
function todoText(v: unknown, field: "name" | "text"): string | MockResult {
  const max = field === "name" ? 30 : 100;
  const label = field === "name" ? "목록 이름" : "할 일";
  if (typeof v !== "string") return todoTextErr(field, max, label);
  const t = v.trim();
  return t.length < 1 || Array.from(t).length > max ? todoTextErr(field, max, label) : t;
}

function todoRoutes(s: Store, groupId: number, userId: number, rest: string[], method: string, query: URLSearchParams, body: Record<string, unknown> | null): MockResult | null {
  const lists = (s.todoLists ??= []);
  const items = (s.todoItems ??= []);
  const touch = (l: TodoListRow) => {
    l.updatedAt = nowIso();
    l.editorId = userId;
  };
  if (rest[0] === "todo-lists") {
    if (rest.length === 1 && method === "GET") {
      const out = lists
        .filter((l) => l.groupId === groupId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
        .map((l) => {
          const mine = items.filter((i) => i.listId === l.id);
          return {
            id: l.id,
            publicCode: mockTodoCode(l.id),
            name: l.name,
            openCount: mine.filter((i) => !i.done).length,
            doneCount: mine.filter((i) => i.done).length,
            editor: memberOf(s, groupId, l.editorId),
            updatedAt: l.updatedAt,
          };
        });
      return ok({ items: out });
    }
    if (rest.length === 1 && method === "POST") {
      const name = todoText(body?.name, "name");
      if (isResult(name)) return name;
      if (lists.filter((l) => l.groupId === groupId).length >= TODO_LIST_LIMIT) return err(400, "TODO_LIMIT_REACHED", "목록은 20개까지 만들 수 있어요");
      const now = nowIso();
      const row: TodoListRow = { id: nextId(), groupId, name, creatorId: userId, editorId: userId, createdAt: now, updatedAt: now };
      lists.push(row);
      return ok(todoListOut(s, row), 201);
    }
    const listId = parseId(rest[1]);
    if (listId === null) return err(400, "VALIDATION_FAILED", "listId 은(는) 양의 정수여야 해요");
    const list = lists.find((l) => l.id === listId && l.groupId === groupId);
    if (!list) return err(404, "NOT_FOUND", "할 일 목록을 찾을 수 없어요");
    if (rest.length === 2 && method === "PATCH") {
      const name = todoText(body?.name, "name");
      if (isResult(name)) return name;
      if (name !== list.name) {
        list.name = name;
        touch(list);
      }
      return ok(todoListOut(s, list));
    }
    if (rest.length === 2 && method === "DELETE") {
      s.todoLists = lists.filter((l) => l.id !== list.id);
      s.todoItems = items.filter((i) => i.listId !== list.id);
      return ok({ ok: true });
    }
    if (rest[2] === "items" && method === "POST") {
      const text = todoText(body?.text, "text");
      if (isResult(text)) return text;
      if (body?.done !== undefined && typeof body.done !== "boolean") return err(400, "VALIDATION_FAILED", "done 은 true/false 여야 해요");
      if (items.filter((i) => i.listId === list.id).length >= TODO_ITEM_LIMIT) return err(400, "TODO_LIMIT_REACHED", "항목은 300개까지 넣을 수 있어요");
      const now = nowIso();
      const done = body?.done === true;
      const row: TodoItemRow = { id: nextId(), listId: list.id, text, done, doneAt: done ? now : null, doneById: done ? userId : null, creatorId: userId, createdAt: now, updatedAt: now };
      items.push(row);
      touch(list);
      return ok(todoItemOut(s, groupId, row), 201);
    }
    if (rest[2] === "items" && method === "DELETE") {
      if (query.get("done") !== "true") return err(400, "VALIDATION_FAILED", "완료 항목만 지울 수 있어요 (done=true)");
      const count = items.filter((i) => i.listId === list.id && i.done).length;
      s.todoItems = items.filter((i) => !(i.listId === list.id && i.done));
      if (count > 0) touch(list);
      return ok({ ok: true, count });
    }
    return null;
  }
  if (rest[0] === "todo-items" && rest.length === 2) {
    const itemId = parseId(rest[1]);
    if (itemId === null) return err(400, "VALIDATION_FAILED", "itemId 은(는) 양의 정수여야 해요");
    const item = items.find((i) => i.id === itemId && lists.some((l) => l.id === i.listId && l.groupId === groupId));
    if (!item) return err(404, "NOT_FOUND", "이미 삭제된 항목이에요");
    const list = lists.find((l) => l.id === item.listId)!;
    if (method === "PATCH") {
      let changed = false;
      if (body?.text !== undefined) {
        const text = todoText(body.text, "text");
        if (isResult(text)) return text;
        if (text !== item.text) {
          item.text = text;
          changed = true;
        }
      }
      if (body?.done !== undefined) {
        if (typeof body.done !== "boolean") return err(400, "VALIDATION_FAILED", "done 은 true/false 여야 해요");
        if (body.done !== item.done) {
          item.done = body.done;
          item.doneAt = body.done ? nowIso() : null;
          item.doneById = body.done ? userId : null;
          changed = true;
        }
      }
      if (changed) {
        item.updatedAt = nowIso();
        touch(list);
      }
      return ok(todoItemOut(s, groupId, item));
    }
    if (method === "DELETE") {
      s.todoItems = items.filter((i) => i.id !== item.id);
      touch(list);
      return ok({ ok: true });
    }
  }
  return null;
}

export function mockHandle(ctx: Ctx): MockResult {
  const s = store();
  const { method, query, body } = ctx;
  const path = ctx.path.replace(/\/+$/, "") || "/";
  const seg = path.split("/").filter(Boolean);

  if (method === "GET" && path === "/health") return ok({ ok: true });

  // 공개(선택 인증): 초대 미리보기. (#196) by 가 현재 멤버 표식이면 inviter, 로그인한 내가 멤버면 isMember + groupId
  if (method === "GET" && seg[0] === "invites" && seg[1]) {
    const code = seg[1].toUpperCase();
    const grp = s.groups.find((x) => x.inviteCode === code);
    if (!grp) return err(404, "INVITE_NOT_FOUND", "초대 링크가 만료됐거나 잘못됐어요");
    const members = s.memberships.filter((m) => m.groupId === grp.id);
    const by = query.get("by");
    const inviter = by ? members.find((m) => inviteMarkerOf(grp.id, m.userId) === by) : undefined;
    const isMember = ctx.userId !== null && members.some((m) => m.userId === ctx.userId);
    return ok({
      groupName: grp.name,
      memberCount: members.length,
      inviter: inviter ? { nickname: memberOf(s, grp.id, inviter.userId).displayName } : null,
      isMember,
      groupId: isMember ? grp.id : null,
      groupCode: isMember ? mockGroupCode(grp.id) : null,
    });
  }

  // (#245) 공개: 이메일 로그인 (웹 서버 전용 엔드포인트, 이메일-로그인.md 4장)
  const email = mockEmailLogin(s, method, path, body);
  if (email) return email;

  const userId = ctx.userId;
  if (!userId || !s.users.find((u) => u.id === userId)) {
    return err(401, "UNAUTHORIZED", "로그인이 필요해요");
  }

  // /me
  if (seg[0] === "me" && seg.length === 1) {
    const u = s.users.find((x) => x.id === userId)!;
    if (method === "GET") {
      return ok({ id: u.id, nickname: u.nickname, profileImageUrl: u.profileImageUrl, createdAt: u.createdAt, startCalendar: u.startCalendar ?? START_LAST });
    }
    if (method === "PATCH") {
      const nickname = typeof body?.nickname === "string" ? body.nickname.trim() : "";
      if (nickname.length < 1 || nickname.length > 20) {
        return err(400, "VALIDATION_FAILED", "닉네임은 1~20자여야 해요");
      }
      u.nickname = nickname;
      return ok({ id: u.id, nickname: u.nickname, profileImageUrl: u.profileImageUrl, createdAt: u.createdAt });
    }
    if (method === "DELETE") {
      // 목에서는 탈퇴 처리 대신 성공만 돌려주고 상태는 초기화한다
      g.__wwmMockStore = buildStore();
      return ok({ ok: true });
    }
  }

  // (#300) /me/start-calendar (api.md 2.1, D-191). 짝이 틀리면 400, 내 팀이 아니면 403, 개인 팀은 PERSONAL 로 (400)
  if (seg[0] === "me" && seg[1] === "start-calendar" && seg.length === 2 && method === "PATCH") {
    const u = s.users.find((x) => x.id === userId)!;
    const mode = body?.mode;
    const groupId = body?.groupId ?? null;
    const invalid = (message: string): MockResult => ({ status: 400, body: errorBody(400, "VALIDATION_FAILED", message, [{ field: "groupId", message }]) });
    if (mode !== "LAST" && mode !== "PERSONAL" && mode !== "GROUP") return err(400, "VALIDATION_FAILED", "처음 여는 달력 값이 올바르지 않아요");
    if (groupId !== null && (typeof groupId !== "number" || !Number.isInteger(groupId) || groupId < 1)) return err(400, "VALIDATION_FAILED", "팀 ID 는 정수여야 해요");
    if (mode !== "GROUP") {
      if (groupId !== null) return invalid("팀을 고를 때만 팀 ID 를 보내 주세요");
      u.startCalendar = { mode, groupId: null };
      return ok(u.startCalendar);
    }
    if (groupId === null) return invalid("고정할 팀을 골라 주세요");
    const grp = s.memberships.some((m) => m.userId === userId && m.groupId === groupId) ? s.groups.find((x) => x.id === groupId) : undefined;
    if (!grp) return err(403, "FORBIDDEN", "이 팀의 멤버가 아니에요");
    if (grp.type === "PERSONAL") return invalid('내 달력은 "내 달력" 으로 골라 주세요');
    u.startCalendar = { mode: "GROUP", groupId };
    return ok(u.startCalendar);
  }

  // /me/avatar (api.md 2.1). 목은 업로드한 바이트를 mocks/files.ts 에 두고 /api/__mock/files/<id> 경로를 준다
  if (seg[0] === "me" && seg[1] === "avatar" && seg.length === 2) {
    const u = s.users.find((x) => x.id === userId)!;
    if (method === "POST") {
      const file = body?.file as { type: string; size: number; url: string } | undefined;
      if (!file || !/^image\/(jpeg|png|webp|heic)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
        return err(400, "VALIDATION_FAILED", "jpg, png, webp 10MB 까지 올릴 수 있어요");
      }
      u.profileImageUrl = file.url;
      return ok({ profileImageUrl: u.profileImageUrl });
    }
    if (method === "DELETE") {
      u.profileImageUrl = null;
      return ok({ profileImageUrl: null });
    }
  }

  // (#188) /me/push-devices (7-1). 토큰으로 upsert, 다른 사용자 행이면 나로 옮긴다. 한 사용자 10대
  if (seg[0] === "me" && seg[1] === "push-devices" && seg.length === 2) {
    const devices = (s.pushDevices ??= []);
    const token = body?.token;
    if (typeof token !== "string" || !PUSH_TOKEN_RE.test(token)) {
      return { status: 400, body: errorBody(400, "VALIDATION_FAILED", "푸시 토큰 형식이 올바르지 않아요", [{ field: "token", message: "푸시 토큰 형식이 올바르지 않아요" }]) };
    }
    if (method === "PUT") {
      const platform = body?.platform;
      const appVersion = body?.appVersion;
      if (platform !== "IOS" && platform !== "ANDROID") return err(400, "VALIDATION_FAILED", "platform 은 IOS 또는 ANDROID 여야 해요");
      if (typeof appVersion !== "string" || appVersion.length < 1 || appVersion.length > 20) return err(400, "VALIDATION_FAILED", "appVersion 은 1~20자여야 해요");
      s.pushDevices = devices.filter((d) => d.token !== token);
      s.pushDevices.push({ token, userId, platform, appVersion, lastSeenAt: nowIso() });
      const mine = s.pushDevices.filter((d) => d.userId === userId).sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
      if (mine.length > 10) {
        const drop = new Set(mine.slice(0, mine.length - 10).map((d) => d.token));
        s.pushDevices = s.pushDevices.filter((d) => !drop.has(d.token));
      }
      return ok({ ok: true });
    }
    if (method === "DELETE") {
      s.pushDevices = devices.filter((d) => !(d.token === token && d.userId === userId));
      return ok({ ok: true });
    }
  }

  // (#188) /me/notification-settings (7-1). 불리언만, 빈 본문은 그대로
  if (seg[0] === "me" && seg[1] === "notification-settings" && seg.length === 2) {
    const u = s.users.find((x) => x.id === userId)!;
    const current = { ...DEFAULT_NOTIFY, ...u.notify };
    if (method === "GET") return ok(current);
    if (method === "PATCH") {
      const next = { ...current };
      for (const [k, v] of Object.entries(body ?? {})) {
        if (!NOTIFY_KEYS.includes(k as keyof NotificationSettings)) return err(400, "VALIDATION_FAILED", `${k} 은(는) 허용되지 않는 항목이에요`);
        if (typeof v !== "boolean") return { status: 400, body: errorBody(400, "VALIDATION_FAILED", `${k} 은(는) 참/거짓이어야 해요`, [{ field: k, message: `${k} 은(는) 참/거짓이어야 해요` }]) };
        next[k as keyof NotificationSettings] = v;
      }
      u.notify = next;
      return ok(next);
    }
  }

  // /groups
  if (seg[0] === "groups" && seg.length === 1) {
    if (method === "GET") {
      const mine = s.memberships
        .filter((m) => m.userId === userId)
        .map((m) => ({ m, grp: s.groups.find((x) => x.id === m.groupId)! }))
        .sort((a, b) => {
          if (a.grp.type !== b.grp.type) return a.grp.type === "PERSONAL" ? -1 : 1;
          return a.m.joinedAt.localeCompare(b.m.joinedAt);
        })
        .map(({ m, grp }) => ({
          id: grp.id,
          type: grp.type,
          name: grp.name,
          publicCode: mockGroupCode(grp.id),
          memberCount: s.memberships.filter((x) => x.groupId === grp.id).length,
          me: { color: m.color, displayName: memberOf(s, grp.id, userId).displayName },
          unreadNewsCount: unread(s, grp.id, userId),
        }));
      return ok(mine);
    }
    if (method === "POST") {
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (name.length < 1 || name.length > 30) {
        return err(400, "VALIDATION_FAILED", "팀 이름은 1~30자로 입력해 주세요");
      }
      const id = nextId();
      const code = Array.from({ length: 6 }, () =>
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)],
      ).join("");
      s.groups.push({ id, type: "TEAM", name, inviteCode: code, createdAt: nowIso() });
      s.memberships.push({
        userId,
        groupId: id,
        color: MEMBER_COLORS[0],
        displayName: null,
        joinedAt: nowIso(),
        lastSeenAt: nowIso(),
      });
      return ok(groupDetail(s, id, userId), 201);
    }
  }

  if (seg[0] === "groups" && seg[1] === "join" && method === "POST") {
    const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
    const grp = s.groups.find((x) => x.inviteCode === code);
    if (!grp) return err(404, "INVITE_NOT_FOUND", "초대 링크가 만료됐거나 잘못됐어요");
    if (!s.memberships.find((m) => m.groupId === grp.id && m.userId === userId)) {
      s.memberships.push({
        userId,
        groupId: grp.id,
        color: leastUsedColor(s, grp.id),
        displayName: null,
        joinedAt: nowIso(),
        lastSeenAt: nowIso(),
      });
    }
    return ok(groupDetail(s, grp.id, userId));
  }

  // (#311) 공개 코드로 일정 하나 GET /events/:code?occurrence= (api.md 2.3). 내 팀 일정이 아니거나 없으면 모두 404.
  // 찾은 뒤에는 단건 조회와 같은 응답이라 그 경로로 다시 처리한다
  if (seg[0] === "events" && seg.length === 2 && method === "GET") {
    const code = seg[1].toLowerCase();
    const e = s.events.find((x) => mockEventCode(x.id) === code);
    if (!e || !s.memberships.some((m) => m.groupId === e.groupId && m.userId === userId)) return err(404, "NOT_FOUND", "일정을 찾을 수 없어요");
    return mockHandle({ ...ctx, path: `/groups/${e.groupId}/events/${e.id}` });
  }

  // (#276) 공개 코드로 할 일 목록 하나 GET /todo-lists/:code. 내 팀 목록이 아니거나 없으면 404
  if (seg[0] === "todo-lists" && seg.length === 2 && method === "GET") {
    const code = seg[1].toLowerCase();
    const l = (s.todoLists ?? []).find((x) => mockTodoCode(x.id) === code);
    if (!l || !s.memberships.some((m) => m.groupId === l.groupId && m.userId === userId)) return err(404, "NOT_FOUND", "할 일 목록을 찾을 수 없어요");
    const mine = sortedTodoItems((s.todoItems ?? []).filter((i) => i.listId === l.id));
    return ok({ list: todoListOut(s, l), items: mine.map((i) => todoItemOut(s, l.groupId, i)) });
  }

  // /groups/:groupId/...
  if (seg[0] === "groups" && seg[1]) {
    const groupId = parseId(seg[1]);
    if (groupId === null) return err(400, "VALIDATION_FAILED", "groupId 은(는) 양의 정수여야 해요");
    const grp = s.groups.find((x) => x.id === groupId);
    if (!grp) return err(404, "NOT_FOUND", "팀을 찾을 수 없어요");
    const ms = s.memberships.find((m) => m.groupId === groupId && m.userId === userId);
    if (!ms) return err(403, "FORBIDDEN", "이 팀에 더 이상 속해 있지 않아요");
    const rest = seg.slice(2);

    // (#279) 일정 가져오기. 목은 파일을 읽지 않고 고정된 미리보기와 결과만 준다 (화면 확인용)
    if (rest[0] === "imports" && method === "POST") {
      const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
      if (rest[1] === "preview") {
        return ok({
          total: 9,
          toCreate: 14,
          recurringKept: 2,
          expanded: 11,
          expandedSeries: 3,
          skipped: [
            { reason: "CANCELLED", count: 1 },
            { reason: "TOO_OLD", count: 1 },
          ],
          firstStartsAt: at(1),
          lastStartsAt: at(200),
          warnings: [],
          sample: [
            { title: "영어 스터디", startsAt: at(2), endsAt: at(2.05), allDay: false, repeat: "WEEKLY" },
            { title: "치과", startsAt: at(3), endsAt: at(3.05), allDay: false, repeat: null },
          ],
          // (#314) 넣을 일정 전부. key 는 64자 hex 모양만 맞춘다
          items: Array.from({ length: 14 }, (_, i) => {
            const day = 1 + i * 15;
            return {
              key: i.toString(16).padStart(64, "0"),
              title: i === 0 ? "영어 스터디" : `가져온 일정 ${i + 1}`,
              startsAt: at(day),
              endsAt: at(i % 3 === 0 ? day + 2 : day + 0.05),
              allDay: i % 3 === 0,
              repeat: i === 0 ? "WEEKLY" : null,
            };
          }),
        });
      }
      return ok({ importId: 1, created: 14, skipped: [{ reason: "CANCELLED", count: 1 }] }, 201);
    }

    if (rest.length === 0) {
      if (method === "GET") return ok(groupDetail(s, groupId, userId));
      if (method === "PATCH") {
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        if (name.length < 1 || name.length > 30) {
          return err(400, "VALIDATION_FAILED", "팀 이름은 1~30자로 입력해 주세요");
        }
        grp.name = name;
        return ok(groupDetail(s, groupId, userId));
      }
    }

    if (rest[0] === "invite-code" && method === "POST") {
      if (grp.type === "PERSONAL") {
        return err(400, "GROUP_NOT_INVITABLE", "개인 달력에는 초대 코드를 만들 수 없어요");
      }
      const code = Array.from({ length: 6 }, () =>
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)],
      ).join("");
      grp.inviteCode = code;
      return ok({ inviteCode: code, inviteUrl: inviteUrlOf(code), inviteShareUrl: `${inviteUrlOf(code)}?by=${inviteMarkerOf(grp.id, userId)}` });
    }

    // (#193) 외부 캘린더 구독 주소 (api.md 2.12). 목은 피드 본문을 내지 않는다 (주소만)
    if (rest[0] === "calendar-feed") return calendarFeedRoute(s, method, rest.slice(1), body, groupId, userId);

    if (rest[0] === "me" && rest.length === 1) {
      if (method === "PATCH") {
        if (body && "color" in body) {
          const c = body.color;
          if (typeof c !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(c)) {
            return err(400, "VALIDATION_FAILED", "색 값이 올바르지 않아요");
          }
          ms.color = c;
        }
        if (body && "displayName" in body) {
          const dn = body.displayName;
          if (dn === null || dn === "") ms.displayName = null;
          else if (typeof dn === "string" && dn.trim().length <= 20) ms.displayName = dn.trim();
          else return err(400, "VALIDATION_FAILED", "표시 이름은 20자까지 쓸 수 있어요");
        }
        // (#188) 이 팀 알림 받기
        if (body && "notify" in body) {
          if (typeof body.notify !== "boolean") return err(400, "VALIDATION_FAILED", "notify 는 참/거짓이어야 해요");
          ms.notify = body.notify;
        }
        return ok(myMember(s, groupId, userId));
      }
      if (method === "DELETE") {
        if (grp.type === "PERSONAL") {
          return err(400, "GROUP_PERSONAL_LEAVE", "개인 달력은 나갈 수 없어요");
        }
        s.memberships = s.memberships.filter((m) => !(m.groupId === groupId && m.userId === userId));
        // (#300) 고정한 팀에서 나가면 처음 여는 달력은 마지막에 본 달력으로 (D-192)
        const leaver = s.users.find((x) => x.id === userId);
        if (leaver?.startCalendar?.groupId === groupId) leaver.startCalendar = START_LAST;
        // (#248 6장) 그 팀 일정의 내 참여자 행을 지운다. 0 이 되면 "참여자 없음". 로그, 새 소식 없음 (D-139)
        for (const e of s.events) {
          if (e.groupId === groupId && e.participantIds) e.participantIds = e.participantIds.filter((id) => id !== userId);
        }
        const remain = s.memberships.filter((m) => m.groupId === groupId).length;
        if (remain === 0) {
          s.groups = s.groups.filter((x) => x.id !== groupId);
          s.events = s.events.filter((e) => e.groupId !== groupId);
          s.anniversaries = s.anniversaries.filter((a) => a.groupId !== groupId);
          const goneLists = new Set((s.todoLists ?? []).filter((l) => l.groupId === groupId).map((l) => l.id));
          s.todoLists = (s.todoLists ?? []).filter((l) => !goneLists.has(l.id));
          s.todoItems = (s.todoItems ?? []).filter((i) => !goneLists.has(i.listId));
          s.logs = s.logs.filter((l) => l.groupId !== groupId);
        }
        return ok({ groupDeleted: remain === 0 });
      }
    }

    if (rest[0] === "events") {
      const log = (e: { title: string; startsAt: string; endsAt: string; allDay: boolean }, extra: Pick<EventLogRow, "action" | "eventId" | "repeat" | "scope" | "occurrence">) =>
        s.logs.push({ id: nextId(), groupId, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, allDay: e.allDay, actorId: userId, createdAt: nowIso(), ...extra });

      if (rest.length === 1 && method === "GET") {
        const from = Date.parse(query.get("from") ?? "");
        const to = Date.parse(query.get("to") ?? "");
        if (Number.isNaN(from) || Number.isNaN(to)) {
          return err(400, "VALIDATION_FAILED", "조회 기간을 확인해 주세요");
        }
        if (to - from > 62 * DAY_MS) return err(400, "EVENT_RANGE_INVALID", "조회 기간은 62일 이내예요");
        // 반복 원본은 기간 안 회차로 펼친다 (#187)
        const list = s.events
          .filter((e) => e.groupId === groupId)
          .flatMap((e) =>
            e.repeat
              ? expand(e as RepeatRow, e.exceptions, from, to).map((o) => eventOut(s, e, o))
              : Date.parse(e.startsAt) < to && Date.parse(e.endsAt) > from
                ? [eventOut(s, e)]
                : [],
          )
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id || (a.occurrence ?? "").localeCompare(b.occurrence ?? ""))
          .map((out) => withResponses(s, out, userId));
        return ok(list);
      }
      if (rest.length === 1 && method === "POST") {
        const input = (body ?? {}) as Partial<EventRow>;
        const repeat = repeatOf(input.repeat);
        if (repeat === "bad") return err(400, "VALIDATION_FAILED", "반복 주기를 확인해 주세요");
        const until = input.repeatUntil ? String(input.repeatUntil) : null;
        const reminder = reminderIn((body ?? {}).reminder) ?? "NONE";
        if (isResult(reminder)) return reminder;
        // (#248) 생략 = [요청자]
        const pIn = participantsIn(s, groupId, (body ?? {}).participants) ?? { all: false, ids: [userId] };
        if (isResult(pIn)) return pIn;
        const cIn = colorIn((body ?? {}).color);
        if (isResult(cIn)) return cIn;
        const v =
          reminderFit(reminder, Boolean(input.allDay)) ??
          validateEvent(input, false) ??
          rangeCheck(String(input.startsAt), String(input.endsAt)) ??
          repeatCheck(repeat, until, String(input.startsAt), String(input.endsAt));
        if (v) return v;
        const row: EventRow = {
          id: nextId(),
          groupId,
          title: String(input.title).trim(),
          startsAt: new Date(String(input.startsAt)).toISOString(),
          endsAt: new Date(String(input.endsAt)).toISOString(),
          allDay: Boolean(input.allDay),
          memo: input.memo ? String(input.memo) : null,
          creatorId: userId,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          repeat,
          repeatUntil: repeat ? until : null,
          exceptions: [],
          reminder,
          color: cIn ?? null,
        };
        applyParticipants(row, pIn);
        s.events.push(row);
        log(row, { action: "CREATED", eventId: row.id, repeat, scope: null, occurrence: null });
        return ok(eventOut(s, row), 201);
      }
      const eventId = parseId(rest[1]);
      if (eventId === null) return err(400, "VALIDATION_FAILED", "eventId 은(는) 양의 정수여야 해요");
      const e = s.events.find((x) => x.id === eventId && x.groupId === groupId);
      if (!e) return err(404, "NOT_FOUND", "이미 삭제된 일정이에요");

      // 한 번짜리 (예전 그대로. occurrence, scope 는 무시)
      if (!e.repeat) {
        if (method === "GET") return ok({ ...withResponseMembers(s, eventOut(s, e), userId), hasLaterExceptions: false });
        if (method === "PUT" && (rest[2] === "rsvp" || rest[2] === "reaction")) return responseRoute(s, eventOut(s, e), userId, rest[2], body);
        if (method === "PATCH") {
          const input = (body ?? {}) as Partial<EventRow>;
          const repeat = repeatOf(input.repeat);
          if (repeat === "bad") return err(400, "VALIDATION_FAILED", "반복 주기를 확인해 주세요");
          const until = input.repeatUntil ? String(input.repeatUntil) : null;
          const startsAt = String(input.startsAt ?? e.startsAt);
          const endsAt = String(input.endsAt ?? e.endsAt);
          const v = validateEvent(input, true) ?? rangeCheck(startsAt, endsAt) ?? repeatCheck(repeat, until, startsAt, endsAt);
          if (v) return v;
          const rIn = reminderIn((body ?? {}).reminder);
          if (isResult(rIn)) return rIn;
          const reminder = mergedReminder(rIn, e.reminder ?? "NONE", input.allDay !== undefined ? Boolean(input.allDay) : e.allDay);
          if (isResult(reminder)) return reminder;
          // (#248) 생략 = 그대로
          const pIn = participantsIn(s, groupId, (body ?? {}).participants);
          if (isResult(pIn)) return pIn;
          const cIn = colorIn((body ?? {}).color);
          if (isResult(cIn)) return cIn;
          // (#343) 색 말고 바뀐 값이 있는지 (색만 바꾸면 새 소식 없음, D-215)
          const before = JSON.stringify(eventOut(s, { ...e, color: null }));
          applyInput(e, input);
          if (pIn) applyParticipants(e, pIn);
          e.reminder = reminder;
          // 반복을 켜면 이 일정이 첫 회차 (기획 3-4)
          if (repeat) {
            e.repeat = repeat;
            e.repeatUntil = until;
          }
          if (cIn !== undefined) e.color = cIn;
          e.updatedAt = nowIso();
          if (JSON.stringify(eventOut(s, { ...e, color: null, updatedAt: JSON.parse(before).updatedAt })) !== before) {
            log(e, { action: "UPDATED", eventId: e.id, repeat: e.repeat, scope: null, occurrence: null });
          }
          return ok(eventOut(s, e));
        }
        if (method === "DELETE") {
          s.events = s.events.filter((x) => x.id !== e.id);
          log(e, { action: "DELETED", eventId: null, repeat: null, scope: null, occurrence: null });
          return ok({ ok: true });
        }
      }

      // 반복 일정 (#187, api.md 2.3 반복 일정 표)
      const series = e as RepeatRow;
      const first = dateKeyOf(series.startsAt);
      if (method === "GET") {
        const date = query.get("occurrence") || first;
        const o = occurrenceOf(series, date);
        if (!o) return err(404, "NOT_FOUND", "이미 삭제된 일정이에요");
        return ok({ ...withResponseMembers(s, eventOut(s, series, o), userId), hasLaterExceptions: series.exceptions.some((x) => x.occurrence > date) });
      }
      if (method === "PUT" && (rest[2] === "rsvp" || rest[2] === "reaction")) {
        const date = query.get("occurrence") ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err(400, "VALIDATION_FAILED", "반복 일정은 회차 날짜(occurrence)를 함께 보내야 해요");
        const o = occurrenceOf(series, date);
        if (!o) return err(404, "NOT_FOUND", "이미 삭제된 일정이에요");
        return responseRoute(s, eventOut(s, series, o), userId, rest[2], body);
      }
      const scope = query.get("scope");
      if (scope !== "this" && scope !== "following") return err(400, "VALIDATION_FAILED", "scope 는 this 또는 following 이어야 해요");
      const date = query.get("occurrence") ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err(400, "VALIDATION_FAILED", "occurrence 는 YYYY-MM-DD 형식의 실제 날짜여야 해요");
      const current = occurrenceOf(series, date);
      if (!current) return err(404, "NOT_FOUND", "이미 삭제된 일정이에요");
      const logScope = scope === "this" ? "THIS" : "FOLLOWING";
      const values = { ...current, title: current.title ?? series.title, memo: current.memo ?? series.memo ?? "" };

      if (method === "PATCH") {
        const input = (body ?? {}) as Partial<EventRow>;
        // 기준 값: "이 일정만" 은 그 회차의 현재 값(예외 반영), "이후 모두" 는 그 회차의 규칙 자리(예외 적용 전, QA3-M3, D-71)
        const slot = originalOccurrence(series, date);
        const base = scope === "this" ? values : { ...slot, title: series.title, memo: series.memo ?? "" };
        const startsAt = String(input.startsAt ?? base.startsAt);
        const endsAt = String(input.endsAt ?? base.endsAt);
        const v = validateEvent(input, true) ?? rangeCheck(startsAt, endsAt);
        if (v) return v;
        const rIn = reminderIn((body ?? {}).reminder);
        if (isResult(rIn)) return rIn;
        const next = {
          title: input.title !== undefined ? String(input.title).trim() : base.title,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          allDay: input.allDay !== undefined ? Boolean(input.allDay) : base.allDay,
          memo: input.memo !== undefined ? String(input.memo ?? "") : base.memo,
        };
        // (#188) 알림: "이 일정만" 은 그 회차의 현재 값, "이후 모두" 는 원본 값에서 합친다 (4-1)
        const reminder = mergedReminder(rIn, scope === "this" ? (current.reminder ?? series.reminder ?? "NONE") : (series.reminder ?? "NONE"), next.allDay);
        if (isResult(reminder)) return reminder;
        if (scope === "this") {
          if ("repeat" in input || "repeatUntil" in input) return err(400, "VALIDATION_FAILED", "이 일정만 수정할 때는 반복을 바꿀 수 없어요");
          // (#248 D-135) 같은 값이어도 400
          if (body && "participants" in body) return participantErr("이 일정만 수정할 때는 참여자를 바꿀 수 없어요");
          // (#343) 색도 원본 단위 (D-215)
          if (body && "color" in body) return colorErr("반복 일정의 색은 이후 모두로만 바꿀 수 있어요");
          // 예외는 바꾼 최종 값을 통째로 저장 (목은 "원래 값과 다른 필드만" 을 생략한다)
          series.exceptions = series.exceptions.filter((x) => x.occurrence !== date);
          // 원래 회차 값(원본 알림)과 같으면 null (4-1)
          const xReminder = reminder === (series.reminder ?? "NONE") ? null : reminder;
          series.exceptions.push({ occurrence: date, cancelled: false, ...next, reminder: xReminder });
          series.updatedAt = nowIso();
          log(next, { action: "UPDATED", eventId: series.id, repeat: series.repeat, scope: logScope, occurrence: date });
          return ok(eventOut(s, series, { occurrence: date, ...next, reminder }));
        }
        const repeat = input.repeat === undefined ? series.repeat : repeatOf(input.repeat);
        if (repeat === "bad") return err(400, "VALIDATION_FAILED", "반복 주기를 확인해 주세요");
        // 본문에 repeatUntil 이 없으면 이어받되, 회차를 그 뒤로 옮겼으면 새 시작 날짜까지 늘린다 (API inheritedUntil, QA3-L1)
        const startKey = dateKeyOf(next.startsAt);
        const inherited = series.repeatUntil && series.repeatUntil < startKey ? startKey : series.repeatUntil;
        const until = input.repeatUntil !== undefined ? (input.repeatUntil ? String(input.repeatUntil) : null) : repeat ? inherited : null;
        const rv = repeatCheck(repeat, until, next.startsAt, next.endsAt);
        if (rv) return rv;
        // (#248) 생략이면 원본 참여자를 이어받는다 (새 원본은 아래 복사)
        const pIn = participantsIn(s, groupId, (body ?? {}).participants);
        if (isResult(pIn)) return pIn;
        const cIn = colorIn((body ?? {}).color);
        if (isResult(cIn)) return cIn;
        const color = cIn === undefined ? (series.color ?? null) : cIn;
        // (#343) 색 말고 바뀐 값이 없으면 새 소식을 남기지 않는다 (API 와 같은 기준: 규칙, 참여자, 회차 값이 같고 그날부터 예외 없음)
        const sameMembers = !pIn || (pIn.all ? series.allMembers !== false : series.allMembers === false && JSON.stringify(pIn.ids) === JSON.stringify(series.participantIds ?? []));
        const onlyColor =
          repeat === series.repeat &&
          until === series.repeatUntil &&
          sameMembers &&
          !series.exceptions.some((x) => x.occurrence >= date) &&
          next.title === base.title &&
          next.startsAt === new Date(base.startsAt).toISOString() &&
          next.endsAt === new Date(base.endsAt).toISOString() &&
          next.allDay === base.allDay &&
          (next.memo || "") === (base.memo || "") &&
          reminder === (series.reminder ?? "NONE");
        // 반복 기준 날짜 (API followingAnchor, D-71): 주기 그대로인 매월/매년이고 날짜를 안 바꿨으면 잇는다. 첫 회차는 원본 값 그대로
        const keepsAnchor = repeat === series.repeat && startKey === date && (repeat === "MONTHLY" || repeat === "YEARLY");
        const repeatAnchor = keepsAnchor ? (date === first ? (series.repeatAnchor ?? null) : (series.repeatAnchor ?? first)) : null;
        const fields = { ...next, memo: next.memo || null, repeat, repeatUntil: repeat ? until : null, repeatAnchor, reminder, color, updatedAt: nowIso() };
        let target: EventRow;
        if (date === first) {
          // 첫 회차 "이후 모두" = 전체. 예외는 버린다 (D-67)
          Object.assign(series, fields, { exceptions: [] });
          target = series;
          if (pIn) applyParticipants(target, pIn);
        } else {
          // 원본을 전날에서 끊고 새 원본 (등록자는 원본 등록자, D-66)
          series.repeatUntil = addDays(date, -1);
          series.exceptions = series.exceptions.filter((x) => x.occurrence < date);
          target = { ...series, ...fields, id: nextId(), createdAt: nowIso(), exceptions: [], participantIds: [...(series.participantIds ?? [])] };
          if (pIn) applyParticipants(target, pIn);
          s.events.push(target);
        }
        if (!onlyColor) log(eventOut(s, target), { action: "UPDATED", eventId: target.id, repeat: series.repeat, scope: logScope, occurrence: date });
        return ok(eventOut(s, target));
      }
      if (method === "DELETE") {
        const snap = { title: values.title, startsAt: values.startsAt, endsAt: values.endsAt, allDay: values.allDay };
        if (scope === "this") {
          series.exceptions = series.exceptions.filter((x) => x.occurrence !== date);
          series.exceptions.push({ occurrence: date, cancelled: true });
          log(snap, { action: "DELETED", eventId: series.id, repeat: series.repeat, scope: logScope, occurrence: date });
        } else if (date === first) {
          s.events = s.events.filter((x) => x.id !== series.id);
          log(snap, { action: "DELETED", eventId: null, repeat: series.repeat, scope: logScope, occurrence: date });
        } else {
          series.repeatUntil = addDays(date, -1);
          series.exceptions = series.exceptions.filter((x) => x.occurrence < date);
          log(snap, { action: "DELETED", eventId: series.id, repeat: series.repeat, scope: logScope, occurrence: date });
        }
        return ok({ ok: true });
      }
    }

    if (rest[0] === "anniversaries") {
      const out = (a: (typeof s.anniversaries)[number]) => ({
        id: a.id,
        groupId: a.groupId,
        name: a.name,
        date: a.date,
        kind: a.kind,
        reminders: a.reminders ?? ["DAY_OF"],
        creator: memberOf(s, groupId, a.creatorId),
        createdAt: a.createdAt,
      });
      const KINDS = ["COUNT_UP", "YEARLY", "ONCE"] as const;
      // (#269) 알림 시점: API 와 같은 규칙 (배열, 셋 중, 중복 없음). 응답은 당일, 하루 전, 일주일 전 순
      const REMINDERS = ["DAY_OF", "DAY_BEFORE", "WEEK_BEFORE"] as const;
      type Reminder = (typeof REMINDERS)[number];
      const remindersOk = (v: unknown) =>
        v === undefined ||
        (Array.isArray(v) && v.every((r) => REMINDERS.includes(r as Reminder)) && new Set(v).size === v.length);
      const orderReminders = (v: unknown) => REMINDERS.filter((r) => (v as Reminder[]).includes(r));
      const validate = (name: unknown, date: unknown, partial: boolean, kind?: unknown, reminders?: unknown): MockResult | null => {
        if (kind !== undefined && !KINDS.includes(kind as (typeof KINDS)[number])) {
          return err(400, "VALIDATION_FAILED", `종류는 ${KINDS.join(", ")} 중 하나여야 해요`);
        }
        if (!remindersOk(reminders)) {
          return err(400, "VALIDATION_FAILED", `알림은 ${REMINDERS.join(", ")} 중에서 골라야 해요`);
        }
        if (!partial || name !== undefined) {
          const n = typeof name === "string" ? name.trim() : "";
          if (n.length < 1 || n.length > 30) return err(400, "VALIDATION_FAILED", "이름은 1~30자로 입력해 주세요");
        }
        if (!partial || date !== undefined) {
          if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return err(400, "VALIDATION_FAILED", "날짜를 확인해 주세요");
          }
        }
        return null;
      };
      if (rest.length === 1 && method === "GET") {
        return ok(
          s.anniversaries
            .filter((a) => a.groupId === groupId)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(out),
        );
      }
      if (rest.length === 1 && method === "POST") {
        const v = validate(body?.name, body?.date, false, body?.kind, body?.reminders);
        if (v) return v;
        const row = {
          id: nextId(),
          groupId,
          name: String(body!.name).trim(),
          date: String(body!.date),
          kind: (body?.kind ?? "COUNT_UP") as (typeof KINDS)[number],
          reminders: body?.reminders === undefined ? (["DAY_OF"] as Reminder[]) : orderReminders(body.reminders),
          creatorId: userId,
          createdAt: nowIso(),
        };
        s.anniversaries.push(row);
        return ok(out(row), 201);
      }
      const anniversaryId = parseId(rest[1]);
      if (anniversaryId === null) return err(400, "VALIDATION_FAILED", "anniversaryId 은(는) 양의 정수여야 해요");
      const a = s.anniversaries.find((x) => x.id === anniversaryId && x.groupId === groupId);
      if (!a) return err(404, "NOT_FOUND", "기념일을 찾을 수 없어요");
      if (method === "PATCH") {
        const v = validate(body?.name, body?.date, true, body?.kind, body?.reminders);
        if (v) return v;
        if (body?.name !== undefined) a.name = String(body.name).trim();
        if (body?.date !== undefined) a.date = String(body.date);
        if (body?.kind !== undefined) a.kind = body.kind as (typeof KINDS)[number];
        if (body?.reminders !== undefined) a.reminders = orderReminders(body.reminders);
        return ok(out(a));
      }
      if (method === "DELETE") {
        s.anniversaries = s.anniversaries.filter((x) => x.id !== a.id);
        return ok({ ok: true });
      }
    }

    if (rest[0] === "todo-lists" || rest[0] === "todo-items") {
      const r = todoRoutes(s, groupId, userId, rest, method, query, body);
      if (r) return r;
    }

    if (rest[0] === "free-slots" && method === "GET") return freeSlots(s, groupId, query);

    if (rest[0] === "news") {
      if (rest.length === 1 && method === "GET") {
        const seen = ms.lastSeenAt ?? "";
        const cutoff = new Date(Date.now() - 30 * DAY_MS).toISOString();
        const items = s.logs
          .filter((l) => l.groupId === groupId && l.actorId !== userId && l.createdAt >= cutoff)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 50)
          .map((l) => ({
            id: l.id,
            action: l.action,
            eventId: l.eventId,
            eventCode: l.eventId !== null && s.events.some((e) => e.id === l.eventId) ? mockEventCode(l.eventId) : null,
            title: l.title,
            startsAt: l.startsAt,
            endsAt: l.endsAt,
            allDay: l.allDay,
            repeat: l.repeat,
            scope: l.scope,
            occurrence: l.occurrence,
            actor: memberOf(s, groupId, l.actorId),
            createdAt: l.createdAt,
            isNew: l.createdAt > seen,
          }));
        if (query.get("v") !== "2") return ok({ items, lastSeenAt: ms.lastSeenAt });
        // (#191) v=2: 팀 활동 기록을 섞는다. 시각 내림차순, 같은 시각은 일정 먼저, 50건
        const activities = (s.activities ?? [])
          .filter((a) => a.groupId === groupId && a.actorId !== userId && a.createdAt >= cutoff)
          .map((a) => {
            const member = a.actorId === null ? null : s.memberships.find((m) => m.groupId === groupId && m.userId === a.actorId);
            const actor = member
              ? memberOf(s, groupId, a.actorId)
              : a.actorId === null && a.type !== "MEMBER_DELETED"
                ? memberOf(s, groupId, null)
                : { userId: a.actorId, displayName: a.actorName, color: "#9CA3AF", profileImageUrl: null };
            return {
              kind: "ACTIVITY" as const,
              id: a.id,
              type: a.type,
              actor,
              anniversaryId: a.anniversaryId,
              payload: a.payload,
              createdAt: a.createdAt,
              isNew: a.createdAt > seen,
            };
          });
        const merged = [...items.map((i) => ({ kind: "EVENT" as const, ...i })), ...activities]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (a.kind === b.kind ? 0 : a.kind === "EVENT" ? -1 : 1))
          .slice(0, 50);
        return ok({ items: merged, lastSeenAt: ms.lastSeenAt });
      }
      if (rest[1] === "seen" && method === "POST") {
        ms.lastSeenAt = nowIso();
        return ok({ lastSeenAt: ms.lastSeenAt });
      }
    }
  }

  return err(404, "NOT_FOUND", "요청한 주소가 없어요");
}

/** 목 토큰에서 사용자 추출. 'mock.<userId>.sig' 형태(userId 는 숫자), 'mock.me.sig' 는 기본 사용자 */
export function mockUserFromToken(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  return parts[1] === "me" ? ME_ID : parseId(parts[1]);
}
