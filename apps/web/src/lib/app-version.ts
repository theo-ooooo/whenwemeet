// (#539) 앱 업데이트 안내 규칙 (D-292). API app-releases/app-version.ts 와 같은 비교. 단위 테스트 대상이라 React 를 import 하지 않는다

/** 관리자가 넣는 버전: 숫자 1~3마디 "1", "1.4", "1.4.0" (API VERSION_PATTERN 과 같다) */
export const VERSION_PATTERN = /^\d{1,4}(\.\d{1,4}){0,2}$/;

/**
 * 버전 비교. a < b 면 음수, 같으면 0, a > b 면 양수. 마디를 숫자로(1.10.0 > 1.9.0), 없는 마디는 0(1.4 = 1.4.0).
 * "1.4.0-beta.1", "1.4.0+12" 같은 꼬리는 버리고 숫자가 아닌 마디는 0
 */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function parts(v: string): number[] {
  return v
    .trim()
    .split(/[-+]/)[0]
    .split(".")
    .map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
}

export type AppUpdateStatus = "required" | "available" | null;

/**
 * 지금 앱 버전 → 안내. 최소 버전보다 낮으면 required(닫을 수 없는 창), 최신 버전보다 낮으면 available(버전마다 한 번 닫을 수 있는 띠),
 * 아니거나 값이 없으면 null
 */
export function appUpdateStatus(current: string, release: { latestVersion: string | null; minVersion: string | null }): AppUpdateStatus {
  if (release.minVersion && compareVersions(current, release.minVersion) < 0) return "required";
  if (release.latestVersion && compareVersions(current, release.latestVersion) < 0) return "available";
  return null;
}

/** "새 버전이 나왔어요" 를 닫은 기록 (lib/hint.ts 키). 최신 버전마다 따로라 더 새 버전이 나오면 다시 보인다 */
export function appUpdateHintKey(latestVersion: string): string {
  return `app-update.${latestVersion}`;
}

/** 스토어 이름 */
export function storeName(platform: "ios" | "android"): string {
  return platform === "ios" ? "App Store" : "Play 스토어";
}
