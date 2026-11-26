// 일정 라우트: 검색, 공개 코드 조회, 목록과 만들기, 단건 조회와 수정과 삭제, 반복 회차, 참석 여부와 반응, 삭제 되돌리기 (#491)
import { addDays, dateKeyOf } from "@/lib/date";
import { parseId } from "@/lib/id";
import { mockEventCode, mockGroupCode, type EventLogRow, type EventRow, type Store } from "../fixtures";
import { expand, originalOccurrence, type MockPlace } from "../recurrence";
import { CLEARED, contains, placeOut, samePlace } from "../places";
import {
  applyInput,
  applyParticipants,
  colorErr,
  colorIn,
  lunarIn,
  eventOut,
  mergedReminder,
  occurrenceOf,
  participantErr,
  participantsIn,
  placeIn,
  rangeCheck,
  reminderFit,
  reminderIn,
  repeatCheck,
  repeatOf,
  responseRoute,
  validateEvent,
  withResponseMembers,
  withResponses,
  type EventOut,
  type RepeatRow,
} from "./event-model";
import { DAY_MS, err, isResult, nextId, nowIso, ok, type AuthedReq, type GroupReq, type MockResult } from "./shared";

/** (#199) 일정 검색 GET /events/search (api.md 2.3, D-245, D-246). API 와 같은 결: 반복은 원본 한 줄(다음 회차, 없으면 마지막) + 예외가 맞는 회차 */
function eventSearch(s: Store, userId: number, query: URLSearchParams): MockResult {
  const q = (query.get("q") ?? "").trim();
  if (!q || Array.from(q).length > 50) return err(400, "VALIDATION_FAILED", "검색어는 1~50자여야 해요");
  const groupRaw = query.get("groupId");
  const mine = s.memberships.filter((m) => m.userId === userId).map((m) => m.groupId);
  const groupIds = groupRaw ? mine.filter((id) => String(id) === groupRaw) : mine;
  if (groupRaw && groupIds.length === 0) return err(403, "FORBIDDEN", "이 팀의 멤버가 아니에요");
  const limit = Math.min(50, Math.max(1, Number(query.get("limit") ?? 30) || 30));
  const now = Date.now();
  const fields = (v: { title: string; memo?: string | null; place?: MockPlace | null }) => {
    const out: ("title" | "memo" | "place")[] = [];
    if (contains(v.title, q)) out.push("title");
    if (contains(v.memo, q)) out.push("memo");
    if (v.place && (contains(v.place.text, q) || contains(v.place.query, q))) out.push("place");
    return out;
  };
  const items: { event: EventOut; matched: ("title" | "memo" | "place")[] }[] = [];
  // (#515) 숨긴 일정은 검색에서 뺀다
  for (const e of s.events.filter((x) => groupIds.includes(x.groupId) && !x.hidden)) {
    if (!e.repeat) {
      const matched = fields(e);
      if (matched.length) items.push({ event: eventOut(s, e), matched });
      continue;
    }
    const series = e as RepeatRow;
    const hits = new Set<string>();
    for (const x of series.exceptions) {
      if (x.cancelled || !fields({ title: x.title ?? "", memo: x.memo, place: x.place }).length) continue;
      const o = occurrenceOf(series, x.occurrence);
      if (!o) continue;
      hits.add(x.occurrence);
      const out = eventOut(s, series, o);
      items.push({ event: out, matched: fields({ title: out.title, memo: out.memo, place: o.place ?? series.place }) });
    }
    if (!fields(series).length) continue;
    const from = Math.max(now, Date.parse(series.startsAt));
    const ahead = expand(series, series.exceptions, from, from + 400 * DAY_MS).find((o) => Date.parse(o.endsAt) > now && !hits.has(o.occurrence));
    const behind = ahead
      ? null
      : expand(series, series.exceptions, now - 400 * DAY_MS, now)
          .filter((o) => Date.parse(o.endsAt) <= now && !hits.has(o.occurrence))
          .pop();
    const pick = ahead ?? behind;
    if (pick) items.push({ event: eventOut(s, series, pick), matched: fields(series) });
  }
  const rows = items
    .map((it) => ({ ...it, upcoming: Date.parse(it.event.endsAt) > now }))
    .sort((a, b) => {
      if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
      const d = a.event.startsAt.localeCompare(b.event.startsAt);
      return (a.upcoming ? d : -d) || a.event.id - b.event.id || (a.event.occurrence ?? "").localeCompare(b.event.occurrence ?? "");
    });
  return ok({
    items: rows.slice(0, limit).map((r) => {
      const g = s.groups.find((x) => x.id === r.event.groupId)!;
      return { event: r.event, group: { id: g.id, name: g.name, publicCode: mockGroupCode(g.id) }, matched: r.matched, upcoming: r.upcoming };
    }),
    hasMore: rows.length > limit,
  });
}

