// (#515) 공지사항과 관리자 화면 목 라우트 (api.md 2.16, D-285, D-286)
import { parseId } from "@/lib/id";
import type { AdminLogRow, NoticeRow, Store } from "../fixtures";
import { errorBody } from "@/lib/envelope";
import { err, nextId, nowIso, ok, type AuthedReq, type MockResult, type Req } from "./shared";

const KINDS = ["notice", "update", "maintenance"];
const notFound = () => err(404, "NOT_FOUND", "공지를 찾을 수 없어요");
const forbidden = () => err(403, "FORBIDDEN", "관리자만 할 수 있어요");
/** (#528) 초안에 push (api.md 2.16, D-287) */
const DRAFT_PUSH = "초안은 푸시로 보낼 수 없어요. 게시할 때 보내 주세요";
const draftPush = (): MockResult => ({ status: 400, body: errorBody(400, "VALIDATION_FAILED", DRAFT_PUSH, [{ field: "push", message: DRAFT_PUSH }]) });

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
  if (seg.length === 2 && seg[1] !== "seen" && seg[1] !== "attention") {
    const id = parseId(seg[1]);
    const n = id === null ? undefined : notices.find((x) => x.id === id);
    if (!n || (n.publishedAt === null && !isAdmin(s, ctx.userId))) return notFound();
    return ok(n);
  }
  return null;
}

function readNoticeInput(body: Record<string, unknown> | null, partial: boolean): MockResult | Partial<NoticeRow> & { published?: boolean; push?: boolean } {
  const out: Partial<NoticeRow> & { published?: boolean; push?: boolean } = {};
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
  // (#538) 팝업으로 띄우기
  if (body?.popup !== undefined) {
    if (typeof body.popup !== "boolean") return err(400, "VALIDATION_FAILED", "popup 는 true/false 여야 해요");
    out.popup = body.popup;
  }
  if (typeof body?.published === "boolean") out.published = body.published;
  // (#528) 게시와 같이 푸시
  if (body?.push !== undefined) {
    if (typeof body.push !== "boolean") return err(400, "VALIDATION_FAILED", "push 는 true/false 여야 해요");
    out.push = body.push;
  }
  return out;
}

/**
 * (#515) 관리자 사용자 한 줄. (#528, #532) platformLastSeen: 기종마다 접속 기록(UserClient)을 먼저, 없는 ios, android 는 그 기종 푸시 기기 중 가장 늦은 것.
 * platforms: 그 기종들(ios, android, web 순). 아무 기록도 앱 로그인도 없으면 web, 앱 로그인만 있으면 [] (API adminPlatformSeenOf, adminPlatformsOf)
 */
export function adminUserOut(s: Store, u: Store["users"][number]) {
  const clients = (s.userClients ?? []).filter((c) => c.userId === u.id);
  const devices = (s.pushDevices ?? []).filter((d) => d.userId === u.id);
  const platformLastSeen = (["ios", "android", "web"] as const).flatMap((platform) => {
    const client = clients.find((c) => c.platform === platform);
    if (client) return [{ platform, appVersion: client.appVersion, lastSeenAt: client.lastSeenAt }];
    if (platform === "web") return [];
    const latest = devices
      .filter((d) => d.platform === (platform === "ios" ? "IOS" : "ANDROID"))
      .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))
      .at(-1);
    return latest ? [{ platform, appVersion: latest.appVersion as string | null, lastSeenAt: latest.lastSeenAt }] : [];
  });
  const lastAppLoginAt = u.lastAppLoginAt ?? null;
  const platforms: ("ios" | "android" | "web")[] = platformLastSeen.map((p) => p.platform);
  if (platforms.length === 0 && lastAppLoginAt === null) platforms.push("web");
  return { id: u.id, nickname: u.nickname, role: u.role ?? "user", profileImageUrl: u.profileImageUrl, createdAt: u.createdAt, providers: u.providers ?? ["KAKAO"], platforms, platformLastSeen, lastAppLoginAt };
}

