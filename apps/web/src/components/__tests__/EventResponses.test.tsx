// @vitest-environment happy-dom
// (#190) 일정 상세의 참석 여부와 반응: 참여자만 세그먼트, 집계 한 줄과 사람별 시트, 반응 알약(다시 누르면 취소),
// 403 NOT_PARTICIPANT 는 토스트 후 새로 받기, 시간이 바뀐 응답 안내
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, EventDetailData, Member, ReactionSummary, RsvpSummary } from "@/lib/types";

type Outcome<T> = { ok: true; data: T; error: null } | { ok: false; data: null; error: { code?: string; message?: string } };
const setRsvp = vi.fn<(input: Record<string, unknown>) => Promise<Outcome<RsvpSummary>>>();
const setReaction = vi.fn<(input: Record<string, unknown>) => Promise<Outcome<ReactionSummary>>>();
const refetch = vi.fn();
const show = vi.fn();
let detail: EventDetailData | null = null;

vi.mock("@/components/Toast", () => ({ useToast: () => ({ show }) }));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useEvent: () => ({ data: detail, error: null, isLoading: false, refetch, setData: vi.fn() }),
  useSetRsvp: () => ({ mutate: setRsvp, isPending: false, error: null }),
  useSetReaction: () => ({ mutate: setReaction, isPending: false, error: null }),
}));

const { EventResponses } = await import("../EventResponses");

const m = (userId: number, displayName: string): Member => ({ userId, displayName, color: "#3B82F6", profileImageUrl: null });
const MOM = m(1, "엄마");
const DAD = m(2, "아빠");
const SUM: RsvpSummary = { going: 1, notGoing: 0, maybe: 0, pending: 1, mine: null };
const REACT: ReactionSummary = { LIKE: 1, EXCITED: 0, ACK: 0, mine: null };
const EV = {
  id: 7,
  groupId: 4,
  publicCode: "evntcode",
  title: "가족 저녁",
  startsAt: "2026-11-20T10:00:00.000Z",
  endsAt: "2026-11-20T12:00:00.000Z",
  allDay: false,
  creator: MOM,
  createdAt: "",
  updatedAt: "",
  repeat: "WEEKLY",
  repeatUntil: null,
  occurrence: "2026-11-20",
  seriesStartsAt: "2026-11-13T10:00:00.000Z",
  repeatAnchor: null,
  participants: { all: false, members: [MOM, DAD] },
  rsvp: SUM,
  reactions: REACT,
} as Event;
const ok = <T,>(d: T): Outcome<T> => ({ ok: true, data: d, error: null });

