// @vitest-environment happy-dom
// (#536) 신고 시트: 사유를 골라야 신고 버튼이 켜지고, 보낸 뒤 토스트와 닫기. 접수 중 중복은 "이미 신고했어요", 실패는 시트 안 오류
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Outcome = { ok: true; data: { duplicate: boolean }; error: null } | { ok: false; data: null; error: { message?: string } };
const mutate = vi.fn<(input: Record<string, unknown>) => Promise<Outcome>>();
const show = vi.fn();

vi.mock("@/components/Toast", () => ({ useToast: () => ({ show }) }));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useCreateReport: () => ({ mutate, isPending: false, error: null }),
}));

const { ReportSheet } = await import("../ReportSheet");

describe("ReportSheet (#536)", () => {
  beforeEach(() => {
    mutate.mockReset();
    show.mockReset();
  });
  afterEach(cleanup);

  it("대상이 없으면 그리지 않는다", () => {
    render(<ReportSheet target={null} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("사유를 고르고 내용을 적어 보내면 토스트, 닫기. 내용은 앞뒤 공백을 자른다", async () => {
    const onClose = vi.fn();
    mutate.mockResolvedValue({ ok: true, data: { duplicate: false }, error: null });
    render(<ReportSheet target={{ targetType: "event", targetId: 9 }} onClose={onClose} />);
    expect(screen.getByRole("heading", { name: "일정 신고" })).toBeTruthy();
    const submit = screen.getByRole("button", { name: "신고" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "스팸, 광고" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  링크 광고  " } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await act(async () => fireEvent.click(submit));
    expect(mutate).toHaveBeenCalledWith({ targetType: "event", targetId: 9, reason: "spam", detail: "링크 광고" });
    expect(show).toHaveBeenCalledWith("신고했어요. 확인 후 조치할게요");
    expect(onClose).toHaveBeenCalled();
  });

  it("중복은 '이미 신고했어요', 실패는 시트를 닫지 않고 오류", async () => {
    const onClose = vi.fn();
    mutate.mockResolvedValueOnce({ ok: true, data: { duplicate: true }, error: null });
    render(<ReportSheet target={{ targetType: "user", targetId: 2, name: "하늘" }} onClose={onClose} />);
    expect(screen.getByRole("heading", { name: "하늘 신고" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "욕설, 괴롭힘" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "신고" })));
    expect(mutate.mock.lastCall![0]).not.toHaveProperty("detail");
    expect(show).toHaveBeenCalledWith("이미 신고했어요. 확인 후 조치할게요");
    onClose.mockClear();
    mutate.mockResolvedValueOnce({ ok: false, data: null, error: { message: "잠시 후 다시 시도해 주세요" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "신고" })));
    expect(screen.getByRole("alert").textContent).toBe("잠시 후 다시 시도해 주세요");
    expect(onClose).not.toHaveBeenCalled();
  });
});
