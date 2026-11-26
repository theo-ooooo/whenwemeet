// @vitest-environment happy-dom
// (#511) 볼까 고치기, 지우기 카드 (D-283): 전 → 후 보이기, [수정] → 기존 PATCH(반복은 이 회차만, assistant 출처), [고치기] → 수정 화면,
// [삭제] → 기존 DELETE + 되돌리기 7초 토스트, [취소], 고르기 카드 → 웹이 확인 카드를 만든다
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMeta, AssistantReply, EventTarget } from "@/lib/assistant";

type Outcome = { ok: true; data: unknown; error: null } | { ok: false; data: null; error: { status: number; code: string; message: string } };
const send = vi.fn<(input: { text: string; history?: unknown }) => Promise<Outcome>>();
const updateEvent = vi.fn<(input: unknown) => Promise<Outcome>>();
const deleteEvent = vi.fn<(input: unknown) => Promise<Outcome>>();
const restoreEvent = vi.fn<(id: number) => Promise<Outcome>>();
const updateOpts = vi.fn();
const deleteOpts = vi.fn();
let me: { assistant?: AssistantMeta } = {};

vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useMe: () => ({ data: me, error: null, isLoading: false, refetch: vi.fn(async () => {}), setData: vi.fn() }),
  useSendAssistantMessage: () => ({ mutate: send, isPending: false, error: null }),
  useAssistantConsent: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useCreateEvent: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useCreatePoll: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUpdateEvent: (_g: number, opts: unknown) => {
    updateOpts(opts);
    return { mutate: updateEvent, isPending: false, error: null };
  },
  useDeleteEvent: (_g: number, opts: unknown) => {
    deleteOpts(opts);
    return { mutate: deleteEvent, isPending: false, error: null };
  },
  useRestoreEvent: () => ({ mutate: restoreEvent, isPending: false, error: null }),
}));
const members = [
  { userId: 1, displayName: "민지", color: "#3B82F6", profileImageUrl: null },
  { userId: 2, displayName: "하늘", color: "#EAB308", profileImageUrl: null },
];
const eventsChanged = vi.fn();
const eventsRestored = vi.fn();
vi.mock("../AppShell", () => ({
  useGroupContext: () => ({ groupId: 2, group: { id: 2, type: "TEAM", name: "우리 둘", members, me: { ...members[0] } }, eventsChanged, eventsRestored }),
}));
const toast = vi.fn();
vi.mock("../Toast", () => ({ useToast: () => ({ show: toast }) }));
vi.mock("@/lib/useLayout", () => ({ useLayout: () => "phone" }));

const { AssistantProvider } = await import("../AssistantProvider");
const { AssistantChat } = await import("../AssistantChat");

const kst = (local: string) => new Date(`${local}+09:00`).toISOString();
const ok = (data: unknown): Outcome => ({ ok: true, data, error: null });
const fail = (status: number, code: string, message = ""): Outcome => ({ ok: false, data: null, error: { status, code, message } });

const target: EventTarget = {
  id: 7,
  publicCode: "abc123",
  occurrence: null,
  repeat: false,
  title: "회식",
  startsAt: kst("2030-11-29T19:00"),
  endsAt: kst("2030-11-29T21:00"),
  allDay: false,
  place: null,
  members,
};
const weekly: EventTarget = {
  ...target,
  id: 8,
  publicCode: "wk1234",
  title: "주간 회의",
  occurrence: "2030-12-02",
  repeat: true,
  startsAt: kst("2030-12-02T10:00"),
  endsAt: kst("2030-12-02T11:00"),
};
const after = { title: "회식", startsAt: kst("2030-11-29T19:30"), endsAt: kst("2030-11-29T21:30"), allDay: false, place: { text: "강남" } };
const reply = (text: string, cards: AssistantReply["cards"]): Outcome => ok({ reply: text, cards, historyText: "[기록]", usage: { used: 1, limit: 30 } });

function renderChat() {
  return render(
    <AssistantProvider groupId={2}>
      <AssistantChat variant="screen" />
    </AssistantProvider>,
  );
}
async function type(text: string) {
  fireEvent.change(screen.getByLabelText("볼까에게 보낼 글"), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  });
}

