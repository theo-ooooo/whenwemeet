// (#515) 공지사항과 관리자 화면 목 라우트 (api.md 2.16, D-285, D-286)
import { parseId } from "@/lib/id";
import type { AdminLogRow, NoticeRow, Store } from "../fixtures";
import { err, nextId, nowIso, ok, type AuthedReq, type MockResult, type Req } from "./shared";

const KINDS = ["notice", "update", "maintenance"];
const notFound = () => err(404, "NOT_FOUND", "공지를 찾을 수 없어요");
const forbidden = () => err(403, "FORBIDDEN", "관리자만 할 수 있어요");

function isAdmin(s: Store, userId: number | null): boolean {
  return userId !== null && s.users.find((u) => u.id === userId)?.role === "admin";
}

/** limit(기본 20, 1~50), cursor 로 자르기. rows 는 이미 정렬된 목록 */
function page<T extends { id: number }>(rows: T[], query: URLSearchParams): MockResult | { items: T[]; nextCursor: number | null } {
  const limitRaw = query.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return err(400, "VALIDATION_FAILED", "limit 는 1~50 사이여야 해요");
  const cursorRaw = query.get("cursor");
  const start = cursorRaw ? rows.findIndex((r) => r.id === Number(cursorRaw)) + 1 : 0;
  const items = rows.slice(start, start + limit);
  return { items, nextCursor: start + limit < rows.length ? items[items.length - 1].id : null };
}

const isPage = (v: unknown): v is { items: unknown[]; nextCursor: number | null } => typeof v === "object" && v !== null && "items" in v;

export function logAdmin(s: Store, adminId: number, action: string, targetType: AdminLogRow["targetType"], targetId: number, reason: string | null = null) {
  (s.adminLogs ??= []).push({ id: nextId(), adminId, action, targetType, targetId, reason, createdAt: nowIso() });
}

/** 공개(선택 인증): GET /notices, GET /notices/:id */
export function noticePublicRoute(req: Req): MockResult | null {
  const { s, method, seg, query, ctx } = req;
  if (seg[0] !== "notices" || method !== "GET") return null;
  const notices = s.notices ?? [];
  if (seg.length === 1) {
    const me = ctx.userId === null ? null : s.users.find((u) => u.id === ctx.userId);
    const seen = me?.noticesSeenAt ?? null;
    const rows = notices
      .filter((n) => n.publishedAt !== null)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.publishedAt!.localeCompare(a.publishedAt!) || b.id - a.id)
      .map((n) => ({ id: n.id, title: n.title, kind: n.kind, pinned: n.pinned, publishedAt: n.publishedAt!, unread: Boolean(me) && (seen === null || n.publishedAt! > seen) }));
    const p = page(rows, query);
    return isPage(p) ? ok(p) : p;
  }
  if (seg.length === 2 && seg[1] !== "seen") {
    const id = parseId(seg[1]);
    const n = id === null ? undefined : notices.find((x) => x.id === id);
    if (!n || (n.publishedAt === null && !isAdmin(s, ctx.userId))) return notFound();
    return ok(n);
  }
  return null;
}

function readNoticeInput(body: Record<string, unknown> | null, partial: boolean): MockResult | Partial<NoticeRow> & { published?: boolean } {
  const out: Partial<NoticeRow> & { published?: boolean } = {};
  if (!partial || body?.title !== undefined) {
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (title.length < 1 || title.length > 100) return err(400, "VALIDATION_FAILED", "제목은 1~100자여야 해요");
    out.title = title;
  }
  if (!partial || body?.body !== undefined) {
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (text.length < 1 || text.length > 20000) return err(400, "VALIDATION_FAILED", "본문은 1~20000자여야 해요");
    out.body = text;
  }
  if (!partial || body?.kind !== undefined) {
    if (!KINDS.includes(body?.kind as string)) return err(400, "VALIDATION_FAILED", "kind 는 notice, update, maintenance 중 하나여야 해요");
    out.kind = body!.kind as NoticeRow["kind"];
  }
  if (typeof body?.pinned === "boolean") out.pinned = body.pinned;
  if (typeof body?.published === "boolean") out.published = body.published;
  return out;
}

