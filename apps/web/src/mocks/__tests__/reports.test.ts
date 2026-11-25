import { beforeEach, describe, expect, it } from "vitest";
import { mockHandle } from "../handler";
import { DAD_ID, FAMILY_ID, ME_ID, MOM_ID, OTHER_ID, PERSONAL_ID, TEAM_ID } from "../fixtures";
import { resetStore } from "../routes/shared";

type Res = { status: number; body: { data: Record<string, unknown> & { items: Record<string, unknown>[] }; error?: { code: string } } };
const call = (method: string, path: string, userId: number | null = ME_ID, body: Record<string, unknown> | null = null, query = "") =>
  mockHandle({ method, path, query: new URLSearchParams(query), body, userId }) as Res;

describe("목 신고하기 (#536)", () => {
  beforeEach(() => resetStore());

  it("남의 일정: 201, 접수 중 다시 하면 200 duplicate. 내 일정 403, 개인 달력 403, 나 자신 403, 모르는 사람 404", () => {
    // 일정 5(요가)는 하늘이 만들었다
    const first = call("POST", "/reports", ME_ID, { targetType: "event", targetId: 5, reason: "spam", detail: " 광고 " });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ targetType: "event", targetId: 5, duplicate: false });
    expect(call("POST", "/reports", ME_ID, { targetType: "event", targetId: 5, reason: "abuse" }).body.data).toMatchObject({ id: first.body.data.id, duplicate: true });
    expect(call("POST", "/reports", ME_ID, { targetType: "event", targetId: 2, reason: "spam" }).status).toBe(403);
    expect(call("POST", "/reports", ME_ID, { targetType: "group", targetId: PERSONAL_ID, reason: "spam" }).status).toBe(403);
    expect(call("POST", "/reports", ME_ID, { targetType: "group", targetId: TEAM_ID, reason: "spam" }).status).toBe(201);
    expect(call("POST", "/reports", ME_ID, { targetType: "user", targetId: ME_ID, reason: "abuse" }).status).toBe(403);
    expect(call("POST", "/reports", MOM_ID, { targetType: "user", targetId: 13, reason: "abuse" }).status).toBe(404);
    expect(call("POST", "/reports", ME_ID, { targetType: "event", targetId: 5, reason: "boring" }).status).toBe(400);
  });

  it("하루 10번 (최근 24시간)", () => {
    // 시드에 오늘 내 신고가 1건(일정 30) 있다
    for (const id of [1, 5, 7, 32, 34, 37, 39]) expect(call("POST", "/reports", ME_ID, { targetType: "event", targetId: id, reason: "spam" }).status).toBeLessThan(300);
    expect(call("POST", "/reports", ME_ID, { targetType: "user", targetId: OTHER_ID, reason: "abuse" }).status).toBe(201);
    expect(call("POST", "/reports", ME_ID, { targetType: "user", targetId: MOM_ID, reason: "abuse" }).status).toBe(201);
    expect(call("POST", "/reports", ME_ID, { targetType: "user", targetId: DAD_ID, reason: "abuse" }).status).toBe(429);
  });

  it("관리자 목록은 대상별 묶음, 처리 완료는 그 대상 접수 중 신고를 모두 닫는다, 숨기기도 닫는다", () => {
    expect(call("GET", "/admin/reports", OTHER_ID).status).toBe(403);
    const open = call("GET", "/admin/reports", ME_ID, null, "status=open").body.data.items;
    expect(open.map((g) => `${g.targetType}:${g.targetId}`)).toEqual(["event:30", `group:${FAMILY_ID}`]);
    expect(open[1]).toMatchObject({ count: 2, openCount: 2, status: "open", target: { title: "우리 가족" } });
    expect(call("GET", "/admin/reports/open-count").body.data).toEqual({ openTargets: 2 });
    const detail = call("GET", `/admin/reports/targets/group/${FAMILY_ID}`).body.data as unknown as { reports: { id: number }[]; target: { type: string } };
    expect(detail.target.type).toBe("group");
    expect(call("POST", `/admin/reports/${detail.reports[0].id}/resolve`, ME_ID, { resolution: "" }).status).toBe(400);
    const done = call("POST", `/admin/reports/${detail.reports[0].id}/resolve`, ME_ID, { resolution: "팀장에게 안내" }).body.data;
    expect(done.openCount).toBe(0);
    call("POST", "/admin/events/30/hide", ME_ID, { reason: "광고" });
    expect(call("GET", "/admin/reports/open-count").body.data).toEqual({ openTargets: 0 });
    const logs = call("GET", "/admin/logs", ME_ID, null, "limit=10").body.data.items.map((l) => l.action);
    expect(logs).toEqual(expect.arrayContaining(["report_resolve", "event_hide"]));
  });
});

describe("목 대시보드 (#537)", () => {
  beforeEach(() => resetStore());

  it("7일, 30일: 날짜 수, 합계와 쓰는 곳은 목 상태에서", () => {
    const week = call("GET", "/admin/stats", ME_ID, null, "range=7").body.data as unknown as { days: unknown[]; totals: Record<string, number>; platforms: Record<string, number> };
    expect(week.days).toHaveLength(7);
    expect(week.totals.openReports).toBe(3);
    expect(week.platforms.ios).toBeGreaterThan(0);
    expect((call("GET", "/admin/stats", ME_ID, null, "range=30").body.data as unknown as { days: unknown[] }).days).toHaveLength(30);
    expect(call("GET", "/admin/stats", ME_ID, null, "range=14").status).toBe(400);
    expect(call("GET", "/admin/stats", OTHER_ID).status).toBe(403);
  });
});
