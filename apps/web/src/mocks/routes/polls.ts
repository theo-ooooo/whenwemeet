import { errorBody } from "@/lib/envelope";
import { parseId } from "@/lib/id";
import { memberOf, mockEventCode, mockGroupCode, mockPollCode, type EventRow, type PollRow, type Store } from "../fixtures";
import { applyParticipants, eventOut, isBusyForAny, participantsIn } from "./event-model";
import { DAY_MS, err, isResult, memberIdsOf, nextId, nowIso, ok, type AuthedReq, type GroupReq, type MockResult } from "./shared";

/* ---------- (#189) 약속 투표 (api.md 2.13, 설계 약속-투표.md) ---------- */

const POLL_OPEN_LIMIT = 10;
const pollErr = (field: string, message: string): MockResult => ({
  status: 400,
  body: errorBody(400, "VALIDATION_FAILED", message, [{ field, message }]),
});
const isKstMidnight = (iso: string) => (Date.parse(iso) + 9 * 3600_000) % DAY_MS === 0;
const pollExpired = (p: PollRow) => p.status === "OPEN" && p.deadline !== null && Date.parse(p.deadline) <= Date.now();
const optionPast = (o: { startsAt: string }) => Date.parse(o.startsAt) <= Date.now();

/** 대상 userId (가입순). 모두면 지금 멤버 전원 */
function pollTargets(s: Store, p: PollRow): number[] {
  const ids = memberIdsOf(s, p.groupId);
  return p.allMembers ? ids : ids.filter((id) => p.participantIds.includes(id));
}

function pollOut(s: Store, p: PollRow, userId: number) {
  const order = memberIdsOf(s, p.groupId);
  const voters = (ids: number[]) => order.filter((id) => ids.includes(id)).map((id) => memberOf(s, p.groupId, id));
  const eventAlive = p.eventId !== null && s.events.some((e) => e.id === p.eventId);
  return {
    id: p.id,
    publicCode: mockPollCode(p.id),
    groupId: p.groupId,
    groupCode: mockGroupCode(p.groupId),
    title: p.title,
    status: p.status,
    deadline: p.deadline,
    expired: pollExpired(p),
    creator: memberOf(s, p.groupId, p.creatorId),
    createdAt: p.createdAt,
    closedAt: p.closedAt,
    eventId: eventAlive ? p.eventId : null,
    eventCode: eventAlive ? mockEventCode(p.eventId as number) : null,
    decidedOptionId: p.decidedOptionId,
    participants: { all: p.allMembers, members: pollTargets(s, p).map((id) => memberOf(s, p.groupId, id)) },
    options: p.options.map((o) => ({ id: o.id, startsAt: o.startsAt, endsAt: o.endsAt, allDay: o.allDay, past: optionPast(o), voters: voters(o.voterIds) })),
    myVotes: p.options.filter((o) => o.voterIds.includes(userId)).map((o) => o.id),
    canVote: p.allMembers || p.participantIds.includes(userId),
  };
}

function pollSummaryOut(s: Store, p: PollRow, userId: number) {
  const targets = new Set(pollTargets(s, p));
  const voters = new Set(p.options.flatMap((o) => o.voterIds).filter((id) => targets.has(id)));
  const out = pollOut(s, p, userId);
  return {
    id: p.id,
    publicCode: out.publicCode,
    title: p.title,
    status: p.status,
    deadline: p.deadline,
    expired: out.expired,
    eventId: out.eventId,
    eventCode: out.eventCode,
    voterCount: voters.size,
    targetCount: targets.size,
    votedByMe: out.myVotes.length > 0,
    allPast: p.options.every(optionPast),
    createdAt: p.createdAt,
    closedAt: p.closedAt,
  };
}