describe("EventResponses (#190)", () => {
  beforeEach(() => {
    detail = null;
    setRsvp.mockReset();
    setReaction.mockReset();
    refetch.mockReset();
    show.mockReset();
  });
  afterEach(cleanup);

  it("참여자: 아무 칸도 고르지 않은 세그먼트, 참석을 누르면 그 회차로 저장하고 집계와 목록을 새로", async () => {
    const onChanged = vi.fn();
    setRsvp.mockResolvedValue(ok({ going: 2, notGoing: 0, maybe: 0, pending: 0, mine: "GOING" }));
    render(<EventResponses event={EV} groupId={4} meId={2} showRsvp onChanged={onChanged} />);
    const group = screen.getByRole("radiogroup", { name: "내 참석" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["참석", "미정", "불참"]);
    expect(radios.every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    expect(screen.getByRole("button", { name: /모두의 응답/ }).textContent).toContain("참석 1, 응답 전 1");

    await act(async () => {
      fireEvent.click(radios[0]);
    });
    expect(setRsvp).toHaveBeenCalledWith({ eventId: 7, occurrence: "2026-11-20", status: "GOING" });
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    // (#378) 고른 칸은 먹색으로 칠하고 "내 참석" 옆에 "참석함"
    expect(radios[0].className).toContain("bg-ink");
    expect(radios[1].className).not.toContain("bg-ink");
    expect(screen.getByText("참석함")).toBeTruthy();
    expect(screen.getByRole("button", { name: /모두의 응답/ }).textContent).toContain("참석 2");
    expect(onChanged).toHaveBeenCalled();
    expect(refetch).toHaveBeenCalled();
  });

  it("참여자가 아니면 세그먼트 없이 집계 줄만, 반응은 남길 수 있다", async () => {
    setReaction.mockResolvedValue(ok({ LIKE: 1, EXCITED: 1, ACK: 0, mine: "EXCITED" }));
    render(<EventResponses event={EV} groupId={4} meId={9} showRsvp />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByRole("button", { name: /참석 여부/ })).toBeTruthy();
    const pills = within(screen.getByRole("group", { name: "반응 남기기" })).getAllByRole("button");
    expect(pills.map((p) => p.textContent)).toEqual(["좋아요1", "기대돼요", "확인했어요"]);
    await act(async () => {
      fireEvent.click(pills[1]);
    });
    expect(setReaction).toHaveBeenCalledWith({ eventId: 7, occurrence: "2026-11-20", reaction: "EXCITED" });
    expect(pills[1].getAttribute("aria-pressed")).toBe("true");
  });

  it("내 반응을 다시 누르면 취소(null)", async () => {
    setReaction.mockResolvedValue(ok({ LIKE: 0, EXCITED: 0, ACK: 0, mine: null }));
    render(<EventResponses event={{ ...EV, reactions: { ...REACT, mine: "LIKE" } }} groupId={4} meId={2} showRsvp />);
    const like = screen.getByRole("button", { name: "좋아요 1명" });
    expect(like.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.click(like);
    });
    expect(setReaction).toHaveBeenCalledWith(expect.objectContaining({ reaction: null }));
  });

  it("403 NOT_PARTICIPANT: 되돌리고 토스트, 상세와 목록을 새로 받는다", async () => {
    const onChanged = vi.fn();
    setRsvp.mockResolvedValue({ ok: false, data: null, error: { code: "NOT_PARTICIPANT", message: "이 일정의 참여자만 응답할 수 있어요" } });
    render(<EventResponses event={EV} groupId={4} meId={2} showRsvp onChanged={onChanged} />);
    const radio = screen.getByRole("radio", { name: "불참" });
    await act(async () => {
      fireEvent.click(radio);
    });
    expect(radio.getAttribute("aria-checked")).toBe("false");
    expect(show).toHaveBeenCalledWith("이 일정의 참여자가 아니라서 응답할 수 없어요");
    expect(refetch).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it("그 밖의 실패는 되돌리고 줄 아래 문구", async () => {
    setRsvp.mockResolvedValue({ ok: false, data: null, error: { code: "INTERNAL", message: "" } });
    render(<EventResponses event={EV} groupId={4} meId={2} showRsvp />);
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "미정" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("저장하지 못했어요. 다시 시도해 주세요");
  });

  it("단건의 사람별 응답: 시간이 바뀐 내 응답 안내, 시트는 참석/응답 전/반응으로 묶는다", () => {
    detail = {
      ...EV,
      rsvp: { ...SUM, mine: "GOING", pending: 0, going: 2 },
      hasLaterExceptions: false,
      rsvpMembers: [
        { member: MOM, status: "GOING", respondedAt: "2026-11-18T00:00:00.000Z", stale: false },
        { member: DAD, status: "GOING", respondedAt: "2026-11-18T00:00:00.000Z", stale: true },
      ],
      reactionMembers: [{ member: MOM, reaction: "LIKE" }],
    };
    render(<EventResponses event={EV} groupId={4} meId={2} showRsvp />);
    expect(screen.getByText("답한 뒤에 시간이 바뀌었어요. 다시 골라 주세요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /모두의 응답/ }));
    const sheet = screen.getByRole("dialog", { name: "응답" });
    expect(within(sheet).getByRole("heading", { name: "참석 2" })).toBeTruthy();
    expect(within(sheet).getByRole("heading", { name: "반응 1" })).toBeTruthy();
    expect(sheet.textContent).toContain("아빠 (나)");
    expect(sheet.textContent).toContain("시간이 바뀌기 전에 답했어요");
    expect(sheet.textContent).toContain("좋아요");
  });

  it("참여자 없음(showRsvp false)이면 응답 줄 없이 반응만", () => {
    render(<EventResponses event={EV} groupId={4} meId={2} showRsvp={false} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("button", { name: /응답|참석 여부/ })).toBeNull();
    expect(screen.getByRole("group", { name: "반응 남기기" })).toBeTruthy();
  });

  it("(#378) between(메모)은 참석 칸과 반응 줄 사이에 그린다", () => {
    render(<EventResponses event={EV} groupId={4} meId={2} showRsvp between={<p>메모칸</p>} />);
    const rsvp = screen.getByRole("radiogroup", { name: "내 참석" });
    const memo = screen.getByText("메모칸");
    const reactions = screen.getByRole("group", { name: "반응 남기기" });
    expect(rsvp.compareDocumentPosition(memo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(memo.compareDocumentPosition(reactions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
