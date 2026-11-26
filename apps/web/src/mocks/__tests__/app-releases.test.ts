// (#539) 목 앱 업데이트 안내 (api.md 2.17, D-292)
import { beforeEach, describe, expect, it } from "vitest";
import { mockHandle } from "../handler";
import { ME_ID, OTHER_ID } from "../fixtures";
import { resetStore } from "../routes/shared";

type Res = { status: number; body: { data: Record<string, unknown> & { items: Record<string, unknown>[] } } };
const call = (method: string, path: string, userId: number | null = ME_ID, body: Record<string, unknown> | null = null, query = "") =>
  mockHandle({ method, path, query: new URLSearchParams(query), body, userId }) as Res;

describe("목 앱 버전 (#539)", () => {
  beforeEach(() => resetStore());

  it("공개 GET /app/version: 시드는 최신 1.4.0, 최소 1.1.0, 기본 스토어 주소. 기종이 틀리면 400", () => {
    const ios = call("GET", "/app/version", null, null, "platform=ios");
    expect(ios.status).toBe(200);
    expect(ios.body.data).toMatchObject({
      platform: "ios",
      latestVersion: "1.4.0",
      minVersion: "1.1.0",
      storeUrl: "https://apps.apple.com/kr/app/id6832865813",
    });
    expect(call("GET", "/app/version", null, null, "platform=android").body.data.storeUrl).toBe(
      "https://play.google.com/store/apps/details?id=day.whenwemeet.app",
    );
    expect(call("GET", "/app/version", null, null, "platform=web").status).toBe(400);
  });

  it("관리자: 목록, 수정(최소 > 최신 400, null 로 지우기), 조치 기록. 일반 사용자 403", () => {
    expect(call("GET", "/admin/app-releases", OTHER_ID).status).toBe(403);
    expect((call("GET", "/admin/app-releases").body.data as unknown as { platform: string }[]).map((r) => r.platform)).toEqual(["ios", "android"]);
    expect(call("PUT", "/admin/app-releases/ios", ME_ID, { minVersion: "1.10.0" }).status).toBe(400);
    expect(call("PUT", "/admin/app-releases/ios", ME_ID, { latestVersion: "v2" }).status).toBe(400);
    expect(call("PUT", "/admin/app-releases/web", ME_ID, { latestVersion: "2.0.0" }).status).toBe(400);
    const r = call("PUT", "/admin/app-releases/ios", ME_ID, { latestVersion: "1.10.0", minVersion: null, storeUrl: null });
    expect(r.body.data).toMatchObject({ latestVersion: "1.10.0", minVersion: null });
    expect(call("GET", "/app/version", null, null, "platform=ios").body.data).toMatchObject({ latestVersion: "1.10.0", minVersion: null });
    expect(call("GET", "/admin/logs").body.data.items[0]).toMatchObject({
      action: "app_release_update",
      targetType: "app_release",
      reason: "ios 최신 1.10.0, 최소 없음",
    });
  });
});
