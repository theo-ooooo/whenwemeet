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

describe("목 팀, 일정 숨김 (#515, D-286)", () => {
  beforeEach(() => resetStore());

  it("팀 숨기기: 팀 경로 403 GROUP_HIDDEN, 목록엔 hidden, 나가기는 된다, 해제하면 돌아온다", () => {
    expect(call("POST", "/admin/groups/4/hide", ME_ID, { reason: " " }).status).toBe(400);
    expect(call("POST", "/admin/groups/4/hide", ME_ID, { reason: "광고" }).body.data.hidden).toMatchObject({ reason: "광고" });
    const blocked = mockHandle({ method: "GET", path: "/groups/4", query: new URLSearchParams(), body: null, userId: ME_ID }) as { status: number; body: { error: { code: string } } };
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("GROUP_HIDDEN");
    const groups = call("GET", "/groups").body.data as unknown as { id: number; hidden: { reason: string } | null }[];
    expect(groups.find((g) => g.id === 4)?.hidden).toMatchObject({ reason: "광고" });
    expect(call("POST", "/admin/groups/4/unhide").status).toBe(200);
    expect(call("GET", "/groups/4").status).toBe(200);
  });

  it("일정 숨기기: 목록과 상세에서 빠지고, 관리자 목록에는 숨김으로", () => {
    expect(call("POST", "/admin/events/3/hide", ME_ID, { reason: "스팸" }).status).toBe(200);
    expect(call("GET", "/groups/2/events/3").status).toBe(404);
    const list = call("GET", "/admin/events", ME_ID, null, "q=영화");
    expect(list.body.data.items[0]).toMatchObject({ id: 3, hidden: { reason: "스팸" } });
    expect(call("GET", "/admin/logs").body.data.items[0]).toMatchObject({ action: "event_hide", reason: "스팸" });
    expect(call("GET", "/admin/events/3", OTHER_ID).status).toBe(403);
  });
});

describe("목 공지 푸시, 관리자 사용자 알림 설정 (#528, D-287)", () => {
  beforeEach(() => resetStore());

  it("게시하며 push: pushedAt 과 notice_push 기록. 초안 push 400(field push), 두 번째 409 이고 고친 내용은 그대로", () => {
    const draft = call("POST", "/admin/notices", ME_ID, { title: "초안", body: "b", kind: "notice", push: true });
    expect(draft.status).toBe(400);
    const created = call("POST", "/admin/notices", ME_ID, { title: "새 기능", body: "b", kind: "update", published: true, push: true });
    expect(created.status).toBe(201);
    const id = created.body.data.id as number;
    expect(created.body.data.pushedAt).not.toBeNull();
    expect(call("GET", "/admin/logs").body.data.items.slice(0, 2).map((l) => l.action)).toEqual(["notice_push", "notice_create"]);
    const again = call("PATCH", `/admin/notices/${id}`, ME_ID, { title: "바꿈", push: true });
    expect(again.status).toBe(409);
    expect(call("GET", `/admin/notices/${id}`).body.data.title).toBe("새 기능");
    // 초안(3번)은 게시와 같이만 보낼 수 있다
    expect(call("PATCH", "/admin/notices/3", ME_ID, { push: true }).status).toBe(400);
    expect(call("PATCH", "/admin/notices/3", ME_ID, { published: true, push: true }).body.data.pushedAt).not.toBeNull();
  });

  it("알림 설정에 notice (기본 켬)", () => {
    expect(call("GET", "/me/notification-settings").body.data.notice).toBe(true);
    expect(call("PATCH", "/me/notification-settings", ME_ID, { notice: false }).body.data.notice).toBe(false);
  });

  it("관리자 사용자 상세: 설정은 내 정보 > 알림 키 그대로, 기기는 토큰 없이", () => {
    const r = call("GET", "/admin/users/11");
    const n = r.body.data.notifications as { settings: Record<string, boolean>; devices: Record<string, unknown>[] };
    expect(Object.keys(n.settings).sort()).toEqual(Object.keys(call("GET", "/me/notification-settings").body.data).sort());
    expect(n.settings).toMatchObject({ notice: false, change: false, reminder: true });
    expect(n.devices.map((d) => d.platform)).toEqual(["IOS", "ANDROID"]);
    expect(JSON.stringify(r.body)).not.toMatch(/PushToken/);
    expect(call("GET", "/admin/users/13").body.data.notifications).toMatchObject({ devices: [] });
  });
});
