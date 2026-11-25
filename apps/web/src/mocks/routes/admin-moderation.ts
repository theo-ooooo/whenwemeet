// (#515) 관리자 팀, 일정 숨김과 삭제, 사용자 상세 목 라우트 (api.md 2.16, D-286). 관리자 확인은 noticeAuthedRoute 가 먼저 한다
import { parseId } from "@/lib/id";
import type { EventRow, GroupRow, Store } from "../fixtures";
import { logAdmin } from "./notices";
import { err, nowIso, ok, type AuthedReq, type MockResult } from "./shared";

function hiddenOut(s: Store, h: GroupRow["hidden"]) {
  if (!h) return null;
  const by = s.users.find((u) => u.id === h.hiddenById);
  return { reason: h.reason, hiddenAt: h.hiddenAt, hiddenBy: by ? { id: by.id, nickname: by.nickname } : null };
}

function groupOut(s: Store, g: GroupRow) {
  return {
    id: g.id,
    name: g.name,
    type: g.type,
    memberCount: s.memberships.filter((m) => m.groupId === g.id).length,
    eventCount: s.events.filter((e) => e.groupId === g.id).length,
    createdAt: g.createdAt,
    hidden: hiddenOut(s, g.hidden),
  };
}

function eventOut(s: Store, e: EventRow) {
  const g = s.groups.find((x) => x.id === e.groupId)!;
  const creator = s.users.find((u) => u.id === e.creatorId);
  return {
    id: e.id,
    title: e.title,
    group: { id: g.id, name: g.name, hidden: Boolean(g.hidden) },
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    allDay: e.allDay,
    repeat: e.repeat,
    creator: creator ? { id: creator.id, nickname: creator.nickname } : null,
    createdAt: e.createdAt,
    hidden: hiddenOut(s, e.hidden),
  };
}

function groupDetail(s: Store, g: GroupRow) {
  return {
    ...groupOut(s, g),
    members: s.memberships
      .filter((m) => m.groupId === g.id)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
      .map((m) => ({ userId: m.userId, nickname: s.users.find((u) => u.id === m.userId)?.nickname ?? "", displayName: m.displayName, joinedAt: m.joinedAt })),
    recentEvents: s.events
      .filter((e) => e.groupId === g.id)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .slice(0, 20)
      .map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt, allDay: e.allDay, repeat: e.repeat, hidden: Boolean(e.hidden) })),
  };
}

function eventDetail(s: Store, e: EventRow) {
  return { ...eventOut(s, e), memo: e.memo, place: e.place?.text ?? e.place?.query ?? null };
}

/** 정렬된 rows 를 limit, cursor 로 자른다 (id 내림차순 가정) */
function paged<T extends { id: number }>(rows: T[], query: URLSearchParams): MockResult {
  const limit = Number(query.get("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return err(400, "VALIDATION_FAILED", "limit 는 1~50 사이여야 해요");
  const cursor = query.get("cursor");
  const list = cursor ? rows.filter((r) => r.id < Number(cursor)) : rows;
  const items = list.slice(0, limit);
  return ok({ items, nextCursor: list.length > limit ? items[items.length - 1].id : null });
}

function readReason(body: Record<string, unknown> | null): string | null {
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  return reason.length >= 1 && reason.length <= 200 ? reason : null;
}

export function adminModerationRoute(req: AuthedReq): MockResult | null {
  const { s, method, seg, query, body, userId } = req;
  if (seg[0] !== "admin") return null;

  if (seg[1] === "users" && seg.length === 3 && method === "GET") {
    const id = parseId(seg[2]);
    const u = id === null ? undefined : s.users.find((x) => x.id === id);
    if (!u) return err(404, "NOT_FOUND", "사용자를 찾을 수 없어요");
    const teams = s.memberships.filter((m) => m.userId === u.id).map((m) => groupOut(s, s.groups.find((g) => g.id === m.groupId)!));
    return ok({ user: { id: u.id, nickname: u.nickname, role: u.role ?? "user", createdAt: u.createdAt, providers: u.providers ?? ["KAKAO"] }, teams });
  }

  if (seg[1] === "groups") {
    if (seg.length === 2 && method === "GET") {
      const q = (query.get("q") ?? "").trim();
      return paged(s.groups.filter((g) => !q || g.name.includes(q)).sort((a, b) => b.id - a.id).map((g) => groupOut(s, g)), query);
    }
    const id = parseId(seg[2]);
    const g = id === null ? undefined : s.groups.find((x) => x.id === id);
    if (!g) return err(404, "NOT_FOUND", "팀을 찾을 수 없어요");
    if (seg.length === 3 && method === "GET") return ok(groupDetail(s, g));
    if (seg.length === 4 && seg[3] === "hide" && method === "POST") {
      const reason = readReason(body);
      if (!reason) return err(400, "VALIDATION_FAILED", "숨기는 이유를 1~200자로 적어 주세요");
      g.hidden = { reason, hiddenAt: nowIso(), hiddenById: userId };
      logAdmin(s, userId, "group_hide", "group", g.id, reason);
      return ok(groupDetail(s, g));
    }
    if (seg.length === 4 && seg[3] === "unhide" && method === "POST") {
      g.hidden = null;
      logAdmin(s, userId, "group_unhide", "group", g.id);
      return ok(groupDetail(s, g));
    }
    if (seg.length === 3 && method === "DELETE") {
      s.groups = s.groups.filter((x) => x.id !== g.id);
      s.memberships = s.memberships.filter((m) => m.groupId !== g.id);
      s.events = s.events.filter((e) => e.groupId !== g.id);
      logAdmin(s, userId, "group_delete", "group", g.id, g.name);
      return ok({ ok: true });
    }
  }

  if (seg[1] === "events") {
    if (seg.length === 2 && method === "GET") {
      const q = (query.get("q") ?? "").trim();
      const groupId = query.get("groupId") ? parseId(query.get("groupId")) : null;
      if (query.get("groupId") && groupId === null) return err(400, "VALIDATION_FAILED", "groupId 는 양의 정수여야 해요");
      const rows = s.events
        .filter((e) => (!q || e.title.includes(q)) && (groupId === null || e.groupId === groupId))
        .sort((a, b) => b.id - a.id)
        .map((e) => eventOut(s, e));
      return paged(rows, query);
    }
    const id = parseId(seg[2]);
    const e = id === null ? undefined : s.events.find((x) => x.id === id);
    if (!e) return err(404, "NOT_FOUND", "일정을 찾을 수 없어요");
    if (seg.length === 3 && method === "GET") return ok(eventDetail(s, e));
    if (seg.length === 4 && seg[3] === "hide" && method === "POST") {
      const reason = readReason(body);
      if (!reason) return err(400, "VALIDATION_FAILED", "숨기는 이유를 1~200자로 적어 주세요");
      e.hidden = { reason, hiddenAt: nowIso(), hiddenById: userId };
      logAdmin(s, userId, "event_hide", "event", e.id, reason);
      return ok(eventDetail(s, e));
    }
    if (seg.length === 4 && seg[3] === "unhide" && method === "POST") {
      e.hidden = null;
      logAdmin(s, userId, "event_unhide", "event", e.id);
      return ok(eventDetail(s, e));
    }
    if (seg.length === 3 && method === "DELETE") {
      s.events = s.events.filter((x) => x.id !== e.id);
      logAdmin(s, userId, "event_delete", "event", e.id, e.title);
      return ok({ ok: true });
    }
  }
  return null;
}
