// @vitest-environment happy-dom
// (#450) 볼까 대화: 동의 막기, 예시 보내기, 카드 [추가] → 기존 일정 만들기(X-Client-Source assistant), 오류 말풍선과 다시 보내기,
// 400 은 입력 아래 한 줄, 하루 한도 안내, 남은 횟수, 빈 시간 → 웹 투표 초안, 알약은 available 일 때만
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMeta, AssistantReply } from "@/lib/assistant";

type Outcome = { ok: true; data: unknown; error: null } | { ok: false; data: null; error: { status: number; code: string; message: string } };
const send = vi.fn<(input: { text: string; history?: unknown }) => Promise<Outcome>>();
const consent = vi.fn<() => Promise<Outcome>>();
const createEvent = vi.fn<(input: unknown) => Promise<Outcome>>();
const createPoll = vi.fn<(input: unknown) => Promise<Outcome>>();
const createEventOpts = vi.fn();
const createPollOpts = vi.fn();
const refetchMe = vi.fn(async () => {});
let me: { assistant?: AssistantMeta } = {};

vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useMe: () => ({ data: me, error: null, isLoading: false, refetch: refetchMe, setData: vi.fn() }),
  useSendAssistantMessage: () => ({ mutate: send, isPending: false, error: null }),
  useAssistantConsent: () => ({ mutate: consent, isPending: false, error: null }),
  useCreateEvent: (_g: number, opts: unknown) => {
    createEventOpts(opts);
    return { mutate: createEvent, isPending: false, error: null };
  },
  useCreatePoll: (_g: number, opts: unknown) => {
    createPollOpts(opts);
    return { mutate: createPoll, isPending: false, error: null };
  },
}));
const members = [
  { userId: 1, displayName: "민지", color: "#3B82F6", profileImageUrl: null },
  { userId: 2, displayName: "하늘", color: "#EAB308", profileImageUrl: null },
];
const eventsChanged = vi.fn();
vi.mock("../AppShell", () => ({
  useGroupContext: () => ({ groupId: 2, group: { id: 2, type: "TEAM", name: "우리 둘", members, me: { ...members[0] } }, eventsChanged }),
}));
const toast = vi.fn();
vi.mock("../Toast", () => ({ useToast: () => ({ show: toast }) }));
vi.mock("@/lib/useLayout", () => ({ useLayout: () => "phone" }));

const { AssistantProvider } = await import("../AssistantProvider");
const { AssistantChat } = await import("../AssistantChat");
const { AssistantPill } = await import("../AssistantPill");

const kst = (local: string) => new Date(`${local}+09:00`).toISOString();
const ok = (data: unknown): Outcome => ({ ok: true, data, error: null });
const fail = (status: number, code: string, message = ""): Outcome => ({ ok: false, data: null, error: { status, code, message } });
const draftReply: AssistantReply = {
  reply: "이렇게 넣을까요?",
  cards: [
    {
      type: "eventDraft",
      draft: { title: "강남 회식", startsAt: kst("2030-11-29T19:00"), endsAt: kst("2030-11-29T20:00"), allDay: false, place: { text: "강남" }, participants: [1, 2], members },
    },
  ],
  historyText: "[일정 초안] 강남 회식",
  usage: { used: 1, limit: 30 },
};

function renderChat() {
  return render(
    <AssistantProvider groupId={2}>
      <AssistantChat variant="screen" />
    </AssistantProvider>,
  );
}
const input = () => screen.getByLabelText("볼까에게 보낼 글") as HTMLTextAreaElement;
async function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  });
}

