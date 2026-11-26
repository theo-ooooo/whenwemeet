// (#539) 앱 업데이트 안내 목 라우트 (api.md 2.17, D-292). 공개 GET /app/version, 관리자 GET /admin/app-releases, PUT /admin/app-releases/:platform
import { errorBody } from "@/lib/envelope";
import { compareVersions, VERSION_PATTERN } from "@/lib/app-version";
import type { AppReleaseRow } from "../fixtures";
import { logAdmin } from "./notices";
import { err, nextId, nowIso, ok, type AuthedReq, type MockResult, type Req } from "./shared";

const PLATFORMS = ["ios", "android"] as const;
type Platform = (typeof PLATFORMS)[number];
const DEFAULT_STORE: Record<Platform, string> = {
  ios: "https://apps.apple.com/kr/app/id6832865813",
  android: "https://play.google.com/store/apps/details?id=day.whenwemeet.app",
};
const badPlatform = () => err(400, "VALIDATION_FAILED", "platform 은 ios, android 중 하나여야 해요");

function out(platform: Platform, row: AppReleaseRow | undefined) {
  return {
    platform,
    latestVersion: row?.latestVersion ?? null,
    minVersion: row?.minVersion ?? null,
    storeUrl: row?.storeUrl ?? DEFAULT_STORE[platform],
    updatedAt: row?.updatedAt ?? null,
  };
}

const isPlatform = (v: unknown): v is Platform => v === "ios" || v === "android";

/** 공개: GET /app/version?platform= */
export function appVersionPublicRoute(req: Req): MockResult | null {
  const { s, method, seg, query } = req;
  if (seg[0] !== "app" || seg[1] !== "version" || seg.length !== 2 || method !== "GET") return null;
  const platform = query.get("platform");
  if (!isPlatform(platform)) return badPlatform();
  return ok(
    out(
      platform,
      (s.appReleases ?? []).find((r) => r.platform === platform),
    ),
  );
}

/** 관리자(handler 가 관리자 확인 뒤 부르지 않으므로 여기서 확인): GET /admin/app-releases, PUT /admin/app-releases/:platform */
export function adminAppReleasesRoute(req: AuthedReq): MockResult | null {
  const { s, method, seg, body, userId } = req;
  if (seg[0] !== "admin" || seg[1] !== "app-releases") return null;
  if (s.users.find((u) => u.id === userId)?.role !== "admin") return err(403, "FORBIDDEN", "관리자만 할 수 있어요");
  const rows = (s.appReleases ??= []);
  if (seg.length === 2 && method === "GET")
    return ok(
      PLATFORMS.map((p) =>
        out(
          p,
          rows.find((r) => r.platform === p),
        ),
      ),
    );
  if (seg.length !== 3 || method !== "PUT") return null;
  const platform = seg[2];
  if (!isPlatform(platform)) return badPlatform();
  const patch: Partial<Pick<AppReleaseRow, "latestVersion" | "minVersion" | "storeUrl">> = {};
  for (const key of ["latestVersion", "minVersion"] as const) {
    const v = body?.[key];
    if (v === undefined) continue;
    if (v !== null && (typeof v !== "string" || !VERSION_PATTERN.test(v.trim())))
      return err(400, "VALIDATION_FAILED", `${key} 는 1.4.0 처럼 숫자와 점(최대 3마디)이어야 해요`);
    patch[key] = v === null ? null : v.trim();
  }
  if (body?.storeUrl !== undefined) {
    const v = body.storeUrl;
    if (v !== null && (typeof v !== "string" || !/^https:\/\/\S+$/.test(v.trim()) || v.length > 500))
      return err(400, "VALIDATION_FAILED", "storeUrl 은 https 로 시작하는 500자 이하 주소여야 해요");
    patch.storeUrl = v === null ? null : v.trim();
  }
  const current = rows.find((r) => r.platform === platform);
  const latest = patch.latestVersion !== undefined ? patch.latestVersion : (current?.latestVersion ?? null);
  const min = patch.minVersion !== undefined ? patch.minVersion : (current?.minVersion ?? null);
  if (latest && min && compareVersions(min, latest) > 0) {
    const message = "최소 버전은 최신 버전보다 높을 수 없어요";
    return { status: 400, body: errorBody(400, "VALIDATION_FAILED", message, [{ field: "minVersion", message }]) };
  }
  const row: AppReleaseRow = current ?? { id: nextId(), platform, latestVersion: null, minVersion: null, storeUrl: null, updatedAt: nowIso() };
  Object.assign(row, patch, { updatedAt: nowIso() });
  if (!current) rows.push(row);
  logAdmin(s, userId, "app_release_update", "app_release", row.id, `${platform} 최신 ${row.latestVersion ?? "없음"}, 최소 ${row.minVersion ?? "없음"}`);
  return ok(out(platform, row));
}
