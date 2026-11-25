// (#536) 신고하기, 관리자 신고 탭, (#537) 관리자 대시보드 목 라우트 (api.md 2.18, 2.19). 관리자 확인은 noticeAuthedRoute 가 먼저 한다
import { parseId } from "@/lib/id";
import type { ReportRow, Store } from "../fixtures";
import { closeMockReports, eventDetail, groupDetail, groupOut } from "./admin-moderation";
import { adminUserOut } from "./notices";
import { DAY_MS, err, nextId, nowIso, ok, type AuthedReq, type MockResult } from "./shared";

const TARGET_TYPES = ["group", "event", "user"] as const;
const REASONS = ["spam", "abuse", "illegal", "privacy", "other"] as const;
const STATUSES = ["open", "resolved", "dismissed"] as const;
/** 사용자당 하루 10번 (API 는 요청 제한 report 묶음, 목은 최근 24시간 신고 수로 센다) */
export const MOCK_REPORT_DAILY_LIMIT = 10;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

function shares(s: Store, a: number, b: number): boolean {
  const mine = new Set(s.memberships.filter((m) => m.userId === a).map((m) => m.groupId));
  return s.memberships.some((m) => m.userId === b && mine.has(m.groupId));
}

/** 신고할 수 있는지. 안 되면 오류 결과 */
function checkTarget(s: Store, userId: number, type: ReportRow["targetType"], id: number): MockResult | null {
  const notFound = err(404, "NOT_FOUND", "신고할 대상을 찾을 수 없어요");
  if (type === "group") {
    const g = s.groups.find((x) => x.id === id);
    if (!g || !s.memberships.some((m) => m.groupId === id && m.userId === userId)) return notFound;
    return g.type === "PERSONAL" ? err(403, "FORBIDDEN", "내 개인 달력은 신고할 수 없어요") : null;
  }
  if (type === "event") {
    const e = s.events.find((x) => x.id === id);
    const g = e && s.groups.find((x) => x.id === e.groupId);
    if (!e || !g || e.hidden || g.hidden || !s.memberships.some((m) => m.groupId === e.groupId && m.userId === userId)) return notFound;
    return e.creatorId === userId ? err(403, "FORBIDDEN", "내가 만든 일정은 신고할 수 없어요") : null;
  }
  if (id === userId) return err(403, "FORBIDDEN", "나를 신고할 수는 없어요");
  return s.users.some((u) => u.id === id) && shares(s, userId, id) ? null : notFound;
}

function receipt(r: ReportRow, duplicate: boolean) {
  return { id: r.id, targetType: r.targetType, targetId: r.targetId, reason: r.reason, status: r.status, createdAt: r.createdAt, duplicate };
}

const keyOf = (r: Pick<ReportRow, "targetType" | "targetId">) => `${r.targetType}:${r.targetId}`;

function summary(s: Store, type: ReportRow["targetType"], id: number) {
  if (type === "group") {
    const g = s.groups.find((x) => x.id === id);
    return g ? { title: g.name, hidden: Boolean(g.hidden), group: null } : null;
  }
  if (type === "event") {
    const e = s.events.find((x) => x.id === id);
    const g = e && s.groups.find((x) => x.id === e.groupId);
    return e && g ? { title: e.title, hidden: Boolean(e.hidden), group: { id: g.id, name: g.name, type: g.type } } : null;
  }
  const u = s.users.find((x) => x.id === id);
  return u ? { title: u.nickname, hidden: false, group: null } : null;
}

function preview(s: Store, type: ReportRow["targetType"], id: number) {
  if (type === "group") {
    const g = s.groups.find((x) => x.id === id);
    return g ? { type, group: groupDetail(s, g) } : null;
  }
  if (type === "event") {
    const e = s.events.find((x) => x.id === id);
    return e ? { type, event: eventDetail(s, e) } : null;
  }
  const u = s.users.find((x) => x.id === id);
  if (!u) return null;
  const teams = s.memberships
    .filter((m) => m.userId === id)
    .map((m) => s.groups.find((g) => g.id === m.groupId)!)
    .filter((g) => g && g.type === "TEAM")
    .map((g) => groupOut(s, g));
  return { type, user: adminUserOut(s, u), teams };
}

function reportOut(s: Store, r: ReportRow) {
  const person = (id: number | null) => {
    const u = id === null ? undefined : s.users.find((x) => x.id === id);
    return u ? { id: u.id, nickname: u.nickname } : null;
  };
  return {
    id: r.id,
    reason: r.reason,
    detail: r.detail,
    status: r.status,
    createdAt: r.createdAt,
    reporter: person(r.reporterId),
    resolvedBy: person(r.resolvedById),
    resolvedAt: r.resolvedAt,
    resolution: r.resolution,
  };
}

