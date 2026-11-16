// @vitest-environment happy-dom
// (#450) 넓은 화면 볼까 패널: 머리줄(볼까, AI 비서, 팀 이름), ✕ 와 Esc 로 닫기(모달이 떠 있으면 Esc 는 그쪽), 열면 입력으로 포커스, 키 없음 안내
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let assistant = { available: true, consented: true };
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useMe: () => ({ data: { assistant: { ...assistant, dailyLimit: 30, usedToday: 0 } }, error: null, isLoading: false, refetch: vi.fn(), setData: vi.fn() }),
  useSendAssistantMessage: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useAssistantConsent: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useCreateEvent: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useCreatePoll: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock("../AppShell", () => ({
  useGroupContext: () => ({ groupId: 2, group: { id: 2, type: "TEAM", name: "우리 둘", members: [], me: { userId: 1 } }, eventsChanged: vi.fn() }),
}));
vi.mock("../Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/lib/useLayout", () => ({ useLayout: () => "pc" }));

const { AssistantProvider } = await import("../AssistantProvider");
const { AssistantPanel } = await import("../AssistantPanel");

function renderPanel(onClose = vi.fn()) {
  render(
    <AssistantProvider groupId={2}>
      <AssistantPanel onClose={onClose} />
    </AssistantProvider>,
  );
  return onClose;
}

afterEach(() => {
  cleanup();
  assistant = { available: true, consented: true };
  document.body.innerHTML = "";
});

describe("AssistantPanel (#450)", () => {
  it("머리줄과 넓은 화면 placeholder, 열면 입력에 포커스", () => {
    renderPanel();
    expect(screen.getByRole("complementary", { name: "볼까" })).toBeTruthy();
    expect(screen.getByText("AI 비서")).toBeTruthy();
    expect(screen.getByText("우리 둘")).toBeTruthy();
    const input = screen.getByLabelText("볼까에게 보낼 글") as HTMLTextAreaElement;
    expect(input.placeholder).toBe("볼까에게 적어 주세요");
    expect(document.activeElement).toBe(input);
  });

  it("✕ 와 Esc 로 닫는다. 모달(투표 고치기 시트)이 떠 있으면 Esc 는 패널을 닫지 않는다", () => {
    const onClose = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("서버에 키가 없으면 안내만", () => {
    assistant = { available: false, consented: false };
    renderPanel();
    expect(screen.getByText("지금은 볼까를 쓸 수 없어요")).toBeTruthy();
    expect(screen.queryByLabelText("볼까에게 보낼 글")).toBeNull();
  });
});
