import { mockEventCode, memberOf, type Store } from "../fixtures";
import { DAY_MS, nowIso, ok, type GroupReq, type MockResult } from "./shared";

export function unread(s: Store, groupId: number, userId: number) {
  const ms = s.memberships.find((m) => m.groupId === groupId && m.userId === userId);
  const seen = ms?.lastSeenAt ?? "";
  // (#191) 일정 기록 + 팀 활동 기록
  const byOthers = (r: { groupId: number; actorId: number | null; createdAt: string }) =>
    r.groupId === groupId && r.actorId !== userId && r.createdAt > seen;
  // (#189) 투표로 정한 일정 기록은 숨기므로 POLL_CLOSED 수만큼 뺀다 (D-236)
  const closed = (s.activities ?? []).filter((a) => a.type === "POLL_CLOSED" && byOthers(a)).length;
  return s.logs.filter(byOthers).length + (s.activities ?? []).filter(byOthers).length - closed;
}

export function newsRoutes(req: GroupReq): MockResult | null {
  const { s, method, query, userId, groupId, ms, rest } = req;
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
      // (#189) 투표로 정해 생긴 일정 기록은 POLL_CLOSED 한 줄로 보인다 (D-236)
      const hidden = new Set(activities.flatMap((a) => (a.type === "POLL_CLOSED" && typeof a.payload?.eventLogId === "number" ? [a.payload.eventLogId] : [])));
      const merged = [...items.filter((i) => !hidden.has(i.id)).map((i) => ({ kind: "EVENT" as const, ...i })), ...activities]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (a.kind === b.kind ? 0 : a.kind === "EVENT" ? -1 : 1))
        .slice(0, 50);
      return ok({ items: merged, lastSeenAt: ms.lastSeenAt });
    }
    if (rest[1] === "seen" && method === "POST") {
      ms.lastSeenAt = nowIso();
      return ok({ lastSeenAt: ms.lastSeenAt });
    }
  }
  return null;
}
