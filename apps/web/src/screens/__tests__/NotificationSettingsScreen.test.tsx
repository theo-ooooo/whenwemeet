// @vitest-environment happy-dom
// (#277) 알림 설정: "주간 요약"(기본 켬)과 "다 같이 비는 시간"(조용한 팀 깨우기, 기본 끔 D-204) 토글이 보이고 바꾼 키만 저장, 실패하면 되돌림
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationSettings } from "@/lib/types";

const mutate = vi.fn<(input: Partial<NotificationSettings>) => Promise<unknown>>();
const show = vi.fn();
let data: NotificationSettings | null;
const setData = vi.fn((next: NotificationSettings) => {
  data = next;
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ show }) }));
vi.mock("@/components/ReminderPicker", () => ({ usePushNote: () => "알림은 앱에서 받을 수 있어요" }));
vi.mock("@/lib/app-bridge", () => ({ appSupportsPush: () => false, openAppSettings: vi.fn(), requestPushStatus: vi.fn() }));
vi.mock("@/lib/push", () => ({ canAskPermission: () => false, recordPrompt: vi.fn() }));
vi.mock("@/lib/usePushSync", () => ({ usePushRegistrar: () => vi.fn(), usePushSync: vi.fn() }));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useNotificationSettings: () => ({ data, error: null, isLoading: false, refetch: vi.fn(), setData }),
  useUpdateNotificationSettings: () => ({ mutate, isPending: false, error: null }),
}));

const { NotificationSettingsScreen } = await import("../NotificationSettingsScreen");

const DEFAULTS: NotificationSettings = { reminder: true, change: true, anniversary: true, join: true, weekly: true, weeklyNudge: false };
const switchOf = (name: string) => screen.getByRole("switch", { name: new RegExp(`^${name}`) });

describe("NotificationSettingsScreen (#277)", () => {
  beforeEach(() => {
    data = { ...DEFAULTS };
    mutate.mockReset();
    show.mockReset();
    setData.mockClear();
  });
  afterEach(cleanup);

  it("받을 알림 6줄. 주간 요약은 켬, 다 같이 비는 시간은 끔", () => {
    render(<NotificationSettingsScreen />);
    expect(screen.getAllByRole("switch")).toHaveLength(6);
    expect(switchOf("주간 요약").getAttribute("aria-checked")).toBe("true");
    expect(switchOf("다 같이 비는 시간").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("월요일 아침 9시에 그 주 팀 일정을 알려 드려요")).toBeTruthy();
  });

  it("다 같이 비는 시간을 켜면 그 키만 PATCH, 응답으로 맞춘다", async () => {
    mutate.mockResolvedValue({ ok: true, data: { ...DEFAULTS, weeklyNudge: true }, error: null });
    render(<NotificationSettingsScreen />);
    await act(async () => {
      fireEvent.click(switchOf("다 같이 비는 시간"));
    });
    expect(mutate).toHaveBeenCalledWith({ weeklyNudge: true });
    expect(setData).toHaveBeenLastCalledWith({ ...DEFAULTS, weeklyNudge: true });
  });

  it("주간 요약 저장이 실패하면 되돌리고 토스트", async () => {
    mutate.mockResolvedValue({ ok: false, data: null, error: { message: "" } });
    render(<NotificationSettingsScreen />);
    await act(async () => {
      fireEvent.click(switchOf("주간 요약"));
    });
    expect(mutate).toHaveBeenCalledWith({ weekly: false });
    expect(setData).toHaveBeenLastCalledWith(DEFAULTS);
    expect(show).toHaveBeenCalledWith("알림 설정을 바꾸지 못했어요. 다시 시도해 주세요");
  });
});
