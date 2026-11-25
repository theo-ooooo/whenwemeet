// (#539) 앱 업데이트 안내 규칙 (D-292)
import { describe, expect, it } from "vitest";
import { appUpdateHintKey, appUpdateStatus, compareVersions, storeName, VERSION_PATTERN } from "../app-version";

describe("compareVersions", () => {
  it("마디를 숫자로 비교한다 (1.10.0 > 1.9.0), 없는 마디는 0", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("1.4", "1.4.0")).toBe(0);
    expect(compareVersions("2", "1.99.99")).toBe(1);
    expect(compareVersions("0.9.9", "1")).toBe(-1);
  });

  it("꼬리(-beta, +빌드)는 버리고 숫자가 아닌 마디는 0", () => {
    expect(compareVersions("1.4.0-beta.1", "1.4.0")).toBe(0);
    expect(compareVersions("1.3.9+20", "1.4.0")).toBe(-1);
    expect(compareVersions("1.a.0", "1.0.0")).toBe(0);
  });
});

describe("appUpdateStatus", () => {
  const release = { latestVersion: "1.4.0", minVersion: "1.1.0" };

  it("최소보다 낮으면 required, 최신보다 낮으면 available, 같거나 높으면 null", () => {
    expect(appUpdateStatus("1.0.9", release)).toBe("required");
    expect(appUpdateStatus("1.1.0", release)).toBe("available");
    expect(appUpdateStatus("1.3.12", release)).toBe("available");
    expect(appUpdateStatus("1.4.0", release)).toBeNull();
    expect(appUpdateStatus("1.10.0", release)).toBeNull();
  });

  it("값이 없으면 그 안내를 하지 않는다", () => {
    expect(appUpdateStatus("1.0.0", { latestVersion: null, minVersion: null })).toBeNull();
    expect(appUpdateStatus("1.0.0", { latestVersion: "1.4.0", minVersion: null })).toBe("available");
    expect(appUpdateStatus("1.0.0", { latestVersion: null, minVersion: "1.1.0" })).toBe("required");
  });
});

describe("표기", () => {
  it("관리자 입력 형식, 닫기 키, 스토어 이름", () => {
    expect(["1", "1.4", "1.4.0"].every((v) => VERSION_PATTERN.test(v))).toBe(true);
    expect(["", "v1", "1.0.0.0", "1.0-beta"].some((v) => VERSION_PATTERN.test(v))).toBe(false);
    expect(appUpdateHintKey("1.4.0")).toBe("app-update.1.4.0");
    expect(storeName("ios")).toBe("App Store");
    expect(storeName("android")).toBe("Play 스토어");
  });
});