beforeEach(() => {
  me = { assistant: { available: true, consented: true, dailyLimit: 30, usedToday: 0 } };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("볼까 고치기 카드 (#511)", () => {
  it("바뀐 칸은 전 값(지운 줄)과 새 값, [수정] 은 기존 PATCH 를 assistant 출처로 한 번, 뒤에는 '회식을 고쳤어요.' + 달력에서 보기", async () => {
    send.mockResolvedValue(reply("이렇게 고칠까요?", [{ type: "eventEditDraft", draft: { target, after } }]));
    updateEvent.mockResolvedValue(ok({ id: 7, title: "회식", publicCode: "abc123", startsAt: after.startsAt, occurrence: null }));
    renderChat();
    await type("금요일 회식 7시 반으로 강남에서");
    expect(screen.getByText("일정 고치기")).toBeTruthy();
    expect(screen.getByText("11월 29일 (금) 오후 7:00 ~ 9:00")).toBeTruthy();
    expect(screen.getByText("11월 29일 (금) 오후 7:30 ~ 9:30")).toBeTruthy();
    expect(screen.getByText("장소 없음")).toBeTruthy();
    expect(screen.getByText("강남")).toBeTruthy();
    expect(screen.getByRole("link", { name: "회식 수정 화면에서 고치기" }).getAttribute("href")).toBe("/events/abc123/edit");
    expect(updateOpts).toHaveBeenCalledWith({ source: "assistant" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "회식 수정" }));
    });
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(updateEvent).toHaveBeenCalledWith({
      eventId: 7,
      input: { title: "회식", startsAt: after.startsAt, endsAt: after.endsAt, allDay: false, place: { text: "강남" } },
    });
    expect(screen.getByText("'회식'을 고쳤어요.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "달력에서 보기" }).getAttribute("href")).toContain("date=2030-11-29");
    expect(toast).toHaveBeenCalledWith("'회식'을 고쳤어요");
    expect(eventsChanged).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "회식 수정" })).toBeNull();
  });

  it("반복 회차는 이 회차만(scope this + occurrence), [고치기] 는 그 회차 수정 화면, 404 는 '이미 삭제된 일정이에요'", async () => {
    const weeklyAfter = { ...after, title: "주간 회의", startsAt: kst("2030-12-02T11:00"), endsAt: kst("2030-12-02T12:00"), place: null };
    send.mockResolvedValue(reply("이렇게 고칠까요?", [{ type: "eventEditDraft", draft: { target: weekly, after: weeklyAfter } }]));
    updateEvent.mockResolvedValueOnce(fail(404, "NOT_FOUND"));
    renderChat();
    await type("다음 주 월요일 주간 회의 11시로");
    expect(screen.getByText("일정 고치기 (이 일정만)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "주간 회의 수정 화면에서 고치기" }).getAttribute("href")).toBe(
      "/events/wk1234/edit?occurrence=2030-12-02&scope=this",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "주간 회의 수정" }));
    });
    expect(updateEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: 8, occurrence: "2030-12-02", scope: "this" }));
    expect((updateEvent.mock.calls[0][0] as { input: Record<string, unknown> }).input).not.toHaveProperty("place");
    expect(toast).toHaveBeenCalledWith("이미 삭제된 일정이에요");
    // 실패면 버튼이 남는다
    expect(screen.getByRole("button", { name: "주간 회의 수정" })).toBeTruthy();
  });
});

