// @vitest-environment happy-dom
// (#331) 넓은 화면 일 상세 패널: 머리(제목, ‹ 13 [14] 15 ›), 일정 줄, 비는 시간 줄 "만들기", Esc 와 포커스 복귀(DayDock)
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@/lib/types";

vi.mock("@/hooks", () => ({
  useCreateEvent: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useCreateEventShare: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  messageOf: () => "",
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../AppShell", () => ({ useGroupContext: () => ({ group: { type: "TEAM", me: { userId: 1 } } }) }));

const { DayPanel, DayFreeRow } = await import("../DayPanel");
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

  it("‹ 와 › 는 전날, 다음 날. 앞뒤 날짜 숫자도 그날로", () => {
    const onPickDay = vi.fn();
    panel({ onPickDay });
    fireEvent.click(screen.getByRole("button", { name: "전날" }));
    fireEvent.click(screen.getByRole("button", { name: "다음 날" }));
    fireEvent.click(screen.getByRole("button", { name: /^11월 15일/ }));
    expect(onPickDay.mock.calls.map((c) => c[0])).toEqual(["2026-11-13", "2026-11-15", "2026-11-15"]);
    expect(screen.getByRole("button", { name: /^11월 14일/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("일정 줄: 시각 열, 제목, 참여자. 누르면 일정 상세로", () => {
    const p = panel();
    const row = screen.getByRole("button", { name: /저녁 약속/ });
    expect(row.textContent).toContain("7:00");
    expect(row.getAttribute("aria-label")).toContain("나, 하늘");
    fireEvent.click(row);
    expect(p.onOpenEvent).toHaveBeenCalledWith(expect.objectContaining({ publicCode: "abcd1234" }));
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
});

describe("비는 시간 줄", () => {
  it("구간이 있으면 시각 + 만들기 링크", () => {
    render(<DayFreeRow free={{ label: "둘 다 비는 시간", slot: { startsAt: "2026-11-14T09:00:00.000Z", endsAt: "2026-11-14T12:00:00.000Z" } }} newEventHref={(s, e) => `/events/new?start=${s}&end=${e}`} />);
    expect(screen.getByText("18:00~21:00")).toBeTruthy();
    expect(screen.getByRole("link", { name: /일정 만들기/ }).getAttribute("href")).toContain("/events/new?start=2026-11-14T09:00:00.000Z");
  });
  it("없으면 '없어요', 만들기 없음", () => {
    render(<DayFreeRow free={{ label: "둘 다 비는 시간", slot: null }} newEventHref={() => "/x"} />);
    expect(screen.getByText("없어요")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
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
