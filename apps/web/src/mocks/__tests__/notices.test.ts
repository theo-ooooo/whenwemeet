import { beforeEach, describe, expect, it } from "vitest";
import { mockHandle } from "../handler";
import { DAD_ID, ME_ID, MOM_ID, OTHER_ID } from "../fixtures";
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
    const blocked = mockHandle({ method: "GET", path: "/groups/4", query: new URLSearchParams(), body: null, userId: ME_ID }) as {
      status: number;
      body: { error: { code: string } };
    };
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
    expect(
      call("GET", "/admin/logs")
        .body.data.items.slice(0, 2)
        .map((l) => l.action),
    ).toEqual(["notice_push", "notice_create"]);
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

describe("목 관리자 팀 종류 필터와 개인 달력 주인 (#528)", () => {
  beforeEach(() => resetStore());
  type Row = { id: number; type: string; name: string; owner: { nickname: string } | null; memberPreview: unknown[] };
  const groups = (query: string) => call("GET", "/admin/groups", ME_ID, null, `limit=50&${query}`).body.data.items as unknown as Row[];

  it("type=TEAM 은 팀만(멤버 미리 보기 3명까지), PERSONAL 은 주인이 있는 개인 달력만, 없으면 전체", () => {
    const teams = groups("type=TEAM");
    expect(teams.every((g) => g.type === "TEAM" && g.owner === null)).toBe(true);
    expect(teams.every((g) => g.memberPreview.length <= 3)).toBe(true);
    const personal = groups("type=PERSONAL");
    expect(personal.length).toBeGreaterThan(3);
    expect(personal.every((g) => g.type === "PERSONAL" && g.name === "내 달력" && g.owner !== null)).toBe(true);
    expect(groups("")).toHaveLength(teams.length + personal.length);
    expect(call("GET", "/admin/groups", ME_ID, null, "type=team").status).toBe(400);
  });

  it("q 는 개인 달력 주인 닉네임도 찾는다. 일정 목록의 팀에 type 과 주인", () => {
    expect(groups("q=수경").map((g) => [g.type, g.owner?.nickname])).toEqual([["PERSONAL", "수경"]]);
    const events = call("GET", "/admin/events", ME_ID, null, "limit=50").body.data.items as unknown as {
      group: { type: string; owner: { nickname: string } | null };
    }[];
    const personal = events.find((e) => e.group.type === "PERSONAL");
    expect(personal?.group.owner?.nickname).toBeTruthy();
    expect(events.filter((e) => e.group.type === "TEAM").every((e) => e.group.owner === null)).toBe(true);
  });
});

describe("목 관리자 사용자 쓰는 곳 (#528, #532)", () => {
  beforeEach(() => resetStore());
  type U = { id: number; platforms: string[]; platformLastSeen: { platform: string; appVersion: string | null }[]; lastAppLoginAt: string | null };
  const users = (query = "") => call("GET", "/admin/users", ME_ID, null, `limit=50&${query}`).body.data.items as unknown as U[];

  it("접속 기록을 먼저, 없는 기종은 푸시 기기. 아무 기록도 앱 로그인도 없으면 web, 앱 로그인만 있으면 []. platform 필터, 상세도 같은 값", () => {
    const byId = new Map(users().map((u) => [u.id, u]));
    expect(byId.get(11)!.platforms).toEqual(["ios", "android", "web"]);
    expect(byId.get(11)!.platformLastSeen.map((p) => [p.platform, p.appVersion])).toEqual([
      ["ios", "1.3.0"],
      ["android", "1.2.1"],
      ["web", null],
    ]);
    expect(byId.get(12)!.platforms).toEqual(["ios"]);
    expect(byId.get(13)!.platforms).toEqual([]);
    expect(byId.get(ME_ID)!.platforms).toEqual(["web"]);
    expect(byId.get(MOM_ID)!.platforms).toEqual(["android"]);
    expect(
      users("platform=android")
        .map((u) => u.id)
        .sort((a, b) => a - b),
    ).toEqual([MOM_ID, 11]);
    expect(users("platform=web").every((u) => u.platforms.includes("web"))).toBe(true);
    expect(call("GET", "/admin/users", ME_ID, null, "platform=IOS").status).toBe(400);
    expect(call("GET", "/admin/users/11").body.data.user).toMatchObject({ platforms: ["ios", "android", "web"] });
  });

  describe("팝업과 새 공지 띠 (#538)", () => {
    type Attention = { popup: { id: number; preview: string } | null; banner: { id: number } | null };
    const attention = (userId = ME_ID) => call("GET", "/notices/attention", userId).body.data as unknown as Attention;

    it("시드: 점검 안내가 팝업(첫 문단), 띠는 본 시각 이후 가장 최근 공지", () => {
      const got = attention();
      expect(got.popup).toMatchObject({ id: 2, preview: "11월 30일(일) 새벽 2시부터 4시까지 서버를 점검해요." });
      expect(got.banner).toMatchObject({ id: 2 });
      expect(call("GET", "/notices/attention", null).status).toBe(401);
    });

    it("닫기: 멱등, 그 사용자만. 초안과 없는 공지는 404. seen 은 띠만 지운다", () => {
      expect(call("POST", "/notices/2/dismiss").status).toBe(200);
      expect(call("POST", "/notices/2/dismiss").status).toBe(200);
      expect(attention().popup).toBeNull();
      expect(attention(MOM_ID).popup).toMatchObject({ id: 2 });
      expect(call("POST", "/notices/3/dismiss").status).toBe(404);
      expect(call("POST", "/notices/999/dismiss").status).toBe(404);
      call("POST", "/notices/seen");
      expect(attention().banner).toBeNull();
    });

    it("관리자 popup: 기본 false, 저장되고 게시하면 닫은 사람에게도 새 팝업이 뜬다", () => {
      call("POST", "/notices/2/dismiss");
      const plain = call("POST", "/admin/notices", ME_ID, { title: "일반", body: "b", kind: "notice", published: true });
      expect(plain.body.data.popup).toBe(false);
      expect(call("POST", "/admin/notices", ME_ID, { title: "x", body: "b", kind: "notice", popup: "y" }).status).toBe(400);
      const id = plain.body.data.id as number;
      expect(call("PATCH", `/admin/notices/${id}`, ME_ID, { popup: true }).body.data.popup).toBe(true);
      expect(attention().popup).toMatchObject({ id });
    });
  });
});

