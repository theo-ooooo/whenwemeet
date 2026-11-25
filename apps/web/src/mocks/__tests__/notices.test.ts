import { beforeEach, describe, expect, it } from "vitest";
import { mockHandle } from "../handler";
import { ME_ID, OTHER_ID } from "../fixtures";
import { resetStore } from "../routes/shared";

type Res = { status: number; body: { data: Record<string, unknown> & { items: Record<string, unknown>[] } } };
const call = (method: string, path: string, userId: number | null = ME_ID, body: Record<string, unknown> | null = null, query = "") =>
  mockHandle({ method, path, query: new URLSearchParams(query), body, userId }) as Res;

describe("목 공지사항, 관리자 (#515)", () => {
  beforeEach(() => resetStore());

  it("공개 목록: 익명도 열리고 게시된 것만 고정 먼저, 초안 상세는 관리자만", () => {
    const anon = call("GET", "/notices", null);
    expect(anon.status).toBe(200);
    expect(anon.body.data.items.map((n) => n.id)).toEqual([1, 2]);
    expect(anon.body.data.items.every((n) => n.unread === false)).toBe(true);
    expect(call("GET", "/notices/3", null).status).toBe(404);
    expect(call("GET", "/notices/3", OTHER_ID).status).toBe(404);
    expect(call("GET", "/notices/3", ME_ID).status).toBe(200);
  });

  it("새 공지 점: GET /me hasUnreadNotice → seen 뒤 false", () => {
    expect(call("GET", "/me").body.data).toMatchObject({ isAdmin: true, role: "admin", hasUnreadNotice: true });
    expect(call("GET", "/notices").body.data.items.every((n) => n.unread === true)).toBe(true);
    expect(call("POST", "/notices/seen").status).toBe(200);
    expect(call("GET", "/me").body.data.hasUnreadNotice).toBe(false);
    expect(call("POST", "/notices/seen", null).status).toBe(401);
  });

  it("관리자만: 일반 사용자는 403, 작성하면 목록에 보이고 기록이 남는다", () => {
    expect(call("GET", "/admin/notices", OTHER_ID).status).toBe(403);
    const created = call("POST", "/admin/notices", ME_ID, { title: " 새 공지 ", body: "본문", kind: "notice", pinned: false, published: true });
    expect(created.status).toBe(201);
    expect(created.body.data.title).toBe("새 공지");
    expect(call("GET", "/notices", null).body.data.items.map((n) => n.title)).toContain("새 공지");
    expect(call("GET", "/admin/logs").body.data.items[0]).toMatchObject({ action: "notice_create", targetType: "notice" });
  });

  it("사용자: 검색, 내 역할은 403, 다른 사람은 바뀐다", () => {
    const search = call("GET", "/admin/users", ME_ID, null, "q=하늘");
    expect(search.body.data.items.map((u) => u.nickname)).toEqual(["하늘"]);
    expect(call("PATCH", `/admin/users/${ME_ID}/role`, ME_ID, { role: "user" }).status).toBe(403);
    const r = call("PATCH", `/admin/users/${OTHER_ID}/role`, ME_ID, { role: "admin" });
    expect(r.body.data).toMatchObject({ id: OTHER_ID, role: "admin" });
    const page = call("GET", "/admin/users", ME_ID, null, "limit=2");
    expect(page.body.data.items).toHaveLength(2);
    expect(page.body.data.nextCursor).not.toBeNull();
  });
});
