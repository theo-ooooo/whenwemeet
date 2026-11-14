// @vitest-environment happy-dom
// (#378) 일정 줄: 4px 일정 색 막대, 제목, 시각 한 번, 장소(다시 찾기 선택), 모두가 아닐 때만 아바타, 내 참석, 지난 일정 흐림, 링크
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kstToIso } from "@/lib/date";
import type { Event, Member, Place, RsvpSummary } from "@/lib/types";

const resolveCalls = vi.fn();
let resolvedName: string | null = null;
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks", () => ({
  usePlaceResolve: (p: Place | null) => {
    resolveCalls(p);
    return { data: resolvedName ? { place: { name: resolvedName } } : null, error: null };
  },
}));

const { EventList, EventRow } = await import("../EventRow");

const D = "2026-11-17";
const m = (id: number, name: string, color: string): Member => ({ userId: id, displayName: name, color, profileImageUrl: null });
const ME = m(1, "지우", "#F26D6D");
const HA = m(2, "하늘", "#F2994A");
const ev = (o: Partial<Event> = {}): Event =>
  ({
    id: 1,
    groupId: 10,
    publicCode: "evnt0001",
    title: "치과 정기검진",
    startsAt: kstToIso(D, "11:00"),
    endsAt: kstToIso(D, "12:00"),
    allDay: false,
    memo: null,
    place: null,
    repeat: null,
    occurrence: null,
    creator: ME,
    participants: { all: true, members: [ME, HA] },
    color: null,
    ...o,
  }) as Event;
const team = { meId: 1, personal: false };
const rsvp = (mine: RsvpSummary["mine"]): RsvpSummary => ({ going: 1, maybe: 0, notGoing: 0, pending: 1, mine });

const row = (props: Partial<React.ComponentProps<typeof EventRow>> & { event?: Event } = {}) =>
  render(
    <EventList label="이날 일정">
      <EventRow event={ev()} who={team} {...props} />
    </EventList>,
  );

beforeEach(() => {
  resolvedName = null;
  resolveCalls.mockClear();
});
afterEach(cleanup);

describe("EventRow", () => {
  it("목록 안 줄 하나: 일정 상세 링크, 제목, 시각 한 번, 4px 막대는 첫 참여자 색", () => {
    row();
    expect(screen.getByRole("list", { name: "이날 일정" })).toBeTruthy();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/events/evnt0001");
    expect(link.getAttribute("aria-label")).toBe("치과 정기검진, 오전 11:00 ~ 오후 12:00, 모두");
    // (#427) 모두면 아바타 대신 팀 아이콘 + "모두"
    expect(link.textContent).toBe("치과 정기검진오전 11:00 ~ 오후 12:00모두");
    const bar = link.querySelector("[data-bar]") as HTMLElement;
    expect(bar.className).toContain("w-1");
    expect(bar.style.background).toBe("var(--m1)");
  });

  it("일정 색을 고르면 막대는 그 색", () => {
    row({ event: ev({ color: "#F279B5" }) });
    expect((screen.getByRole("link").querySelector("[data-bar]") as HTMLElement).style.background).toBe("var(--m8)");
  });

  it("모두면 아바타 없음, 일부면 아바타와 이름 읽기, 개인 팀이면 사람 표기 없음", () => {
    row();
    expect(screen.getByRole("link").textContent).not.toContain("하");
    cleanup();
    row({ event: ev({ participants: { all: false, members: [ME, HA] } }) });
    expect(screen.getByRole("link").getAttribute("aria-label")).toContain("나, 하늘");
    expect(screen.getByRole("link").textContent).toContain("지하");
    cleanup();
    row({ event: ev({ participants: { all: false, members: [ME, HA] } }), who: { meId: 1, personal: true } });
    expect(screen.getByRole("link").getAttribute("aria-label")).toBe("치과 정기검진, 오전 11:00 ~ 오후 12:00");
  });

  it("내 참석은 고른 것만 알약, 아직이면 아무것도 없다", () => {
    row({ event: ev({ rsvp: rsvp("MAYBE") }) });
    expect(screen.getByText("미정")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("aria-label")).toContain("내 응답 미정");
    cleanup();
    row({ event: ev({ rsvp: rsvp(null) }) });
    expect(screen.queryByText(/참석|미정|불참/)).toBeNull();
  });

  it("장소: 기본은 사용자 글자, resolvePlace 면 다시 찾은 이름. 직접 적은 장소는 부르지 않는다", () => {
    const picked: Place = { text: null, query: "사랑니", kakaoPlaceId: "123", url: null };
    row({ event: ev({ place: picked }) });
    expect(screen.getByText("사랑니")).toBeTruthy();
    expect(resolveCalls).not.toHaveBeenCalled();
    cleanup();
    resolvedName = "사랑이아프니치과";
    row({ event: ev({ place: picked }), resolvePlace: true });
    expect(resolveCalls).toHaveBeenCalledWith(picked);
    expect(screen.getByText("사랑이아프니치과")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("aria-label")).toContain("장소 사랑이아프니치과");
    cleanup();
    resolveCalls.mockClear();
    row({ event: ev({ place: null }), resolvePlace: true });
    expect(resolveCalls).not.toHaveBeenCalled();
  });

  it("지난 일정은 흐리게, 읽기 이름에 '지난 일정'", () => {
    row({ now: Date.parse(kstToIso(D, "14:10")) });
    const link = screen.getByRole("link");
    expect(link.className).toContain("opacity-55");
    expect(link.getAttribute("aria-label")).toContain("지난 일정");
    cleanup();
    row({ now: Date.parse(kstToIso(D, "08:00")) });
    expect(screen.getByRole("link").className).not.toContain("opacity-55");
  });

  it("날짜 글자, 제목 바꿔 그리기, extra, note, 반복 회차 주소, onClick", () => {
    const click = vi.fn((e: React.MouseEvent) => e.preventDefault());
    row({
      event: ev({ repeat: "WEEKLY", occurrence: "2026-11-17", allDay: true, startsAt: kstToIso(D), endsAt: kstToIso("2026-11-18") }),
      dateText: "11월 17일 (화)",
      title: <mark>치과</mark>,
      extra: <span>매주</span>,
      note: "메모 한 줄",
      labelExtra: ["매주", "메모 한 줄"],
      onClick: click,
    });
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/events/evnt0001?occurrence=2026-11-17");
    expect(link.querySelector("mark")?.textContent).toBe("치과");
    expect(link.getAttribute("aria-label")).toBe("치과 정기검진, 11월 17일 (화), 종일, 모두, 매주, 메모 한 줄");
    expect(screen.getByText("메모 한 줄")).toBeTruthy();
    fireEvent.click(link);
    expect(click).toHaveBeenCalled();
  });

  it("두 번째 줄부터 위 구분선 (카드 안쪽 여백 선)", () => {
    render(
      <EventList>
        <EventRow event={ev()} who={team} />
        <EventRow event={ev({ id: 2, publicCode: "evnt0002" })} who={team} />
      </EventList>,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1].className).toContain("not-first:after:bg-line");
  });
});
