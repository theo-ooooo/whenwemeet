// (#193) 외부 캘린더 구독 주소 라우트 (#491)
import type { CalendarFeedRow, Store } from "../fixtures";
import { err, nowIso, ok, type GroupReq, type MockResult } from "./shared";

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

export function groupCalendarFeedRoute(req: GroupReq): MockResult | null {
  const { s, method, body, userId, groupId, rest } = req;
  // (#193) 외부 캘린더 구독 주소 (api.md 2.12). 목은 피드 본문을 내지 않는다 (주소만)
  if (rest[0] === "calendar-feed") return calendarFeedRoute(s, method, rest.slice(1), body, groupId, userId);
  return null;
}
