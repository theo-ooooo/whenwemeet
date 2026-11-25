// @vitest-environment happy-dom
// (#528) 관리자 공지 "푸시로도 알리기" (D-287): 켜고 게시하면 확인 창 뒤 push: true, 초안 저장에는 싣지 않음, 이미 보낸 공지는 잠김 + "푸시 보냄: 날짜"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Notice } from "@/lib/types";

const create = vi.fn<(input: Record<string, unknown>) => Promise<unknown>>();
const update = vi.fn<(input: Record<string, unknown>) => Promise<unknown>>();
let notice: Notice | null = null;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/admin/AdminShell", () => ({ AdminTitle: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useAdminNotice: () => ({ data: notice, error: null, isLoading: false, refetch: vi.fn() }),
  useCreateNotice: () => ({ mutate: create, isPending: false, error: null }),
  useUpdateNotice: () => ({ mutate: update, isPending: false, error: null }),
  useDeleteNotice: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

// (#544) 결과 칸은 따로 검사한다 (AdminNoticeResults.test). 여기서는 언제 붙는지만
vi.mock("../admin/AdminNoticeResults", () => ({ AdminNoticeResults: ({ id }: { id: number }) => <section aria-label={`결과 ${id}`} /> }));

const { AdminNoticeForm } = await import("../admin/AdminNoticeForm");

const pushSwitch = () => screen.getByRole("switch", { name: /^푸시로도 알리기/ });
const base: Notice = {
  id: 7,
  title: "점검 안내",
  body: "본문",
  kind: "maintenance",
  pinned: false,
  publishedAt: null,
  pushedAt: null,
  createdAt: "2026-11-25T00:00:00.000Z",
  updatedAt: "2026-11-25T00:00:00.000Z",
};

describe("AdminNoticeForm 푸시 (#528)", () => {
  beforeEach(() => {
    notice = null;
    create.mockReset().mockResolvedValue({ ok: true, data: base });
    update.mockReset().mockResolvedValue({ ok: true, data: base });
  });
  afterEach(cleanup);

  it("새 공지: 켜고 [게시하고 푸시 보내기] → 확인 창 → push: true 로 만든다", async () => {
    render(<AdminNoticeForm id={null} />);
    fireEvent.change(screen.getByLabelText(/^제목/), { target: { value: "새 기능" } });
    fireEvent.change(screen.getByLabelText("본문"), { target: { value: "볼까가 생겼어요" } });
    fireEvent.click(pushSwitch());
    fireEvent.click(screen.getByRole("button", { name: "게시하고 푸시 보내기" }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText("모든 사용자에게 푸시를 보낼까요?")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "게시하고 보내기" }));
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: "새 기능", published: true, push: true }));
  });

  it("초안: 켜 두어도 [초안 저장] 에는 push 를 싣지 않는다", async () => {
    notice = { ...base };
    render(<AdminNoticeForm id={7} />);
    fireEvent.click(pushSwitch());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 7, published: false }));
    expect(update.mock.calls[0][0]).not.toHaveProperty("push");
  });

  it("이미 보낸 공지: 켜진 채 잠기고 보낸 시각, [저장] 은 push 없이", async () => {
    notice = { ...base, publishedAt: "2026-11-24T01:00:00.000Z", pushedAt: "2026-11-24T01:00:00.000Z" };
    render(<AdminNoticeForm id={7} />);
    const sw = pushSwitch() as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("푸시 보냄: 2026.11.24 10:00")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
    });
    expect(update.mock.calls[0][0]).not.toHaveProperty("push");
  });

  it("(#538) 팝업으로 띄우기: 켜고 게시하면 popup: true, 저장된 값으로 시작한다", async () => {
    render(<AdminNoticeForm id={null} />);
    fireEvent.change(screen.getByLabelText(/^제목/), { target: { value: "점검" } });
    fireEvent.change(screen.getByLabelText("본문"), { target: { value: "새벽 점검" } });
    const sw = screen.getByRole("switch", { name: /^팝업으로 띄우기/ });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "게시" }));
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ popup: true, published: true }));
    cleanup();

    notice = { ...base, popup: true };
    render(<AdminNoticeForm id={7} />);
    expect(screen.getByRole("switch", { name: /^팝업으로 띄우기/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("(#544) 결과 칸: 게시된 공지와 푸시를 보낸 공지(게시 취소했어도)에만, 새 공지와 초안에는 없다", () => {
    render(<AdminNoticeForm id={null} />);
    expect(screen.queryByLabelText(/^결과/)).toBeNull();
    cleanup();
    notice = { ...base };
    render(<AdminNoticeForm id={7} />);
    expect(screen.queryByLabelText(/^결과/)).toBeNull();
    cleanup();
    notice = { ...base, publishedAt: "2026-11-24T01:00:00.000Z" };
    render(<AdminNoticeForm id={7} />);
    expect(screen.getByLabelText("결과 7")).toBeTruthy();
    cleanup();
    notice = { ...base, publishedAt: null, pushedAt: "2026-11-24T01:00:00.000Z" };
    render(<AdminNoticeForm id={7} />);
    expect(screen.getByLabelText("결과 7")).toBeTruthy();
  });
});