function pollRoutes(
  s: Store,
  groupId: number,
  userId: number,
  rest: string[],
  method: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
  log: (e: EventRow) => number,
): MockResult | null {
  const polls = (s.polls ??= []);
  const grp = s.groups.find((x) => x.id === groupId)!;
  const actorName = memberOf(s, groupId, userId).displayName;
  if (rest.length === 1 && method === "GET") {
    const status = query.get("status") ?? "open";
    if (status !== "open" && status !== "closed") return pollErr("status", "status 는 open 또는 closed 여야 해요");
    const mine = polls.filter((p) => p.groupId === groupId);
    if (status === "closed") {
      const since = Date.now() - 30 * DAY_MS;
      return ok(
        mine
          .filter((p) => p.status === "CLOSED" && Date.parse(p.closedAt ?? "") >= since)
          .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
          .map((p) => pollSummaryOut(s, p, userId)),
      );
    }
    const due = (p: PollRow) => (p.deadline ? Date.parse(p.deadline) : Number.POSITIVE_INFINITY);
    const items = mine.filter((p) => p.status === "OPEN").map((p) => pollSummaryOut(s, p, userId));
    items.sort(
      (a, b) =>
        Number(a.allPast) - Number(b.allPast) ||
        due(polls.find((p) => p.id === a.id)!) - due(polls.find((p) => p.id === b.id)!) ||
        b.createdAt.localeCompare(a.createdAt),
    );
    return ok(items);
  }
  if (rest.length === 1 && method === "POST") {
    if (grp.type === "PERSONAL") return pollErr("groupId", "혼자 쓰는 달력에서는 투표를 열 수 없어요");
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (title.length < 1 || Array.from(title).length > 50) return pollErr("title", "제목은 1~50자여야 해요");
    const raw = Array.isArray(body?.options) ? (body.options as { startsAt?: unknown; endsAt?: unknown; allDay?: unknown }[]) : [];
    if (raw.length < 2 || raw.length > 5) return pollErr("options", "후보는 2~5개 골라 주세요");
    const seen = new Set<string>();
    for (const o of raw) {
      const st = Date.parse(String(o.startsAt));
      const en = Date.parse(String(o.endsAt));
      if (Number.isNaN(st) || Number.isNaN(en) || en <= st) return pollErr("options", "후보의 끝나는 시각은 시작보다 뒤여야 해요");
      if (en - st > 30 * DAY_MS) return pollErr("options", "후보는 최대 30일까지 잡을 수 있어요");
      if (o.allDay && !(isKstMidnight(String(o.startsAt)) && isKstMidnight(String(o.endsAt)))) return pollErr("options", "종일 후보는 하루 단위여야 해요");
      if (st <= Date.now()) return pollErr("options", "이미 지난 시간은 후보로 고를 수 없어요");
      const key = `${st}:${en}`;
      if (seen.has(key)) return pollErr("options", "같은 시간을 두 번 고를 수 없어요");
      seen.add(key);
    }
    const deadline = typeof body?.deadline === "string" ? new Date(body.deadline).toISOString() : null;
    if (deadline && Date.parse(deadline) <= Date.now()) return pollErr("deadline", "마감은 지금 이후로 골라 주세요");
    const pIn = participantsIn(s, groupId, body?.participants) ?? { all: true, ids: [] };
    if (isResult(pIn)) return pIn;
    if (polls.filter((p) => p.groupId === groupId && p.status === "OPEN").length >= POLL_OPEN_LIMIT) return pollErr("groupId", "진행 중인 투표가 너무 많아요");
    const row: PollRow = {
      id: nextId(),
      groupId,
      title,
      status: "OPEN",
      deadline,
      allMembers: pIn.all,
      participantIds: pIn.all ? [] : pIn.ids,
      creatorId: userId,
      eventId: null,
      decidedOptionId: null,
      createdAt: nowIso(),
      closedAt: null,
      options: raw
        .map((o) => ({
          id: nextId(),
          startsAt: new Date(String(o.startsAt)).toISOString(),
          endsAt: new Date(String(o.endsAt)).toISOString(),
          allDay: Boolean(o.allDay),
          voterIds: [] as number[],
        }))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    };
    polls.push(row);
    (s.activities ??= []).push({
      id: nextId(),
      groupId,
      type: "POLL_CREATED",
      actorId: userId,
      actorName,
      anniversaryId: null,
      payload: { pollId: row.id, code: mockPollCode(row.id), title },
      createdAt: nowIso(),
    });
    return ok(pollOut(s, row, userId), 201);
  }
  const pollId = parseId(rest[1]);
  if (pollId === null) return err(400, "VALIDATION_FAILED", "pollId 은(는) 양의 정수여야 해요");
  const p = polls.find((x) => x.id === pollId && x.groupId === groupId);
  if (!p) return err(404, "NOT_FOUND", "투표를 찾을 수 없어요");
  if (rest[2] === "votes" && method === "PUT") {
    if (p.status === "CLOSED") return err(409, "POLL_CLOSED", "이미 정해진 투표예요");
    if (pollExpired(p)) return err(409, "POLL_CLOSED", "투표가 끝났어요");
    if (!(p.allMembers || p.participantIds.includes(userId))) return err(403, "NOT_PARTICIPANT", "이 투표의 대상이 아니에요");
    const ids = Array.isArray(body?.optionIds) ? (body.optionIds as unknown[]) : null;
    if (!ids || ids.some((id) => typeof id !== "number" || !p.options.some((o) => o.id === id))) return pollErr("optionIds", "이 투표의 후보가 아니에요");
    for (const o of p.options) {
      const want = ids.includes(o.id);
      const have = o.voterIds.includes(userId);
      if (optionPast(o)) {
        if (want && !have) return err(400, "POLL_OPTION_PAST", "이미 지난 시간이에요");
        continue;
      }
      if (want && !have) o.voterIds.push(userId);
      if (!want && have) o.voterIds = o.voterIds.filter((id) => id !== userId);
    }
    return ok(pollOut(s, p, userId));
  }
  if (rest[2] === "confirm" && method === "POST") {
    if (p.status === "CLOSED") return err(409, "POLL_CLOSED", "이미 정해진 투표예요");
    const o = p.options.find((x) => x.id === body?.optionId);
    if (!o) return pollErr("optionId", "이 투표의 후보가 아니에요");
    if (optionPast(o)) return err(400, "POLL_OPTION_PAST", "이미 지난 시간이에요");
    const targets = new Set(pollTargets(s, p));
    // 빈 시간과 같은 규칙(종일 일정 제외)으로 지금도 비는지 본다. 목은 이 팀 일정만 본다
    const busy =
      !o.allDay &&
      s.events.some(
        (e) =>
          !e.repeat &&
          !e.allDay &&
          e.groupId === groupId &&
          isBusyForAny(e, targets) &&
          Date.parse(e.startsAt) < Date.parse(o.endsAt) &&
          Date.parse(e.endsAt) > Date.parse(o.startsAt),
      );
    const event: EventRow = {
      id: nextId(),
      groupId,
      title: p.title,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      allDay: o.allDay,
      memo: null,
      creatorId: userId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      repeat: null,
      repeatUntil: null,
      exceptions: [],
      reminder: "NONE",
      color: null,
    };
    applyParticipants(event, { all: p.allMembers, ids: p.allMembers ? [] : [...targets] });
    s.events.push(event);
    const logId = log(event);
    p.status = "CLOSED";
    p.closedAt = nowIso();
    p.eventId = event.id;
    p.decidedOptionId = o.id;
    (s.activities ??= []).push({
      id: nextId(),
      groupId,
      type: "POLL_CLOSED",
      actorId: userId,
      actorName,
      anniversaryId: null,
      payload: {
        pollId: p.id,
        code: mockPollCode(p.id),
        title: p.title,
        eventId: event.id,
        eventCode: mockEventCode(event.id),
        eventLogId: logId,
        startsAt: o.startsAt,
        endsAt: o.endsAt,
        allDay: o.allDay,
      },
      createdAt: nowIso(),
    });
    return ok({ poll: pollOut(s, p, userId), event: eventOut(s, event), warning: busy ? "BUSY_NOW" : null }, 201);
  }
  if (rest.length === 2 && method === "DELETE") {
    if (p.status === "CLOSED") return err(409, "POLL_CLOSED", "이미 정해진 투표예요");
    s.polls = polls.filter((x) => x.id !== p.id);
    s.activities = (s.activities ?? []).filter((a) => !(a.type === "POLL_CREATED" && a.payload.pollId === p.id));
    return ok({ ok: true });
  }
  return null;
}