/** (#199) 일정 검색 GET /events/search */
export function eventSearchRoute(req: AuthedReq): MockResult | null {
  const { s, method, seg, query, userId } = req;
  if (seg[0] === "events" && seg[1] === "search" && seg.length === 2 && method === "GET") return eventSearch(s, userId, query);
  return null;
}

// (#311) 공개 코드로 일정 하나 GET /events/:code?occurrence= (api.md 2.3). 내 팀 일정이 아니거나 없으면 모두 404.
// 찾은 뒤에는 단건 조회와 같은 응답이라 그 경로로 다시 처리한다
export function eventCodeRoute(req: AuthedReq): MockResult | null {
  const { s, method, seg, userId, ctx, handle } = req;
  if (seg[0] === "events" && seg.length === 2 && method === "GET") {
    const code = seg[1].toLowerCase();
    const e = s.events.find((x) => mockEventCode(x.id) === code);
    if (!e || e.hidden || !s.memberships.some((m) => m.groupId === e.groupId && m.userId === userId)) return err(404, "NOT_FOUND", "일정을 찾을 수 없어요");
    return handle({ ...ctx, path: `/groups/${e.groupId}/events/${e.id}` });
  }
  return null;
}

// (#375) 일정 삭제 되돌리기 POST /groups/:id/event-deletions/:deletionId/restore (D-251). 팀원 누구나, 7일 안
export function eventRestoreRoute(req: GroupReq): MockResult | null {
  const { s, method, groupId, rest } = req;
  if (rest[0] === "event-deletions" && rest.length === 3 && rest[2] === "restore" && method === "POST") {
    const deletionId = parseId(rest[1]);
    if (deletionId === null) return err(400, "VALIDATION_FAILED", "deletionId 은(는) 양의 정수여야 해요");
    const d = (s.deletions ?? []).find((x) => x.id === deletionId && x.groupId === groupId);
    if (!d || Date.now() - Date.parse(d.createdAt) > 7 * DAY_MS) return err(404, "NOT_FOUND", "되돌릴 수 있는 기간이 지났어요");
    s.events = [...s.events.filter((x) => x.id !== d.eventId), d.event];
    const same = (a: { eventId: number; occurrence: string; userId: number }, b: typeof a) =>
      a.eventId === b.eventId && a.occurrence === b.occurrence && a.userId === b.userId;
    const members = new Set(s.memberships.filter((m) => m.groupId === groupId).map((m) => m.userId));
    s.rsvps = [...(s.rsvps ?? []), ...d.rsvps.filter((r) => members.has(r.userId) && !(s.rsvps ?? []).some((x) => same(x, r)))];
    s.reactions = [...(s.reactions ?? []), ...d.reactions.filter((r) => members.has(r.userId) && !(s.reactions ?? []).some((x) => same(x, r)))];
    for (const l of s.logs) if (d.logIds.includes(l.id)) l.eventId = d.eventId;
    s.logs = s.logs.filter((l) => l.id !== d.logId);
    s.deletions = (s.deletions ?? []).filter((x) => x.id !== d.id);
    return ok({ ok: true, eventId: d.eventId, occurrence: null });
  }
  return null;
}

