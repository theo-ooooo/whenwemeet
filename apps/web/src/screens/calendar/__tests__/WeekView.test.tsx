// @vitest-environment happy-dom
// (#192) 주 보기: 막대 aria-label, 겹침 "+N", 종일 줄, 빈 칸 누르기 시각, 빈 주 안내, 오류, 빈 시간 토글, 월 | 주 전환
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { kstToIso } from "@/lib/date";
import type { Event } from "@/lib/types";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/AppShell", () => ({ useGroupContext: () => ({ group: { type: "TEAM", me: { userId: 1 } } }) }));

const { WeekView } = await import("../WeekView");
const { ViewToggle } = await import("../ViewToggle");

const member = (userId: number, name: string, color: string) => ({ userId, displayName: name, color, profileImageUrl: null, joinedAt: "2026-11-01T00:00:00.000Z" });
let seq = 0;
const ev = (title: string, day: string, start: string, endDay: string, end: string, over: Partial<Event> = {}): Event =>
  ({
    id: ++seq,
    groupId: 6,
    publicCode: `code${seq}`,
    title,
    memo: null,
    startsAt: kstToIso(day, start),
    endsAt: kstToIso(endDay, end),
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

const DAYS = ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"];

function view(over: Partial<React.ComponentProps<typeof WeekView>> = {}) {
  const props: React.ComponentProps<typeof WeekView> = {
    days: DAYS,
    today: "2026-11-12",
    wide: true,
    events: [],
    eventsError: null,
    onRetry: vi.fn(),
    annByDay: new Map(),
    anchor: null,
    free: { on: false, onToggle: vi.fn(), label: "둘 다 비는 시간", slots: null, error: false },
    newHref: "/events/new",
    swipeRef: { current: null },
    onOpenDay: vi.fn(),
    onOpenEvent: vi.fn(),
    onAdd: vi.fn(),
    ...over,
  };
  render(<WeekView {...props} />);
  return props;
}

afterEach(cleanup);

describe("WeekView", () => {
  it("시간 일정은 읽을 수 있는 막대, 누르면 그날 + 그 일정", () => {
    const dinner = ev("저녁 약속", "2026-11-12", "18:00", "2026-11-12", "20:00");
    const p = view({ events: [dinner] });
    const bar = screen.getByRole("button", { name: "저녁 약속, 11월 12일 오후 6시부터 8시까지, 나, 하늘" });
    fireEvent.click(bar);
    expect(p.onOpenEvent).toHaveBeenCalledWith("2026-11-12", dinner);
  });

  it("자정을 넘는 일정은 이틀에 조각이 하나씩", () => {
    const night = ev("심야", "2026-11-12", "23:00", "2026-11-13", "01:30");
    view({ events: [night] });
    const bars = screen.getAllByRole("button", { name: /^심야,/ });
    expect(bars.map((b) => b.dataset.day)).toEqual(["2026-11-12", "2026-11-13"]);
    // (QA) 막대 안 시각은 날마다 자른 조각("23:00~24:00")이 아니라 일정의 진짜 시각
    expect(bars.map((b) => b.textContent)).toEqual(["심야23:00~01:30", "심야23:00~01:30"]);
  });

  it("4개 겹치면 2개 막대 + \"+2\" 가 그날 상세를 연다", () => {
    const list = [0, 1, 2, 3].map((i) => ev(`겹침${i}`, "2026-11-10", "10:00", "2026-11-10", `1${1 + i}:00`));
    const p = view({ events: list });
    expect(screen.getAllByRole("button", { name: /^겹침/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "11월 10일 (화) 겹친 일정 2개 더 보기" }));
    expect(p.onOpenDay).toHaveBeenCalledWith("2026-11-10");
  });

  it("종일 일정은 종일 줄 막대", () => {
    const trip = ev("여행", "2026-11-09", "00:00", "2026-11-12", "00:00", { allDay: true });
    const p = view({ events: [trip] });
    fireEvent.click(screen.getByRole("button", { name: /^여행, 종일 ~11월 11일/ }));
    expect(p.onOpenEvent).toHaveBeenCalledWith("2026-11-09", trip);
    // 종일 일정만 있는 주는 빈 주가 아니다
    expect(screen.queryByText("이번 주 일정이 없어요.")).toBeNull();
  });

  it("빈 칸을 누르면 그 자리 시각(30분 내림)으로 추가, 키보드면 보이는 맨 위 칸", () => {
    const p = view();
    const cell = screen.getByRole("button", { name: "11월 11일 (수)에 일정 추가" });
    cell.getBoundingClientRect = () => ({ top: 100, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
    // 48px = 1시간. 100 + 14.5시간*48 = 796 → 14:30
    fireEvent.click(cell, { clientY: 100 + 14.5 * 48 + 10, detail: 1 });
    expect(p.onAdd).toHaveBeenLastCalledWith("2026-11-11", "14:30");
    fireEvent.click(cell, { detail: 0 });
    expect(p.onAdd).toHaveBeenCalledTimes(2);
    expect((p.onAdd as ReturnType<typeof vi.fn>).mock.calls[1][1]).toMatch(/^\d{2}:(00|30)$/);
  });

  it("날짜 머리를 누르면 그날 상세, 오늘은 aria-current", () => {
    const p = view();
    const head = screen.getByRole("button", { name: "2026년 11월 12일 (목), 오늘" });
    expect(head.getAttribute("aria-current")).toBe("date");
    fireEvent.click(head);
    expect(p.onOpenDay).toHaveBeenCalledWith("2026-11-12");
  });

  it("빈 주 안내와 일정 추가, 오류면 다시 시도", () => {
    view({ events: [ev("다른 주", "2026-11-20", "10:00", "2026-11-20", "11:00")] });
    expect(screen.getByText("이번 주 일정이 없어요.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "일정 추가" }).getAttribute("href")).toBe("/events/new");
    cleanup();
    const p = view({ eventsError: "일정을 불러오지 못했어요" });
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(p.onRetry).toHaveBeenCalled();
  });

  it("불러오는 중에는 막대 자리 스켈레톤 + aria-busy, 빈 주 안내 없음", () => {
    const { container } = render(<div />);
    view({ events: null });
    expect(container.ownerDocument.querySelector("[aria-busy='true']")).toBeTruthy();
    expect(screen.queryByText("이번 주 일정이 없어요.")).toBeNull();
  });

  it("빈 시간 토글은 aria-pressed, 켜면 그 주 빈 구간을 칠한다", () => {
    const onToggle = vi.fn();
    view({ free: { on: true, onToggle, label: "둘 다 비는 시간", slots: [{ startsAt: kstToIso("2026-11-10", "13:00"), endsAt: kstToIso("2026-11-10", "15:00") }], error: false } });
    const btn = screen.getByRole("button", { name: "둘 다 비는 시간" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalled();
    const bands = document.querySelectorAll("[data-free-band]");
    expect(bands).toHaveLength(1);
    expect((bands[0] as HTMLElement).style.top).toBe(`${13 * 48}px`);
  });
});

describe("ViewToggle", () => {
  it("월 | 주 라디오, 화살표로 바꾼다", () => {
    const onChange = vi.fn();
    render(<ViewToggle value="month" onChange={onChange} />);
    const month = screen.getByRole("radio", { name: "월 보기" });
    expect(month.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "주 보기" }));
    expect(onChange).toHaveBeenLastCalledWith("week");
    fireEvent.keyDown(month, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("week");
  });
});

describe("WeekView 날짜 머리 키보드 (#201)", () => {
  it("Tab 정지점 하나(오늘), ← → Home End 로 이 주 안에서만 옮긴다", () => {
    const p = view();
    const group = screen.getByRole("group", { name: "이 주 날짜" });
    const tabbable = group.querySelectorAll('button[tabindex="0"]');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].getAttribute("data-date")).toBe("2026-11-12");
    (tabbable[0] as HTMLElement).focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect((document.activeElement as HTMLElement).dataset.date).toBe("2026-11-13");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect((document.activeElement as HTMLElement).dataset.date).toBe("2026-11-14");
    // 토요일에서 → 는 이 주 밖이라 그대로
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect((document.activeElement as HTMLElement).dataset.date).toBe("2026-11-14");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect((document.activeElement as HTMLElement).dataset.date).toBe("2026-11-08");
    expect(group.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
    fireEvent.click(document.activeElement!);
    expect(p.onOpenDay).toHaveBeenCalledWith("2026-11-08");
  });

  it("패널이 연 날이 있으면 그 칸이 Tab 정지점", () => {
    view({ anchor: "2026-11-10" });
    const group = screen.getByRole("group", { name: "이 주 날짜" });
    expect(group.querySelector('button[tabindex="0"]')?.getAttribute("data-date")).toBe("2026-11-10");
  });
});
