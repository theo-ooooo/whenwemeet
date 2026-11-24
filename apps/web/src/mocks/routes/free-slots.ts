import { addDays, dateKeyOf, kstToIso } from "@/lib/date";
import { ceilToStep } from "@/lib/free-time";
import type { Store } from "../fixtures";
import { expand } from "../recurrence";
import { isBusyForAny, type RepeatRow } from "./event-model";
import { DAY_MS, err, ok, type GroupReq, type MockResult } from "./shared";

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

export function freeSlotsRoute(req: GroupReq): MockResult | null {
  const { s, method, query, groupId, rest } = req;
  if (rest[0] === "free-slots" && method === "GET") return freeSlots(s, groupId, query);
  return null;
}