describe("목 공지 읽음과 결과 (#544, D-293)", () => {
  beforeEach(() => resetStore());

  it("읽음: 처음 한 번만, 경로도 처음 것. 로그인 안 하면 401, 초안 404, 모르는 경로 400", () => {
    const first = call("POST", "/notices/1/read", ME_ID, { via: "push" });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ via: "push", first: true });
    expect(call("POST", "/notices/1/read", ME_ID, { via: "list" }).body.data).toMatchObject({ via: "push", first: false });
    expect(call("POST", "/notices/1/read", null, { via: "push" }).status).toBe(401);
    expect(call("POST", "/notices/3/read", ME_ID, {}).status).toBe(404);
    expect(call("POST", "/notices/1/read", OTHER_ID, { via: "email" }).status).toBe(400);
    expect(call("POST", "/notices/1/read", OTHER_ID, {}).body.data.via).toBe("detail");
  });

  it("결과: 기기별 발송, 경로별 읽음, 푸시 대상 중 비율. 나를 읽으면 안 읽은 사람에서 빠진다", () => {
    const stats = call("GET", "/admin/notices/1/stats").body.data;
    expect(stats).toMatchObject({
      push: { status: "DISPATCHED", targetUsers: 5, devices: 5, sent: 4, delivered: 3, failed: 2, pending: 0 },
      reads: { total: 4, pushOpened: 1 },
      readRateBasis: { of: "push", read: 3, total: 5 },
      readRate: 0.6,
    });
    const unread = () => call("GET", "/admin/notices/1/readers", ME_ID, null, "unread=1").body.data.items.map((r) => r.nickname);
    expect(unread()).toEqual(["하늘", "지우"]);
    call("POST", "/notices/1/read", ME_ID, { via: "push" });
    expect(unread()).toEqual(["하늘"]);
    const readers = call("GET", "/admin/notices/1/readers").body.data.items;
    expect(readers[0]).toMatchObject({ id: ME_ID, via: "push" });
    expect(call("GET", "/admin/notices/1/readers", ME_ID, null, "via=popup").body.data.items).toEqual([]);
    expect(call("GET", "/admin/notices/2/readers", ME_ID, null, "q=아빠").body.data.items.map((r) => r.id)).toEqual([DAD_ID]);
    expect(call("GET", "/admin/notices/2/stats").body.data).toMatchObject({ push: null, readRateBasis: { of: "users", read: 2 } });
  });

  it("관리자 목록 readCount, 일반 사용자는 결과 403, 푸시하면 바로 펼쳐 대상이 생긴다", () => {
    const items = call("GET", "/admin/notices").body.data.items;
    expect(items.find((n) => n.id === 1)?.readCount).toBe(4);
    expect(call("GET", "/admin/notices/1/stats", MOM_ID).status).toBe(403);
    expect(call("GET", "/admin/notices/1/readers", MOM_ID).status).toBe(403);
    const created = call("POST", "/admin/notices", ME_ID, { title: "새 공지", body: "본문", kind: "notice", published: true, push: true });
    const id = created.body.data.id as number;
    expect(call("GET", `/admin/notices/${id}/stats`).body.data.push).toMatchObject({ status: "DISPATCHED", targetUsers: 1, delivered: 1 }); // 기기가 있고 공지 알림을 켠 사람은 수경뿐 (민지는 끔)
  });
});