describe("볼까 지우기 카드 (#511)", () => {
  it("[삭제] 는 기존 DELETE 를 assistant 출처로, 되돌리기 7초 토스트, 카드는 '회식을 지웠어요.'", async () => {
    send.mockResolvedValue(reply("이 일정을 지울까요?", [{ type: "eventDeleteDraft", target }]));
    deleteEvent.mockResolvedValue(ok({ ok: true, deletionId: 55 }));
    restoreEvent.mockResolvedValue(ok({ ok: true, eventId: 7, occurrence: null }));
    renderChat();
    await type("금요일 회식 지워 줘");
    expect(screen.getByText("일정 지우기")).toBeTruthy();
    expect(screen.getByText("11월 29일 (금) 오후 7:00 ~ 9:00")).toBeTruthy();
    expect(deleteOpts).toHaveBeenCalledWith({ source: "assistant" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "회식 삭제" }));
    });
    expect(deleteEvent).toHaveBeenCalledWith({ eventId: 7 });
    expect(screen.getByText("'회식'을 지웠어요.")).toBeTruthy();
    expect(eventsChanged).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("일정을 삭제했어요", expect.objectContaining({ actionLabel: "되돌리기", duration: 7000 }));
    // 되돌리기
    const opts = toast.mock.calls.find((c) => c[0] === "일정을 삭제했어요")![1] as { onAction: () => Promise<void> };
    await act(async () => {
      await opts.onAction();
    });
    expect(restoreEvent).toHaveBeenCalledWith(55);
    expect(eventsRestored).toHaveBeenCalled();
  });

  it("반복 회차는 이 회차만 지운다, [취소] 는 요청 없이 '지우지 않았어요.'", async () => {
    send.mockResolvedValue(
      reply("이 일정을 지울까요?", [
        { type: "eventDeleteDraft", target: weekly },
        { type: "eventDeleteDraft", target },
      ]),
    );
    deleteEvent.mockResolvedValue(ok({ ok: true, deletionId: 56 }));
    renderChat();
    await type("주간 회의 지워");
    expect(screen.getByText("일정 지우기 (이 일정만)")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "주간 회의 삭제" }));
    });
    expect(deleteEvent).toHaveBeenCalledWith({ eventId: 8, occurrence: "2030-12-02", scope: "this" });
    fireEvent.click(screen.getByRole("button", { name: "회식 지우기 취소" }));
    expect(screen.getByText("지우지 않았어요.")).toBeTruthy();
    expect(deleteEvent).toHaveBeenCalledTimes(1);
  });
});

describe("볼까 고르기 카드 (#511)", () => {
  it("후보를 누르면 그 후보의 확인 카드를 웹이 만든다(서버 요청 없음), 한 번만 고른다, 넘는 개수 안내", async () => {
    const second: EventTarget = { ...target, id: 9, publicCode: "xyz789", startsAt: kst("2030-12-06T19:00"), endsAt: kst("2030-12-06T21:00") };
    send.mockResolvedValue(
      reply("일정이 6개 있어요. 어느 일정을 지울까요?", [
        {
          type: "eventChoice",
          action: "delete",
          options: [
            { target, after: null },
            { target: second, after: null },
          ],
          more: 4,
        },
      ]),
    );
    renderChat();
    await type("회식 지워");
    expect(screen.getByText("지울 일정을 골라 주세요")).toBeTruthy();
    expect(screen.getByText("외 4개는 날짜를 넣어 다시 말해 주세요")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "회식 12월 6일 (금) 오후 7:00 ~ 9:00 고르기" }));
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("article", { name: "일정 지우기 회식" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "회식 11월 29일 (금) 오후 7:00 ~ 9:00 고르기" }) as HTMLButtonElement).disabled).toBe(true);
    deleteEvent.mockResolvedValue(ok({ ok: true, deletionId: 57 }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "회식 삭제" }));
    });
    expect(deleteEvent).toHaveBeenCalledWith({ eventId: 9 });
  });

  it("고치기 후보는 고친 뒤 값과 함께 고치기 카드가 된다", async () => {
    send.mockResolvedValue(
      reply("일정이 2개 있어요. 어느 일정을 고칠까요?", [
        {
          type: "eventChoice",
          action: "edit",
          options: [
            { target, after },
            { target: weekly, after: { ...after, title: "주간 회의" } },
          ],
          more: 0,
        },
      ]),
    );
    renderChat();
    await type("7시 반으로");
    expect(screen.getByText("고칠 일정을 골라 주세요")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "회식 11월 29일 (금) 오후 7:00 ~ 9:00 고르기" }));
    });
    expect(screen.getByRole("article", { name: "일정 고치기 회식" })).toBeTruthy();
    expect(screen.getByText("11월 29일 (금) 오후 7:30 ~ 9:30")).toBeTruthy();
  });
});
