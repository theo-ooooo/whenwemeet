// @vitest-environment happy-dom
// (#331) 넓은 화면 일 상세 패널: 머리(제목, ‹ 13 [14] 15 ›), 일정 줄, (#378 B) 하루 막대와 공통 일정 줄, Esc 와 포커스 복귀(DayDock)
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetInputModality, trackInputModality } from "@/lib/input-modality";
import type { Event } from "@/lib/types";

vi.mock("@/hooks", () => ({
  useCreateEvent: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useCreateEventShare: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  messageOf: () => "",
  usePlaceResolve: () => ({ data: null, error: null }),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../AppShell", () => ({ useGroupContext: () => ({ group: { type: "TEAM", me: { userId: 1 } } }) }));

const { DayPanel } = await import("../DayPanel");
const { DayDock } = await import("../DayDock");

const member = (userId: number, name: string, color: string) => ({ userId, displayName: name, color, profileImageUrl: null, joinedAt: "2026-11-01T00:00:00.000Z" });
const ev = (over: Partial<Event> = {}): Event =>
  ({
    id: 7,
    groupId: 6,
    publicCode: "abcd1234",
    title: "저녁 약속",
    memo: null,
    startsAt: "2026-11-14T10:00:00.000Z", // KST 19:00
    endsAt: "2026-11-14T12:00:00.000Z",
    allDay: false,
    creator: member(1, "지우", "#F26D6D"),
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    repeat: null,
    repeatUntil: null,
    occurrence: null,
    seriesStartsAt: null,
    repeatAnchor: null,
    participants: { all: false, members: [member(1, "지우", "#F26D6D"), member(2, "하늘", "#5B6CF4")] },
    ...over,
  }) as Event;

function panel(over: Partial<React.ComponentProps<typeof DayPanel>> = {}) {
  const props = {
    groupId: 6,
    date: "2026-11-14",
    today: "2026-11-12",
    step: "day" as const,
    titleId: "t",
    events: [ev()],
    eventsError: null,
    onRetry: vi.fn(),
    anniversaries: [],
    event: undefined,
    onClose: vi.fn(),
    onBack: vi.fn(),
    onOpenEvent: vi.fn(),
    onPickDay: vi.fn(),
    onSaved: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };
  render(<DayPanel {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("날짜 단계", () => {
  it("제목 '11월 14일 토요일' 로 포커스가 간다", () => {
    panel();
    const h = screen.getByRole("heading", { name: "11월 14일 토요일" });
    expect(document.activeElement).toBe(h);
  });

  it("(#339) 마우스나 주소로 열면 제목 포커스에 테두리를 그리지 않는다 (data-quiet-focus)", () => {
    resetInputModality();
    panel();
    const h = screen.getByRole("heading", { name: "11월 14일 토요일" });
    expect(document.activeElement).toBe(h);
    expect(h.hasAttribute("data-quiet-focus")).toBe(true);
  });

  it("(#339) 키보드로 열면 테두리가 보이게 표시를 붙이지 않는다", () => {
    const stop = trackInputModality(document);
    fireEvent.keyDown(document, { key: "Enter" });
    panel();
    const h = screen.getByRole("heading", { name: "11월 14일 토요일" });
    expect(document.activeElement).toBe(h);
    expect(h.hasAttribute("data-quiet-focus")).toBe(false);
    stop();
    resetInputModality();
  });

  it("‹ 와 › 는 전날, 다음 날. 앞뒤 날짜 숫자도 그날로", () => {
    const onPickDay = vi.fn();
    panel({ onPickDay });
    fireEvent.click(screen.getByRole("button", { name: "전날" }));
    fireEvent.click(screen.getByRole("button", { name: "다음 날" }));
    fireEvent.click(screen.getByRole("button", { name: /^11월 15일/ }));
    expect(onPickDay.mock.calls.map((c) => c[0])).toEqual(["2026-11-13", "2026-11-15", "2026-11-15"]);
    expect(screen.getByRole("button", { name: /^11월 14일/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("(#378 B) 일정 줄은 공통 EventRow: 시각 한 번, 참여자. 누르면 같은 자리에서 일정 상세 (이동 막음)", () => {
    const p = panel();
    const row = screen.getByRole("link", { name: /저녁 약속/ });
    expect(row.getAttribute("href")).toBe("/events/abcd1234");
    expect(row.textContent).toContain("오후 7:00 ~ 9:00");
    expect(row.getAttribute("aria-label")).toContain("나, 하늘");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    row.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(p.onOpenEvent).toHaveBeenCalledWith(expect.objectContaining({ publicCode: "abcd1234" }));
  });

  it("(#378 B) ⌘ 클릭은 링크 그대로 (새 탭)", () => {
    const p = panel();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true });
    screen.getByRole("link", { name: /저녁 약속/ }).dispatchEvent(click);
    expect(p.onOpenEvent).not.toHaveBeenCalled();
  });

  it("빈 날은 빈 상태 안내, ✕ 는 닫기", () => {
    const p = panel({ events: [] });
    expect(screen.getByText("아직 일정이 없어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("일정 상세 단계는 같은 패널 안에서 ‹ 뒤로", () => {
    const p = panel({ step: "event", event: ev() });
    expect(screen.getByRole("heading", { name: "저녁 약속" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /14일 토요일/ }));
    expect(p.onBack).toHaveBeenCalledTimes(1);
  });

  it("(#566) 일정 상세 날짜 옆 음력: 음력으로 넣은 일정이면 늘, 아니면 음력 표시를 켰을 때만", () => {
    // 2026-11-14 = 음력 10월 6일
    panel({ step: "event", event: ev({ lunarInput: true }) });
    expect(screen.getByText("11월 14일 (토) · 음력 10월 6일")).toBeTruthy();
    cleanup();
    panel({ step: "event", event: ev() });
    expect(screen.queryByText(/음력 10월 6일/)).toBeNull();
    cleanup();
    panel({ step: "event", event: ev(), showLunar: true });
    expect(screen.getByText("11월 14일 (토) · 음력 10월 6일")).toBeTruthy();
  });

  it("(#566) 음력 표시를 켜면 날짜 머리 아래 '음력 10월 6일'", () => {
    panel({ showLunar: true });
    expect(screen.getByText("음력 10월 6일")).toBeTruthy();
  });
});

describe("(#378 B) 하루 막대", () => {
  const two = [member(1, "지우", "#F26D6D"), member(2, "하늘", "#5B6CF4")];
  it("멤버와 지금을 주면 막대(둘 다 빔 합계, 멤버 줄). 빈 구간을 누르면 그 시각으로 빠른 추가", () => {
    const onAddAt = vi.fn();
    panel({ members: two, now: Date.parse("2026-11-12T03:00:00.000Z"), onAddAt });
    // 19:00~21:00 일정 하나 → 8~19, 21~23 이 빈다 (13시간)
    expect(screen.getByRole("group", { name: "이날 하루, 둘 다 빔 13시간" })).toBeTruthy();
    expect(screen.getByText(/지우 바쁜 시간 오후 7:00 ~ 9:00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "오후 9:00 ~ 11:00 둘 다 비어요, 이 시간에 일정 추가" }), { detail: 0 });
    expect(onAddAt).toHaveBeenCalledWith(Date.parse("2026-11-14T12:00:00.000Z"));
  });
  it("오늘이면 '오늘 하루' 와 진행 중인 일정 뒤 지금 줄", () => {
    // 오늘 11/14 20:30 KST: 19~21 일정은 진행 중(지금 줄 앞), 22시 일정은 뒤
    const later = ev({ id: 8, publicCode: "later001", title: "늦은 산책", startsAt: "2026-11-14T13:00:00.000Z", endsAt: "2026-11-14T13:30:00.000Z" });
    panel({ today: "2026-11-14", members: two, now: Date.parse("2026-11-14T11:30:00.000Z"), events: [ev(), later] });
    expect(screen.getByRole("group", { name: /^오늘 하루/ })).toBeTruthy();
    const items = screen.getByRole("list", { name: "11월 14일 (토) 일정" }).querySelectorAll(":scope > li");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("저녁 약속");
    expect(items[1].textContent).toBe("지금 오후 8:30");
    expect(items[2].textContent).toContain("늦은 산책");
  });
  it("멤버를 안 주면 막대 없음", () => {
    panel();
    expect(screen.queryByRole("group", { name: /하루/ })).toBeNull();
  });
});

describe("DayDock (패널 틀)", () => {
  function dock(paused = false) {
    const onClose = vi.fn();
    const utils = render(
      <>
        <ul>
          <li data-date="2026-11-14">
            <button type="button">14</button>
          </li>
          <li data-date="2026-11-15">
            <button type="button">15</button>
          </li>
        </ul>
        <DayDock date="2026-11-14" titleId="t" onClose={onClose} paused={paused}>
          <h2 id="t">패널</h2>
          <button type="button">안쪽</button>
        </DayDock>
      </>,
    );
    return { onClose, ...utils };
  }

  it("제목으로 이름 붙은 보조 영역", () => {
    dock();
    expect(screen.getByRole("complementary", { name: "패널" })).toBeTruthy();
  });

  it("Esc 로 닫는다. 확인 창이 떠 있으면(paused) 건드리지 않는다", () => {
    const a = dock();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(a.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const b = dock(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(b.onClose).not.toHaveBeenCalled();
  });

  it("안쪽이 먼저 Esc 를 처리했으면 닫지 않는다", () => {
    const { onClose } = dock();
    const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    e.preventDefault();
    document.dispatchEvent(e);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("닫히면 그때 날짜 칸으로 포커스를 돌린다", () => {
    const onClose = vi.fn();
    const cells = (
      <ul>
        <li data-date="2026-11-14">
          <button type="button">14</button>
        </li>
        <li data-date="2026-11-15">
          <button type="button">15</button>
        </li>
      </ul>
    );
    const { rerender } = render(
      <>
        {cells}
        <DayDock date="2026-11-14" titleId="t" onClose={onClose}>
          <button type="button">안쪽</button>
        </DayDock>
      </>,
    );
    // 패널 안에서 다른 날(15일)로 옮긴 뒤 닫는다
    rerender(
      <>
        {cells}
        <DayDock date="2026-11-15" titleId="t" onClose={onClose}>
          <button type="button">안쪽</button>
        </DayDock>
      </>,
    );
    screen.getByRole("button", { name: "안쪽" }).focus();
    act(() => rerender(<>{cells}</>));
    expect(document.activeElement?.textContent).toBe("15");
  });

  it("패널 밖으로 이미 옮긴 포커스는 건드리지 않는다", () => {
    const { rerender } = render(
      <>
        <button type="button">밖</button>
        <ul>
          <li data-date="2026-11-14">
            <button type="button">14</button>
          </li>
        </ul>
        <DayDock date="2026-11-14" titleId="t" onClose={vi.fn()}>
          <span>안</span>
        </DayDock>
      </>,
    );
    screen.getByRole("button", { name: "밖" }).focus();
    act(() =>
      rerender(
        <>
          <button type="button">밖</button>
          <ul>
            <li data-date="2026-11-14">
              <button type="button">14</button>
            </li>
          </ul>
        </>,
      ),
    );
    expect(document.activeElement?.textContent).toBe("밖");
  });
});

describe("(#378) 일정 상세: 아래는 수정 하나, 복제와 삭제는 ⋯ 메뉴", () => {
  it("아래 버튼은 '수정' 하나. 복제, 삭제 버튼이 화면에 늘 있지 않다", () => {
    panel({ step: "event", event: ev() });
    expect(screen.getAllByRole("button", { name: "수정" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "삭제" })).toBeNull();
    expect(screen.queryByRole("button", { name: "복제" })).toBeNull();
  });

  it("⋯ 메뉴의 삭제는 빨간 글자, 고르면 부르는 쪽 확인(onDelete)으로. 메뉴가 따로 확인 창을 띄우지 않는다", () => {
    const p = panel({ step: "event", event: ev() });
    fireEvent.click(screen.getByRole("button", { name: "일정 메뉴" }));
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(items.slice(-2)).toEqual(["복제", "삭제"]);
    const del = screen.getByRole("menuitem", { name: "삭제" });
    expect(del.className).toContain("text-danger");
    fireEvent.click(del);
    expect(p.onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("칸 순서: 시간 → 참여자 → 메모 (메모가 참여자 위에 있지 않다)", () => {
    panel({ step: "event", event: ev({ memo: "운동복 챙기기" }) });
    const people = screen.getByText("참여자");
    const memo = screen.getByRole("heading", { name: "메모" });
    expect(people.compareDocumentPosition(memo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