/** 로그인 뒤: POST /notices/seen, /admin/* (관리자만) */
export function noticeAuthedRoute(req: AuthedReq): MockResult | null {
  const { s, method, seg, query, body, userId } = req;
  if (seg[0] === "notices" && seg[1] === "seen" && seg.length === 2 && method === "POST") {
    const u = s.users.find((x) => x.id === userId)!;
    u.noticesSeenAt = nowIso();
    return ok({ noticesSeenAt: u.noticesSeenAt });
  }
  // (#538) 팝업 공지와 새 공지 띠, 팝업 닫기 (D-291)
  if (seg[0] === "notices" && seg[1] === "attention" && seg.length === 2 && method === "GET") return ok(noticeAttention(s, userId));
  if (seg[0] === "notices" && seg[2] === "dismiss" && seg.length === 3 && method === "POST") {
    const id = parseId(seg[1]);
    const n = id === null ? undefined : (s.notices ?? []).find((x) => x.id === id && x.publishedAt !== null);
    if (!n) return notFound();
    const list = (s.noticeDismissals ??= []);
    if (!list.some((d) => d.userId === userId && d.noticeId === n.id)) list.push({ userId, noticeId: n.id });
    return ok({ ok: true });
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
      if (input.push && !input.published) return draftPush();
      const now = nowIso();
      const row: NoticeRow = {
        id: nextId(),
        title: input.title!,
        body: input.body!,
        kind: input.kind!,
        pinned: input.pinned ?? false,
        popup: input.popup ?? false,
        publishedAt: input.published ? now : null,
        pushedAt: input.push ? now : null,
        createdAt: now,
        updatedAt: now,
      };
      notices.push(row);
      logAdmin(s, userId, "notice_create", "notice", row.id);
      if (row.pushedAt) logAdmin(s, userId, "notice_push", "notice", row.id);
      return ok(row, 201);
    }
    const id = seg.length === 3 ? parseId(seg[2]) : null;
    const row = id === null ? undefined : notices.find((n) => n.id === id);
    if (seg.length === 3 && !row) return notFound();
    if (row && method === "GET") return ok(row);
    if (row && method === "PATCH") {
      const input = readNoticeInput(body, true);
      if ("status" in input) return input as MockResult;
      const { published, push, ...rest } = input;
      const publishedAt = published === undefined ? row.publishedAt : published ? (row.publishedAt ?? nowIso()) : null;
      // (#528) 고친 결과가 게시 상태여야 하고, 이미 보냈으면 409 이며 아무것도 바꾸지 않는다
      if (push && publishedAt === null) return draftPush();
      if (push && row.pushedAt) return err(409, "NOTICE_ALREADY_PUSHED", "이 공지는 이미 푸시로 보냈어요");
      Object.assign(row, rest);
      row.publishedAt = publishedAt;
      if (push) row.pushedAt = nowIso();
      row.updatedAt = nowIso();
      logAdmin(s, userId, "notice_update", "notice", row.id);
      if (push) logAdmin(s, userId, "notice_push", "notice", row.id);
      return ok(row);
    }
    if (row && method === "DELETE") {
      s.notices = notices.filter((n) => n.id !== row.id);
      s.noticeDismissals = (s.noticeDismissals ?? []).filter((d) => d.noticeId !== row.id);
      logAdmin(s, userId, "notice_delete", "notice", row.id);
      return ok({ ok: true });
    }
  }

  if (seg[1] === "users") {
    const toAdminUser = (u: Store["users"][number]) => adminUserOut(s, u);
    if (seg.length === 2 && method === "GET") {
      const q = (query.get("q") ?? "").trim();
      // (#528) 기종 필터
      const platform = query.get("platform");
      if (platform && !["ios", "android", "web"].includes(platform)) return err(400, "VALIDATION_FAILED", "platform 은 ios, android, web 중 하나여야 해요");
      const rows = s.users
        .filter((u) => !q || u.nickname.includes(q))
        .sort((a, b) => b.id - a.id)
        .map(toAdminUser)
        .filter((u) => !platform || (u.platforms as string[]).includes(platform));
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

/** (#538) 첫 문단, 200자 (API noticePreview 와 같은 규칙) */
function preview(body: string): string {
  const first =
    body
      .replace(/\r\n?/g, "\n")
      .split(/\n(?:[ \t]*\n)+/)
      .map((p) => p.replace(/^\n+|\n+$/g, "").trim())
      .find((p) => p !== "") ?? "";
  const chars = Array.from(first);
  return chars.length > 200 ? `${chars.slice(0, 200).join("").trimEnd()}…` : first;
}

/** (#538) GET /notices/attention: 닫지 않은 게시된 팝업 중 최근 것, 본 시각 이후 게시된 공지 중 최근 것 (api.md 2.16, D-291) */
export function noticeAttention(s: Store, userId: number) {
  const seen = s.users.find((u) => u.id === userId)?.noticesSeenAt ?? null;
  const dismissed = new Set((s.noticeDismissals ?? []).filter((d) => d.userId === userId).map((d) => d.noticeId));
  const published = (s.notices ?? [])
    .filter((n) => n.publishedAt !== null)
    .sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!) || b.id - a.id);
  const brief = (n: NoticeRow) => ({ id: n.id, title: n.title, kind: n.kind, publishedAt: n.publishedAt! });
  const popup = published.find((n) => n.popup && !dismissed.has(n.id));
  const banner = published.find((n) => seen === null || n.publishedAt! > seen);
  return { popup: popup ? { ...brief(popup), preview: preview(popup.body) } : null, banner: banner ? brief(banner) : null };
}