function targetDetail(s: Store, type: ReportRow["targetType"], id: number): MockResult {
  const rows = (s.reports ?? []).filter((r) => r.targetType === type && r.targetId === id).sort((a, b) => b.id - a.id);
  if (rows.length === 0) return err(404, "NOT_FOUND", "신고를 찾을 수 없어요");
  return ok({ targetType: type, targetId: id, target: preview(s, type, id), openCount: rows.filter((r) => r.status === "open").length, reports: rows.slice(0, 100).map((r) => reportOut(s, r)) });
}

function listGroups(s: Store, query: URLSearchParams): MockResult {
  const status = query.get("status") || null;
  const type = query.get("targetType") || null;
  if (status && !isOneOf(STATUSES, status)) return err(400, "VALIDATION_FAILED", "status 는 open, resolved, dismissed 중 하나여야 해요");
  if (type && !isOneOf(TARGET_TYPES, type)) return err(400, "VALIDATION_FAILED", "targetType 는 group, event, user 중 하나여야 해요");
  const limit = Number(query.get("limit") ?? 20);
  const cursor = query.get("cursor") ? Number(query.get("cursor")) : null;
  const all = s.reports ?? [];
  const rows = all.filter((r) => (!status || r.status === status) && (!type || r.targetType === type));
  const groups = new Map<string, ReportRow[]>();
  for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  const items = [...groups.values()]
    .map((list) => {
      const latest = list.reduce((a, b) => (a.id > b.id ? a : b));
      const openCount = all.filter((r) => keyOf(r) === keyOf(latest) && r.status === "open").length;
      const reasonCount = new Map<string, number>();
      for (const r of list) reasonCount.set(r.reason, (reasonCount.get(r.reason) ?? 0) + 1);
      return {
        targetType: latest.targetType,
        targetId: latest.targetId,
        target: summary(s, latest.targetType, latest.targetId),
        count: list.length,
        openCount,
        reasons: [...reasonCount].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
        status: openCount > 0 ? "open" : latest.status,
        firstReportedAt: list.map((r) => r.createdAt).sort()[0],
        lastReportedAt: list.map((r) => r.createdAt).sort().at(-1)!,
        latestReportId: latest.id,
      };
    })
    .filter((g) => cursor === null || g.latestReportId < cursor)
    .sort((a, b) => b.latestReportId - a.latestReportId);
  const page = items.slice(0, limit);
  return ok({ items: page, nextCursor: items.length > limit ? page[page.length - 1].latestReportId : null });
}