beforeEach(() => {
  me = { assistant: { available: true, consented: true, dailyLimit: 30, usedToday: 0 } };
  // happy-dom 에는 scrollIntoView 가 없다
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AssistantChat (#450)", () => {
  it("동의 전: 안내 카드, 입력 막힘. [동의하고 시작] → 동의 요청 → 빈 상태와 예시", async () => {
    me = { assistant: { available: true, consented: false, dailyLimit: 30, usedToday: 0 } };
    consent.mockResolvedValue(ok({ consentedAt: "2030-11-16T00:00:00.000Z" }));
    renderChat();
    expect(screen.getByRole("heading", { name: "볼까를 쓰기 전에" })).toBeTruthy();
    expect(input().disabled).toBe(true);
    expect(screen.getByRole("link", { name: "개인정보처리방침" }).getAttribute("href")).toBe("/privacy#assistant");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "동의하고 시작" }));
    });
    expect(consent).toHaveBeenCalledTimes(1);
    expect(refetchMe).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /AI 비서 볼까예요/ })).toBeTruthy();
    expect(input().disabled).toBe(false);
  });

  it("예시를 누르면 바로 보내고, 일정 초안 카드 [추가] 는 기존 일정 만들기를 assistant 출처로 한 번 부른다", async () => {
    send.mockResolvedValue(ok(draftReply));
    createEvent.mockResolvedValue(ok({ id: 9, title: "강남 회식", startsAt: kst("2030-11-29T19:00") }));
    renderChat();
    // 예시 두 번째는 둘이 쓰는 팀 문구
    expect(screen.getByRole("button", { name: /둘 다 되는 저녁/ })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /다음 주 금요일 7시 강남 회식/ }));
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: "다음 주 금요일 7시 강남 회식 잡아줘", history: undefined }));
    expect(within(screen.getByRole("log")).getByText("이렇게 넣을까요?")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "강남 회식" })).toBeTruthy();
    expect(screen.getByText("11월 29일 (금) 오후 7:00 ~ 8:00")).toBeTruthy();
    expect(screen.getByText("나, 하늘")).toBeTruthy();
    const edit = screen.getByRole("link", { name: "강남 회식 고치기" }).getAttribute("href")!;
    expect(edit).toContain("/events/new?");
    expect(edit).toContain("from=assistant");
    expect(createEventOpts).toHaveBeenCalledWith(expect.objectContaining({ source: "assistant" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "강남 회식 추가" }));
    });
    expect(createEvent).toHaveBeenCalledWith({
      title: "강남 회식",
      startsAt: kst("2030-11-29T19:00"),
      endsAt: kst("2030-11-29T20:00"),
      allDay: false,
      participants: [1, 2],
      place: { text: "강남" },
    });
    expect(eventsChanged).toHaveBeenCalled();
    expect(screen.getByText("'강남 회식'을 넣었어요.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "달력에서 보기" }).getAttribute("href")).toBe("/calendar?date=2030-11-29");
    expect(screen.queryByRole("button", { name: "강남 회식 추가" })).toBeNull();

    // 다음 요청에는 앞 턴(내 글 + historyText)이 실린다
    send.mockResolvedValue(ok({ ...draftReply, cards: [], reply: "무엇을 도와 드릴까요?", historyText: "[인사]" }));
    await type("고마워");
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: "고마워",
        history: [
          { role: "user", text: "다음 주 금요일 7시 강남 회식 잡아줘" },
          { role: "assistant", text: "[일정 초안] 강남 회식" },
        ],
      }),
    );
  });

  it("[추가] 가 실패하면 서버 문구 토스트, 카드는 그대로", async () => {
    send.mockResolvedValue(ok(draftReply));
    createEvent.mockResolvedValue(fail(400, "VALIDATION_FAILED", "참여자를 다시 골라 주세요"));
    renderChat();
    await type("회식 잡아줘");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "강남 회식 추가" }));
    });
    expect(toast).toHaveBeenCalledWith("참여자를 다시 골라 주세요");
    expect(screen.getByRole("button", { name: "강남 회식 추가" })).toBeTruthy();
  });

  it("503 은 오류 말풍선 + 다시 보내기(같은 글, 내 말풍선은 하나)", async () => {
    send.mockResolvedValueOnce(fail(503, "ASSISTANT_UNAVAILABLE", "지금은 볼까를 쓸 수 없어요. 잠시 후 다시 해 주세요"));
    renderChat();
    await type("이번 주에 뭐 있어?");
    expect(screen.getByRole("alert").textContent).toContain("지금은 볼까를 쓸 수 없어요");
    send.mockResolvedValueOnce(ok({ ...draftReply, reply: "이번 주에는 일정이 없어요", cards: [], historyText: "[일정 목록] 없음" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다시 보내기" }));
    });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ text: "이번 주에 뭐 있어?", history: undefined }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByText("이번 주에 뭐 있어?")).toHaveLength(1);
    expect(within(screen.getByRole("log")).getByText("이번 주에는 일정이 없어요")).toBeTruthy();
  });

  it("네트워크 실패는 '연결이 불안정해요', 분당 제한은 '잠시 후 다시 보내 주세요'", async () => {
    send.mockResolvedValueOnce(fail(0, "NETWORK"));
    renderChat();
    await type("a");
    expect(screen.getByRole("alert").textContent).toContain("연결이 불안정해요");
    send.mockResolvedValueOnce(fail(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요"));
    await type("b");
    expect(screen.getAllByRole("alert")[1].textContent).toContain("잠시 후 다시 보내 주세요");
  });

  it("400 은 말풍선을 만들지 않고 입력 아래 한 줄, 글은 입력에 돌려 둔다", async () => {
    send.mockResolvedValue(fail(400, "VALIDATION_FAILED", "300자까지 보낼 수 있어요"));
    renderChat();
    await type("너무 긴 글");
    expect(screen.getByText("300자까지 보낼 수 있어요")).toBeTruthy();
    expect(input().value).toBe("너무 긴 글");
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("409 동의 없음이면 안내 카드로 돌아간다", async () => {
    send.mockResolvedValue(fail(409, "ASSISTANT_CONSENT_REQUIRED", "먼저 안내를 확인해 주세요"));
    renderChat();
    await type("안녕");
    expect(screen.getByRole("heading", { name: "볼까를 쓰기 전에" })).toBeTruthy();
  });

  it("하루 한도: 입력 대신 안내와 '직접 일정 추가'", async () => {
    send.mockResolvedValue(fail(429, "ASSISTANT_DAILY_LIMIT", "오늘은 볼까를 30번 다 썼어요"));
    renderChat();
    await type("안녕");
    expect(screen.getByText("오늘은 30번 다 썼어요. 내일 다시 만나요")).toBeTruthy();
    expect(screen.getByRole("link", { name: /직접 일정 추가/ }).getAttribute("href")).toBe("/events/new");
    expect(screen.queryByLabelText("볼까에게 보낼 글")).toBeNull();
  });

  it("남은 횟수가 5번 이하면 입력 위에 보인다, 250자부터 글자 수", () => {
    me = { assistant: { available: true, consented: true, dailyLimit: 30, usedToday: 26 } };
    renderChat();
    expect(screen.getByText("오늘 4번 남았어요")).toBeTruthy();
    fireEvent.change(input(), { target: { value: "가".repeat(250) } });
    expect(screen.getByText("250/300")).toBeTruthy();
  });

  it("빈 시간 카드 → '이 2개로 투표 열기' 는 서버 요청 없이 투표 초안, [투표 열기] 는 assistant-poll 출처", async () => {
    send.mockResolvedValue(
      ok({
        reply: "2개 찾았어요. 가까운 순으로 2개예요",
        cards: [
          {
            type: "freeSlots",
            query: { from: "", to: "", dayStart: "18:00", dayEnd: "22:00", minMinutes: 120, days: "weekend", participants: [1, 2] },
            slots: [
              { startsAt: kst("2030-11-30T18:00"), endsAt: kst("2030-11-30T22:00") },
              { startsAt: kst("2030-12-01T18:00"), endsAt: kst("2030-12-01T22:00") },
            ],
            total: 2,
            pollTitle: "저녁 약속",
          },
        ],
        historyText: "[빈 시간]",
        usage: { used: 1, limit: 30 },
      } satisfies AssistantReply),
    );
    createPoll.mockResolvedValue(ok({ id: 3, publicCode: "poll1xxx" }));
    renderChat();
    await type("주말 저녁 찾아줘");
    expect(screen.getByText("주말 저녁, 2시간 이상, 2명")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /이 시간으로 일정/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "이 2개로 투표 열기" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "저녁 약속" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "이 2개로 투표 열기" }) as HTMLButtonElement).disabled).toBe(true);
    expect(createPollOpts).toHaveBeenCalledWith(expect.objectContaining({ source: "assistant-poll" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저녁 약속 투표 열기" }));
    });
    expect(createPoll).toHaveBeenCalledWith({
      title: "저녁 약속",
      options: [
        { startsAt: kst("2030-11-30T18:00"), endsAt: kst("2030-11-30T20:00"), allDay: false },
        { startsAt: kst("2030-12-01T18:00"), endsAt: kst("2030-12-01T20:00"), allDay: false },
      ],
      participants: [1, 2],
    });
    expect(screen.getByRole("link", { name: "투표 보기" }).getAttribute("href")).toBe("/polls/poll1xxx");
  });

  it("되묻기 이름 알약은 그 이름을 보낸다, 못 하는 일은 링크 알약", async () => {
    send.mockResolvedValueOnce(ok({ reply: "'민'님이 누구인가요?", cards: [{ type: "clarify", field: "participant", choices: [members[1]] }], historyText: "[되물음]", usage: { used: 1, limit: 30 } }));
    renderChat();
    await type("민이랑 저녁");
    send.mockResolvedValueOnce(
      ok({ reply: "일정 지우기는 아직 못 해요. 일정을 눌러 지울 수 있어요", cards: [{ type: "unsupported", action: "delete_event", link: { label: "달력 열기", href: "/calendar" } }], historyText: "[안내]", usage: { used: 2, limit: 30 } }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "하늘" }));
    });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ text: "하늘" }));
    expect(screen.getByRole("link", { name: "달력 열기" }).getAttribute("href")).toBe("/calendar");
  });

  it("답 글자는 따로 읽어 준다(aria-live), 대화 목록은 role=log", async () => {
    send.mockResolvedValue(ok({ ...draftReply, cards: [{ type: "refusal" }], reply: "볼까는 일정 만들기, 빈 시간 찾기, 투표, 일정 묻기만 도와 드려요" }));
    const { container } = renderChat();
    await type("날씨 어때");
    expect(screen.getByRole("log").getAttribute("aria-live")).toBe("off");
    expect(container.querySelector('p[aria-live="polite"]')?.textContent).toBe("볼까는 일정 만들기, 빈 시간 찾기, 투표, 일정 묻기만 도와 드려요");
    expect(document.activeElement).toBe(input());
  });
});

describe("AssistantPill (#450)", () => {
  it("서버에 키가 없으면(available false) 그리지 않는다", () => {
    me = { assistant: { available: false, consented: false, dailyLimit: 30, usedToday: 0 } };
    render(
      <AssistantProvider groupId={2}>
        <AssistantPill />
      </AssistantProvider>,
    );
    expect(screen.queryByRole("link", { name: /AI 볼까/ })).toBeNull();
  });

  it("옛 API(/me 에 assistant 없음)도 숨긴다", () => {
    me = {};
    render(
      <AssistantProvider groupId={2}>
        <AssistantPill />
      </AssistantProvider>,
    );
    expect(screen.queryByRole("link", { name: /AI 볼까/ })).toBeNull();
  });

  it("available 이면 /assistant 로 가는 알약", () => {
    render(
      <AssistantProvider groupId={2}>
        <AssistantPill />
      </AssistantProvider>,
    );
    expect(screen.getByRole("link", { name: /AI 볼까/ }).getAttribute("href")).toBe("/assistant");
  });
});
