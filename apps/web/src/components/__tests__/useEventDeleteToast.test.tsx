// @vitest-environment happy-dom
// (#375) 일정 삭제 토스트: 7초 되돌리기, 되돌리면 달력에 알림, 실패 문구 (D-251)
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Outcome = { ok: true; data: unknown; error: null } | { ok: false; data: null; error: { message?: string; status?: number } };
const show = vi.fn();
const mutate = vi.fn<(deletionId: number) => Promise<Outcome>>();
const eventsRestored = vi.fn();

vi.mock("@/components/Toast", () => ({ useToast: () => ({ show }) }));
vi.mock("@/components/AppShell", () => ({ useGroupContext: () => ({ eventsRestored }) }));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useRestoreEvent: () => ({ mutate, isPending: false, error: null }),
}));

const { UNDO_TOAST_MS, useEventDeleteToast } = await import("../useEventDeleteToast");

type ToastOpts = { actionLabel?: string; duration?: number; onAction?: () => Promise<void> };
const lastOpts = () => show.mock.calls.at(-1)?.[1] as ToastOpts | undefined;

describe("useEventDeleteToast (#375)", () => {
  beforeEach(() => {
    show.mockReset();
    mutate.mockReset();
    eventsRestored.mockReset();
  });
  afterEach(cleanup);

  it("삭제 토스트에 7초 되돌리기. 누르면 되돌리고 달력에 알린 뒤 '되돌렸어요'", async () => {
    mutate.mockResolvedValue({ ok: true, data: { ok: true, eventId: 1, occurrence: null }, error: null });
    const { result } = renderHook(() => useEventDeleteToast(2));
    result.current(42);
    expect(show).toHaveBeenCalledWith("일정을 삭제했어요", expect.objectContaining({ actionLabel: "되돌리기", duration: 7000 }));
    expect(UNDO_TOAST_MS).toBe(7000);
    await act(async () => {
      await lastOpts()!.onAction!();
    });
    expect(mutate).toHaveBeenCalledWith(42);
    expect(eventsRestored).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenLastCalledWith("일정을 되돌렸어요");
  });

  it("되돌리기 실패는 서버 문구(없으면 기본 문구), 달력에 알리지 않는다", async () => {
    mutate.mockResolvedValue({ ok: false, data: null, error: { status: 409, message: "그 사이 일정이 바뀌어서 되돌리지 못했어요" } });
    const { result } = renderHook(() => useEventDeleteToast(2));
    result.current(7);
    await act(async () => {
      await lastOpts()!.onAction!();
    });
    expect(show).toHaveBeenLastCalledWith("그 사이 일정이 바뀌어서 되돌리지 못했어요");
    expect(eventsRestored).not.toHaveBeenCalled();

    mutate.mockResolvedValue({ ok: false, data: null, error: { status: 0 } });
    result.current(8);
    await act(async () => {
      await lastOpts()!.onAction!();
    });
    expect(show).toHaveBeenLastCalledWith("되돌리지 못했어요. 다시 시도해 주세요");
  });

  it("deletionId 가 없으면(예전 API) 버튼 없이 알린다", () => {
    const { result } = renderHook(() => useEventDeleteToast(2));
    result.current(undefined);
    expect(show).toHaveBeenCalledWith("일정을 삭제했어요");
    expect(lastOpts()).toBeUndefined();
  });
});
