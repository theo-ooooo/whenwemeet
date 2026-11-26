// @vitest-environment happy-dom
// (#549) 내 정보 > 휴대폰 캘린더: 셸 능력이 없으면 안내만, 있으면 켜기 → 상태 줄과 팀 고르기, 끄기
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const show = vi.fn();
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/ScreenHeader", () => ({ ScreenHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ show }) }));
vi.mock("@/hooks", () => ({
  messageOf: (_e: unknown, f: string) => f,
  useMe: () => ({ data: { id: 7, nickname: "민지" }, error: null, refetch: vi.fn() }),
  useGroups: () => ({
    data: [
      { id: 1, type: "PERSONAL", name: "내 일정", memberCount: 1 },
      { id: 2, type: "TEAM", name: "가족", memberCount: 4 },
    ],
    error: null,
    refetch: vi.fn(),
  }),
}));

const { DeviceCalendarScreen } = await import("../DeviceCalendarScreen");

const APP_UA = "Mozilla/5.0 WhenwemeetApp/1.3.0 (ios) EmailLogin/1 Widget/1 DeviceCalendar/1";
let shellState = { permission: "undetermined", enabled: false, lastSyncedAt: null as string | null, count: 0 };
const posted: { type: string }[] = [];

function installShell(ua: string) {
  Object.defineProperty(navigator, "userAgent", { get: () => ua, configurable: true });
  (window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = {
    postMessage: (data: string) => {
      const m = JSON.parse(data);
      posted.push(m);
      if (m.type === "calendarSyncEnable") shellState = { ...shellState, permission: "granted", enabled: true };
      if (m.type === "calendarSyncDisable") shellState = { ...shellState, enabled: false, count: 0, lastSyncedAt: null };
      if (m.type === "openSettings") return;
      queueMicrotask(() =>
        window.dispatchEvent(
          new CustomEvent("wwm:app", { detail: { v: 1, type: "calendarStatus", id: m.id, canAskAgain: true, failed: false, ...shellState } }),
        ),
      );
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  posted.length = 0;
  shellState = { permission: "undetermined", enabled: false, lastSyncedAt: null, count: 0 };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;
});

describe("DeviceCalendarScreen (#549)", () => {
  it("휴대폰 캘린더를 모르는 앱(1.2.x)은 업데이트 안내만", async () => {
    installShell("Mozilla/5.0 WhenwemeetApp/1.2.0 (ios) EmailLogin/1 Widget/1");
    await act(async () => {
      render(<DeviceCalendarScreen />);
    });
    expect(screen.getByText(/1\.3\.0 이상/)).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(posted).toEqual([]);
  });

  it("켜기: 권한 → 켜짐, 상태 줄과 팀 고르기, 설정 저장. 끄기도", async () => {
    installShell(APP_UA);
    await act(async () => {
      render(<DeviceCalendarScreen />);
    });
    const sw = screen.getByRole("switch", { name: /휴대폰 캘린더에 표시/ });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("넣을 팀")).toBeNull();

    await act(async () => {
      fireEvent.click(sw);
    });
    expect(posted.map((m) => m.type)).toContain("calendarSyncEnable");
    expect(screen.getByRole("switch", { name: /휴대폰 캘린더에 표시/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("아직 맞추지 않았어요");
    expect(JSON.parse(localStorage.getItem("wwm.device-calendar")!)).toEqual({ userId: 7, enabled: true, teams: null });
    expect(screen.getByRole("switch", { name: /가족/ }).getAttribute("aria-checked")).toBe("true");

    // 팀 하나 빼기 → 그 팀만 남김. 마지막 하나는 뺄 수 없다
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /내 일정/ }));
    });
    expect(JSON.parse(localStorage.getItem("wwm.device-calendar")!).teams).toEqual([2]);
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /가족/ }));
    });
    expect(show).toHaveBeenCalledWith("팀을 하나 이상 골라 주세요");
    // 다시 전부 고르면 null (새 팀도 포함)
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /내 일정/ }));
    });
    expect(JSON.parse(localStorage.getItem("wwm.device-calendar")!).teams).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /휴대폰 캘린더에 표시/ }));
    });
    expect(posted.map((m) => m.type)).toContain("calendarSyncDisable");
    expect(JSON.parse(localStorage.getItem("wwm.device-calendar")!).enabled).toBe(false);
  });

  it("권한을 거부한 기기: 설정 열기 안내", async () => {
    installShell(APP_UA);
    shellState = { permission: "denied", enabled: false, lastSyncedAt: null, count: 0 };
    await act(async () => {
      render(<DeviceCalendarScreen />);
    });
    expect(screen.getByText(/캘린더 접근이 꺼져 있어요/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    });
    expect(posted.map((m) => m.type)).toContain("openSettings");
  });
});
