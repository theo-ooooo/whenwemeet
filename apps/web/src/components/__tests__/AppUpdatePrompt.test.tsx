// @vitest-environment happy-dom
// (#539) 앱 업데이트 안내 (D-292): 웹 브라우저는 아무것도 안 함, 앱 UA 버전으로 required/available, 띠는 최신 버전마다 한 번 닫는다
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRelease } from "@/lib/types";

const release: AppRelease = {
  platform: "ios",
  latestVersion: "1.4.0",
  minVersion: "1.1.0",
  storeUrl: "https://apps.apple.com/kr/app/id6832865813",
  updatedAt: null,
};
const asked: (string | null)[] = [];
vi.mock("@/hooks", () => ({
  useAppRelease: (platform: string | null) => {
    asked.push(platform);
    return { data: platform ? { ...release, platform } : null, error: null, isLoading: false, refetch: vi.fn() };
  },
}));

const { AppUpdateBanner, AppUpdateRequired, useAppUpdate } = await import("../AppUpdatePrompt");

function setUa(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

describe("useAppUpdate (#539)", () => {
  beforeEach(() => {
    asked.length = 0;
  });

  it("웹 브라우저는 요청하지 않고 status null", () => {
    setUa("Mozilla/5.0 (iPhone) Safari/604.1");
    const { result } = renderHook(() => useAppUpdate());
    expect(result.current.status).toBeNull();
    expect(asked.every((p) => p === null)).toBe(true);
  });

  it("앱 UA 의 기종과 버전으로 비교한다", () => {
    setUa("Mozilla/5.0 (iPhone) WhenwemeetApp/1.3.0 (ios)");
    expect(renderHook(() => useAppUpdate()).result.current).toMatchObject({ status: "available", version: "1.3.0" });
    expect(asked).toContain("ios");
    setUa("Mozilla/5.0 (Linux; Android 14) WhenwemeetApp/1.0.2 (android)");
    expect(renderHook(() => useAppUpdate()).result.current).toMatchObject({ status: "required", version: "1.0.2", release: { platform: "android" } });
    setUa("Mozilla/5.0 WhenwemeetApp/1.10.0 (ios)");
    expect(renderHook(() => useAppUpdate()).result.current.status).toBeNull();
  });
});

describe("안내 화면 (#539)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("띠: 스토어 링크, × 는 이 최신 버전 동안 감추고 더 새 버전이면 다시 보인다", () => {
    const r = render(<AppUpdateBanner release={release} />);
    expect(screen.getByRole("link", { name: /새 버전이 나왔어요/ }).getAttribute("href")).toBe(release.storeUrl);
    act(() => fireEvent.click(screen.getByRole("button", { name: "새 버전 안내 닫기" })));
    expect(screen.queryByRole("link")).toBeNull();
    r.rerender(<AppUpdateBanner release={{ ...release, latestVersion: "1.5.0" }} />);
    expect(screen.getByRole("link", { name: /새 버전이 나왔어요/ })).toBeTruthy();
  });

  it("꼭 업데이트: 닫기 없이 버전과 스토어 버튼만", () => {
    render(<AppUpdateRequired release={release} version="1.0.2" />);
    expect(screen.getByRole("alertdialog", { name: "업데이트가 필요해요" })).toBeTruthy();
    expect(screen.getByText(/1\.0\.2/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "App Store에서 업데이트" }).getAttribute("href")).toBe(release.storeUrl);
    expect(screen.queryByRole("button", { name: /닫기/ })).toBeNull();
  });
});
