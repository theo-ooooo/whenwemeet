// @vitest-environment happy-dom
// (#539) 관리자 "앱 버전" (D-292): 기종마다 고쳐 저장, 빈 칸은 null, 형식이 틀리거나 최소 > 최신이면 저장 버튼이 꺼진다
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRelease } from "@/lib/types";

const update = vi.fn<(input: Record<string, unknown>) => Promise<unknown>>();
const rows: AppRelease[] = [
  { platform: "ios", latestVersion: "1.4.0", minVersion: "1.1.0", storeUrl: "https://apps.apple.com/kr/app/id6832865813", updatedAt: "2026-11-24T00:00:00.000Z" },
  { platform: "android", latestVersion: null, minVersion: null, storeUrl: "https://play.google.com/store/apps/details?id=day.whenwemeet.app", updatedAt: null },
];

vi.mock("@/components/admin/AdminShell", () => ({ AdminTitle: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useAdminAppReleases: () => ({ data: rows, error: null, isLoading: false, refetch: vi.fn(), setData: vi.fn() }),
  useUpdateAppRelease: () => ({ mutate: update, isPending: false, error: null }),
}));

const { AdminAppVersionsScreen } = await import("../admin/AdminAppVersionsScreen");

const section = (name: string) => screen.getByRole("region", { name });

describe("AdminAppVersionsScreen (#539)", () => {
  beforeEach(() => update.mockReset().mockImplementation(async (input) => ({ ok: true, data: { ...rows[0], ...input } })));
  afterEach(cleanup);

  it("두 기종을 보이고, 고쳐 저장하면 그 기종만 PUT (빈 칸은 null)", async () => {
    render(<AdminAppVersionsScreen />);
    expect(screen.getByText("아직 정하지 않았어요 (안내 없음)")).toBeTruthy();
    const ios = section("iOS");
    fireEvent.change(ios.querySelectorAll("input")[0], { target: { value: "1.5.0" } });
    fireEvent.change(ios.querySelectorAll("input")[1], { target: { value: "" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "iOS 저장" }));
    });
    expect(update).toHaveBeenCalledWith({ platform: "ios", latestVersion: "1.5.0", minVersion: null, storeUrl: "https://apps.apple.com/kr/app/id6832865813" });
    expect(screen.getByRole("status").textContent).toBe("저장했어요");
  });

  it("형식이 틀리거나 최소가 최신보다 높으면 문구와 함께 저장이 꺼진다", () => {
    render(<AdminAppVersionsScreen />);
    const ios = section("iOS");
    fireEvent.change(ios.querySelectorAll("input")[1], { target: { value: "1.10.0" } });
    expect(screen.getByText("최소 버전은 최신 버전보다 높을 수 없어요")).toBeTruthy();
    expect((screen.getByRole("button", { name: "iOS 저장" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(ios.querySelectorAll("input")[1], { target: { value: "v1" } });
    expect(screen.getByText("1.4.0 처럼 숫자와 점으로 적어 주세요")).toBeTruthy();
    fireEvent.change(ios.querySelectorAll("input")[2], { target: { value: "http://x" } });
    expect(screen.getByText("https 로 시작하는 주소를 넣어 주세요")).toBeTruthy();
  });
});