// (#189) 공개 코드로 투표 하나 GET /polls/:code. 내 팀 투표가 아니거나 없으면 404
export function pollCodeRoute(req: AuthedReq): MockResult | null {
  const { s, method, seg, userId } = req;
  if (seg[0] === "polls" && seg.length === 2 && method === "GET") {
    const code = seg[1].toLowerCase();
    const p = (s.polls ?? []).find((x) => mockPollCode(x.id) === code);
    if (!p || !s.memberships.some((m) => m.groupId === p.groupId && m.userId === userId)) return err(404, "NOT_FOUND", "투표를 찾을 수 없어요");
    return ok(pollOut(s, p, userId));
  }
  return null;
}

export function groupPollRoutes(req: GroupReq): MockResult | null {
  const { s, method, query, body, userId, groupId, rest } = req;
  if (rest[0] === "polls") {
    const pollLog = (e: EventRow) => {
      const id = nextId();
      s.logs.push({
        id,
        groupId,
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        allDay: e.allDay,
        actorId: userId,
        createdAt: nowIso(),
        action: "CREATED",
        eventId: e.id,
        repeat: null,
        scope: null,
        occurrence: null,
      });
      return id;
    };
    const r = pollRoutes(s, groupId, userId, rest, method, query, body, pollLog);
    if (r) return r;
  }
  return null;
}