export function reportsRoute(req: AuthedReq): MockResult | null {
  const { s, method, seg, query, body, userId } = req;

  if (seg[0] === "reports" && seg.length === 1 && method === "POST") {
    const { targetType, targetId, reason } = body ?? {};
    const detail = typeof body?.detail === "string" ? body.detail.trim() : body?.detail;
    if (!isOneOf(TARGET_TYPES, targetType)) return err(400, "VALIDATION_FAILED", "targetType 은 group, event, user 중 하나여야 해요");
    if (typeof targetId !== "number" || !Number.isInteger(targetId) || targetId < 1) return err(400, "VALIDATION_FAILED", "targetId 는 양의 정수여야 해요");
    if (!isOneOf(REASONS, reason)) return err(400, "VALIDATION_FAILED", "신고 사유를 골라 주세요");
    if (detail !== undefined && (typeof detail !== "string" || detail.length > 500)) return err(400, "VALIDATION_FAILED", "자세한 내용은 500자까지 적을 수 있어요");
    const reports = (s.reports ??= []);
    const since = Date.now() - DAY_MS;
    if (reports.filter((r) => r.reporterId === userId && Date.parse(r.createdAt) > since).length >= MOCK_REPORT_DAILY_LIMIT) {
      return err(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요");
    }
    const bad = checkTarget(s, userId, targetType, targetId);
    if (bad) return bad;
    const open = reports.find((r) => r.reporterId === userId && r.targetType === targetType && r.targetId === targetId && r.status === "open");
    if (open) return ok(receipt(open, true));
    const row: ReportRow = {
      id: nextId(),
      reporterId: userId,
      targetType,
      targetId,
      reason,
      detail: detail ? detail : null,
      status: "open",
      resolvedById: null,
      resolvedAt: null,
      resolution: null,
      createdAt: nowIso(),
    };
    reports.push(row);
    return ok(receipt(row, false), 201);
  }

  if (seg[0] !== "admin") return null;

  if (seg[1] === "stats" && seg.length === 2 && method === "GET") {
    const range = query.get("range") ?? "7";
    if (range !== "7" && range !== "30") return err(400, "VALIDATION_FAILED", "range 는 7 또는 30 이어야 해요");
    return ok(mockStats(s, Number(range) as 7 | 30));
  }

  if (seg[1] !== "reports") return null;
  if (seg.length === 2 && method === "GET") return listGroups(s, query);
  if (seg.length === 3 && seg[2] === "open-count" && method === "GET") {
    return ok({ openTargets: new Set((s.reports ?? []).filter((r) => r.status === "open").map(keyOf)).size });
  }
  if (seg.length === 5 && seg[2] === "targets" && method === "GET") {
    const id = parseId(seg[4]);
    if (!isOneOf(TARGET_TYPES, seg[3]) || id === null) return err(400, "VALIDATION_FAILED", "targetType 는 group, event, user 중 하나여야 해요");
    return targetDetail(s, seg[3], id);
  }
  if (seg.length === 4 && (seg[3] === "resolve" || seg[3] === "dismiss") && method === "POST") {
    const id = parseId(seg[2]);
    const row = id === null ? undefined : (s.reports ?? []).find((r) => r.id === id);
    if (!row) return err(404, "NOT_FOUND", "신고를 찾을 수 없어요");
    const note = typeof body?.resolution === "string" ? body.resolution.trim() : "";
    if (note.length > 200 || (seg[3] === "resolve" && note.length === 0)) return err(400, "VALIDATION_FAILED", "처리 내용을 1~200자로 적어 주세요");
    closeMockReports(s, userId, row.targetType, row.targetId, seg[3] === "resolve" ? "resolved" : "dismissed", note || null);
    return targetDetail(s, row.targetType, row.targetId);
  }
  return null;
}

/** 목 KST 날짜 */
const kstDay = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

/**
 * (#537) 목 대시보드. 합계와 쓰는 곳은 목 상태에서 세고, 날짜별 값은 목 상태(가입, 접속 기록, 오늘 볼까)에
 * 날짜로 정해지는 가짜 기록을 더한다(화면 확인용. 같은 날짜는 늘 같은 값)
 */
export function mockStats(s: Store, range: 7 | 30) {
  const now = Date.now();
  const days = Array.from({ length: range }, (_, i) => kstDay(now - (range - 1 - i) * DAY_MS));
  const fake = (day: string, salt: number, max: number) => {
    let h = salt;
    for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) % 9973;
    return h % (max + 1);
  };
  const usage = s.assistant?.usage ?? {};
  const rows = days.map((day) => {
    const signups = s.users.filter((u) => kstDay(Date.parse(u.createdAt)) === day).length + fake(day, 7, 6);
    const activeUsers = new Set((s.userClients ?? []).filter((c) => kstDay(Date.parse(c.lastSeenAt)) === day).map((c) => c.userId)).size + fake(day, 13, 18);
    const today = Object.values(usage).filter((u) => u.day === day);
    const assistantUsers = today.length + fake(day, 29, 5);
    const assistantMessages = today.reduce((n, u) => n + u.count, 0) + assistantUsers * (1 + fake(day, 3, 4));
    return { day, signups, activeUsers, assistantMessages, assistantUsers };
  });
  const sum = (pick: (d: (typeof rows)[number]) => number) => rows.reduce((n, d) => n + pick(d), 0);
  const clients = s.userClients ?? [];
  const devices = s.pushDevices ?? [];
  const has = (userId: number, platform: "ios" | "android" | "web") =>
    clients.some((c) => c.userId === userId && c.platform === platform) || (platform !== "web" && devices.some((d) => d.userId === userId && d.platform === platform.toUpperCase()));
  const none = (userId: number) => !clients.some((c) => c.userId === userId) && !devices.some((d) => d.userId === userId);
  const fromAt = Date.parse(`${days[0]}T00:00:00+09:00`);
  return {
    range,
    from: days[0],
    to: days[days.length - 1],
    generatedAt: nowIso(),
    days: rows,
    totals: {
      users: s.users.length,
      teams: s.groups.filter((g) => g.type === "TEAM").length,
      personalCalendars: s.groups.filter((g) => g.type === "PERSONAL").length,
      events: s.events.length,
      notices: (s.notices ?? []).filter((n) => n.publishedAt !== null).length,
      openReports: (s.reports ?? []).filter((r) => r.status === "open").length,
      activeUsers: new Set(clients.filter((c) => Date.parse(c.lastSeenAt) >= fromAt).map((c) => c.userId)).size,
      signupsInRange: sum((d) => d.signups),
      assistantMessagesInRange: sum((d) => d.assistantMessages),
    },
    platforms: {
      ios: s.users.filter((u) => has(u.id, "ios")).length,
      android: s.users.filter((u) => has(u.id, "android")).length,
      web: s.users.filter((u) => has(u.id, "web") || (none(u.id) && !u.lastAppLoginAt)).length,
      unknown: s.users.filter((u) => none(u.id) && Boolean(u.lastAppLoginAt)).length,
    },
  };
}