/** /groups/:groupId/events... 맞는 라우트가 없으면 null (다음 라우트로) */
export function groupEventRoutes(req: GroupReq): MockResult | null {
  const { s, method, query, body, userId, groupId, rest } = req;
  if (rest[0] === "events") {
    const log = (
      e: { title: string; startsAt: string; endsAt: string; allDay: boolean },
      extra: Pick<EventLogRow, "action" | "eventId" | "repeat" | "scope" | "occurrence">,
    ) => {
      const id = nextId();
      s.logs.push({ id, groupId, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, allDay: e.allDay, actorId: userId, createdAt: nowIso(), ...extra });
      return id;
    };
    // (#375) 지우기 직전 모습을 보관하고 삭제 응답의 deletionId 를 돌려준다 (D-251)
    const keep = (before: EventRow, logId: number) => {
      const id = nextId();
      (s.deletions ??= []).push({
        id,
        groupId,
        eventId: before.id,
        createdAt: nowIso(),
        logId,
        event: before,
        rsvps: (s.rsvps ?? []).filter((r) => r.eventId === before.id).map((r) => ({ ...r })),
        reactions: (s.reactions ?? []).filter((r) => r.eventId === before.id).map((r) => ({ ...r })),
        logIds: s.logs.filter((l) => l.eventId === before.id).map((l) => l.id),
      });
      return id;
    };

    if (rest.length === 1 && method === "GET") {
      const from = Date.parse(query.get("from") ?? "");
      const to = Date.parse(query.get("to") ?? "");
      if (Number.isNaN(from) || Number.isNaN(to)) {
        return err(400, "VALIDATION_FAILED", "조회 기간을 확인해 주세요");
      }
      if (to - from > 62 * DAY_MS) return err(400, "EVENT_RANGE_INVALID", "조회 기간은 62일 이내예요");
      // 반복 원본은 기간 안 회차로 펼친다 (#187)
      const list = s.events
        .filter((e) => e.groupId === groupId && !e.hidden)
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
      const plIn = placeIn((body ?? {}).place);
      if (isResult(plIn)) return plIn;
      const lIn = lunarIn((body ?? {}).lunarInput);
      if (isResult(lIn)) return lIn;
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
        lunarInput: lIn ?? false,
        place: plIn ?? null,
      };
      applyParticipants(row, pIn);
      s.events.push(row);
      log(row, { action: "CREATED", eventId: row.id, repeat, scope: null, occurrence: null });
      return ok(eventOut(s, row), 201);
    }
    const eventId = parseId(rest[1]);
    if (eventId === null) return err(400, "VALIDATION_FAILED", "eventId 은(는) 양의 정수여야 해요");
    const e = s.events.find((x) => x.id === eventId && x.groupId === groupId && !x.hidden);
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
        const plIn = placeIn((body ?? {}).place);
        if (isResult(plIn)) return plIn;
        const lIn = lunarIn((body ?? {}).lunarInput);
        if (isResult(lIn)) return lIn;
        // (#343) 색 말고 바뀐 값이 있는지 (색만 바꾸면 새 소식 없음, D-215). (#566) 음력 입력 표시도 같다
        const before = JSON.stringify(eventOut(s, { ...e, color: null, lunarInput: false }));
        applyInput(e, input);
        if (plIn !== undefined) e.place = plIn;
        if (pIn) applyParticipants(e, pIn);
        e.reminder = reminder;
        // 반복을 켜면 이 일정이 첫 회차 (기획 3-4)
        if (repeat) {
          e.repeat = repeat;
          e.repeatUntil = until;
        }
        if (cIn !== undefined) e.color = cIn;
        if (lIn !== undefined) e.lunarInput = lIn;
        e.updatedAt = nowIso();
        if (JSON.stringify(eventOut(s, { ...e, color: null, lunarInput: false, updatedAt: JSON.parse(before).updatedAt })) !== before) {
          log(e, { action: "UPDATED", eventId: e.id, repeat: e.repeat, scope: null, occurrence: null });
        }
        return ok(eventOut(s, e));
      }
      if (method === "DELETE") {
        const before = structuredClone(e);
        s.events = s.events.filter((x) => x.id !== e.id);
        s.rsvps = (s.rsvps ?? []).filter((r) => r.eventId !== e.id);
        s.reactions = (s.reactions ?? []).filter((r) => r.eventId !== e.id);
        const deletionId = keep(before, log(e, { action: "DELETED", eventId: null, repeat: null, scope: null, occurrence: null }));
        for (const l of s.logs) if (l.eventId === e.id) l.eventId = null;
        return ok({ ok: true, deletionId });
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
      const plIn = placeIn((body ?? {}).place);
      if (isResult(plIn)) return plIn;
      // (#199) 기준 장소: "이 일정만" 은 그 회차 값(예외 반영), "이후 모두" 는 원본
      const basePlace: MockPlace | null =
        scope === "this" ? (current.place ? (placeOut(current.place) ? current.place : null) : (series.place ?? null)) : (series.place ?? null);
      const nextPlace = plIn !== undefined ? plIn : basePlace;
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
        // (#566) 음력 입력 표시도 원본 단위 (D-298)
        if (body && "lunarInput" in body) return err(400, "VALIDATION_FAILED", "반복 일정의 음력 입력은 이후 모두로만 바꿀 수 있어요");
        // 예외는 바꾼 최종 값을 통째로 저장 (목은 "원래 값과 다른 필드만" 을 생략한다)
        series.exceptions = series.exceptions.filter((x) => x.occurrence !== date);
        // 원래 회차 값(원본 알림)과 같으면 null (4-1)
        const xReminder = reminder === (series.reminder ?? "NONE") ? null : reminder;
        // (#199) 원본과 같은 장소면 null, 지우면 이름 '' (이 회차만 없음)
        const xPlace = samePlace(nextPlace, series.place) ? null : (nextPlace ?? CLEARED);
        series.exceptions.push({ occurrence: date, cancelled: false, ...next, reminder: xReminder, place: xPlace });
        series.updatedAt = nowIso();
        log(next, { action: "UPDATED", eventId: series.id, repeat: series.repeat, scope: logScope, occurrence: date });
        return ok(eventOut(s, series, { occurrence: date, ...next, reminder, ...(xPlace ? { place: xPlace } : {}) }));
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
      const lIn = lunarIn((body ?? {}).lunarInput);
      if (isResult(lIn)) return lIn;
      const lunarInput = lIn ?? series.lunarInput ?? false;
      // (#343) 색 말고 바뀐 값이 없으면 새 소식을 남기지 않는다 (API 와 같은 기준: 규칙, 참여자, 회차 값이 같고 그날부터 예외 없음)
      const sameMembers =
        !pIn ||
        (pIn.all ? series.allMembers !== false : series.allMembers === false && JSON.stringify(pIn.ids) === JSON.stringify(series.participantIds ?? []));
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
        samePlace(nextPlace, series.place) &&
        reminder === (series.reminder ?? "NONE");
      // 반복 기준 날짜 (API followingAnchor, D-71): 주기 그대로인 매월/매년이고 날짜를 안 바꿨으면 잇는다. 첫 회차는 원본 값 그대로
      const keepsAnchor = repeat === series.repeat && startKey === date && (repeat === "MONTHLY" || repeat === "YEARLY" || repeat === "YEARLY_LUNAR");
      const repeatAnchor = keepsAnchor ? (date === first ? (series.repeatAnchor ?? null) : (series.repeatAnchor ?? first)) : null;
      const fields = {
        ...next,
        memo: next.memo || null,
        repeat,
        repeatUntil: repeat ? until : null,
        repeatAnchor,
        reminder,
        color,
        lunarInput,
        place: nextPlace,
        updatedAt: nowIso(),
      };
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
      const before = structuredClone(series) as EventRow;
      let logId: number;
      const dropResponses = (match: (occurrence: string) => boolean) => {
        s.rsvps = (s.rsvps ?? []).filter((r) => !(r.eventId === series.id && match(r.occurrence)));
        s.reactions = (s.reactions ?? []).filter((r) => !(r.eventId === series.id && match(r.occurrence)));
      };
      if (scope === "this") {
        series.exceptions = series.exceptions.filter((x) => x.occurrence !== date);
        series.exceptions.push({ occurrence: date, cancelled: true });
        logId = log(snap, { action: "DELETED", eventId: series.id, repeat: series.repeat, scope: logScope, occurrence: date });
        dropResponses((o) => o === date);
      } else if (date === first) {
        s.events = s.events.filter((x) => x.id !== series.id);
        logId = log(snap, { action: "DELETED", eventId: null, repeat: series.repeat, scope: logScope, occurrence: date });
        dropResponses(() => true);
      } else {
        series.repeatUntil = addDays(date, -1);
        series.exceptions = series.exceptions.filter((x) => x.occurrence < date);
        logId = log(snap, { action: "DELETED", eventId: series.id, repeat: series.repeat, scope: logScope, occurrence: date });
        dropResponses((o) => o >= date);
      }
      const deletionId = keep(before, logId);
      if (date === first && scope !== "this") for (const l of s.logs) if (l.eventId === series.id) l.eventId = null;
      return ok({ ok: true, deletionId });
    }
  }
  return null;
}