/** 로그인 뒤: POST /notices/seen, /admin/* (관리자만) */
export function noticeAuthedRoute(req: AuthedReq): MockResult | null {
  const { s, method, seg, query, body, userId } = req;
  if (seg[0] === "notices" && seg[1] === "seen" && seg.length === 2 && method === "POST") {
    const u = s.users.find((x) => x.id === userId)!;
    u.noticesSeenAt = nowIso();
    return ok({ noticesSeenAt: u.noticesSeenAt });
  }
  if (seg[0] !== "admin") return null;
  if (!isAdmin(s, userId)) return forbidden();
  const notices = (s.notices ??= []);

  if (seg[1] === "notices") {
    if (seg.length === 2 && method === "GET") {
      const p = page([...notices].sort((a, b) => b.id - a.id), query);
      return isPage(p) ? ok(p) : p;
    }
    if (seg.length === 2 && method === "POST") {
      const input = readNoticeInput(body, false);
      if ("status" in input) return input as MockResult;
      const now = nowIso();
      const row: NoticeRow = {
        id: nextId(),
        title: input.title!,
        body: input.body!,
        kind: input.kind!,
        pinned: input.pinned ?? false,
        publishedAt: input.published ? now : null,
        createdAt: now,
        updatedAt: now,
      };
      notices.push(row);
      logAdmin(s, userId, "notice_create", "notice", row.id);
      return ok(row, 201);
    }
    const id = seg.length === 3 ? parseId(seg[2]) : null;
    const row = id === null ? undefined : notices.find((n) => n.id === id);
    if (seg.length === 3 && !row) return notFound();
    if (row && method === "GET") return ok(row);
    if (row && method === "PATCH") {
      const input = readNoticeInput(body, true);
      if ("status" in input) return input as MockResult;
      const { published, ...rest } = input;
      Object.assign(row, rest);
      if (published !== undefined) row.publishedAt = published ? (row.publishedAt ?? nowIso()) : null;
      row.updatedAt = nowIso();
      logAdmin(s, userId, "notice_update", "notice", row.id);
      return ok(row);
    }
    if (row && method === "DELETE") {
      s.notices = notices.filter((n) => n.id !== row.id);
      logAdmin(s, userId, "notice_delete", "notice", row.id);
      return ok({ ok: true });
    }
  }

  if (seg[1] === "users") {
    const toAdminUser = (u: Store["users"][number]) => ({ id: u.id, nickname: u.nickname, role: u.role ?? "user", createdAt: u.createdAt, providers: u.providers ?? ["KAKAO"] });
    if (seg.length === 2 && method === "GET") {
      const q = (query.get("q") ?? "").trim();
      const rows = s.users.filter((u) => !q || u.nickname.includes(q)).sort((a, b) => b.id - a.id).map(toAdminUser);
      const p = page(rows, query);
      return isPage(p) ? ok(p) : p;
    }
    if (seg.length === 4 && seg[3] === "role" && method === "PATCH") {
      const id = parseId(seg[2]);
      const target = id === null ? undefined : s.users.find((u) => u.id === id);
      if (id === userId) return err(403, "FORBIDDEN", "내 역할은 바꿀 수 없어요");
      if (!target) return err(404, "NOT_FOUND", "사용자를 찾을 수 없어요");
      if (body?.role !== "user" && body?.role !== "admin") return err(400, "VALIDATION_FAILED", "role 은 user 또는 admin 이어야 해요");
      target.role = body.role;
      logAdmin(s, userId, "user_role", "user", target.id, body.role);
      return ok(toAdminUser(target));
    }
  }

  if (seg[1] === "logs" && seg.length === 2 && method === "GET") {
    const rows = [...(s.adminLogs ?? [])]
      .sort((a, b) => b.id - a.id)
      .map((l) => {
        const admin = s.users.find((u) => u.id === l.adminId);
        return { id: l.id, action: l.action, targetType: l.targetType, targetId: l.targetId, reason: l.reason, createdAt: l.createdAt, admin: admin ? { id: admin.id, nickname: admin.nickname } : null };
      });
    const p = page(rows, query);
    return isPage(p) ? ok(p) : p;
  }
  return null;
}

/** GET /me 의 hasUnreadNotice */
export function hasUnreadNotice(s: Store, userId: number): boolean {
  const seen = s.users.find((u) => u.id === userId)?.noticesSeenAt ?? null;
  return (s.notices ?? []).some((n) => n.publishedAt !== null && (seen === null || n.publishedAt > seen));
}
