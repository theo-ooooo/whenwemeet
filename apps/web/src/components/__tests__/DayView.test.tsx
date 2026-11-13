// @vitest-environment happy-dom
// (#378 B) 폰 일 상세 C안: 제목 "11월 17일 화요일", 기념일 한 줄(있는 날만), 하루 막대(빈 구간 → 그 시각 빠른 추가), 공통 일정 줄과 "지금" 줄,
// 주소, 터치로 열면 제목 포커스 테두리 없음(D-214), 개인 달력은 멤버 줄 없음
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { kstToIso } from "@/lib/date";
import { resetInputModality, trackInputModality } from "@/lib/input-modality";
import type { Anniversary, Event, Member } from "@/lib/types";
import type { Occurrence } from "@/lib/anniversary";

vi.mock("@/hooks", () => ({ usePlaceResolve: () => ({ data: null, error: null }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
let groupType = "TEAM";
vi.mock("../AppShell", () => ({ useGroupContext: () => ({ group: { type: groupType, me: { userId: 1 } } }) }));

const { DayView } = await import("../DayView");

const D = "2026-11-17";
const t = (hm: string) => Date.parse(kstToIso(D, hm));
const m = (id: number, name: string): Member => ({ userId: id, displayName: name, color: id === 1 ? "#F26D6D" : "#5B6CF4", profileImageUrl: null });
const two = [m(1, "지우"), m(2, "하늘")];
const ev = (id: number, title: string, a: string, b: string, over: Partial<Event> = {}): Event =>
  ({
    id,
    groupId: 2,
    publicCode: `code${id}xxx`,
    title,
    memo: null,
    startsAt: kstToIso(D, a),
    endsAt: kstToIso(D, b),
    allDay: false,
    creator: two[0],
    createdAt: kstToIso(D),
    updatedAt: kstToIso(D),
    repeat: null,
    repeatUntil: null,
    occurrence: null,
    seriesStartsAt: null,
    repeatAnchor: null,
    participants: { all: true, members: [] },
    ...over,
  }) as Event;

function view(over: Partial<React.ComponentProps<typeof DayView>> = {}) {
  const events = [ev(1, "스터디", "08:00", "09:00"), ev(2, "치과", "11:00", "12:00", { participants: { all: false, members: [two[0]] } }), ev(3, "헬스", "18:00", "19:00")];
  const props = {
    date: D,
    today: D,
    titleId: "dv",
    byDay: new Map([[D, events]]),
    eventsError: null,
    onRetry: vi.fn(),
    anniversaries: [] as Occurrence[],
    members: two,
    now: t("14:10"),
    stripRef: { current: null },
    onPickDay: vi.fn(),
    onMonth: vi.fn(),
    onOpenEvent: vi.fn(),
    onAdd: vi.fn(),
    onAddAt: vi.fn(),
    ...over,
  };
  render(<DayView {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  groupType = "TEAM";
  resetInputModality();
});

describe("DayView (C안)", () => {
  it("제목 '11월 17일 화요일' 로 포커스. 주소나 터치로 열면 테두리 없음, 키보드면 있음", () => {
    view();
    const h = screen.getByRole("heading", { level: 1 });
    expect(h.textContent).toBe("11월 17일 화요일");
    expect(document.activeElement).toBe(h);
    expect(h.hasAttribute("data-quiet-focus")).toBe(true);
    cleanup();
    const stop = trackInputModality(document);
    fireEvent.keyDown(document, { key: "Enter" });
    view();
    expect(screen.getByRole("heading", { level: 1 }).hasAttribute("data-quiet-focus")).toBe(false);
    stop();
  });

  it("기념일이 없으면 기념일 줄도, 예전 요약 카드(비는 시간)도 없다", () => {
    view();
    expect(screen.queryByRole("link", { name: /처음 만난 날/ })).toBeNull();
    expect(screen.queryByText("둘 다 비는 시간")).toBeNull();
  });

  it("기념일이 있는 날만 한 줄 (외 N개)", () => {
    const a: Anniversary = { id: 1, groupId: 2, name: "처음 만난 날", date: "2026-08-10", kind: "ONCE", creator: two[0], createdAt: D } as Anniversary;
    const occ = (n: number): Occurrence => ({ anniversary: a, date: D, type: "DAYS", n, label: `${n}일` }) as unknown as Occurrence;
    view({ anniversaries: [occ(100), occ(200)] });
    const link = screen.getByRole("link", { name: /처음 만난 날/ });
    expect(link.textContent).toContain("외 1개");
  });

  it("하루 막대: 오늘 하루, 둘 다 빔, 멤버 줄. 빈 구간을 누르면 그 시각으로 onAddAt", () => {
    const p = view();
    expect(screen.getByRole("group", { name: /^오늘 하루, 둘 다 빔/ })).toBeTruthy();
    expect(screen.getByText(/하늘 바쁜 시간 오전 8:00 ~ 9:00/)).toBeTruthy();
    // 치과는 지우만: 하늘 줄에 없다
    expect(screen.getByText(/하늘 바쁜 시간/).textContent).not.toContain("11:00");
    fireEvent.click(screen.getByRole("button", { name: "오후 12:00 ~ 6:00 둘 다 비어요, 이 시간에 일정 추가" }), { detail: 0 });
    expect(p.onAddAt).toHaveBeenCalledWith(t("12:00"));
  });

  it("목록: 공통 일정 줄, 지난 일정 흐리게, 지난 것과 앞으로 사이 '지금' 줄. 누르면 onOpenEvent", () => {
    const p = view();
    const list = screen.getByRole("list", { name: "11월 17일 (화) 일정" });
    const items = [...list.querySelectorAll(":scope > li")];
    expect(items.map((li) => li.textContent?.split("오")[0])).toEqual(["스터디", "치과", "지금 ", "헬스"]);
    const study = screen.getByRole("link", { name: /^스터디/ });
    expect(study.className).toContain("opacity-55");
    expect(study.getAttribute("aria-label")).toContain("지난 일정");
    // 모두면 사람 아바타 없음, 일부(치과: 나)만 아바타
    expect(screen.getByRole("link", { name: /^헬스/ }).querySelector("[data-bar]")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: /^헬스/ }));
    expect(p.onOpenEvent).toHaveBeenCalledWith(expect.objectContaining({ title: "헬스" }));
  });

  it("오늘이 아니면 '이날 하루', 지금 줄 없음", () => {
    view({ today: "2026-11-16", now: t("14:10") - 86_400_000 });
    expect(screen.getByRole("group", { name: /^이날 하루/ })).toBeTruthy();
    expect(screen.queryByText(/^지금 /)).toBeNull();
  });

  it("개인 달력(나 하나): 멤버 줄 없이 '비는 시간'", () => {
    groupType = "PERSONAL";
    view({ members: [two[0]] });
    expect(screen.getByRole("group", { name: /^오늘 하루, 비는 시간/ })).toBeTruthy();
    expect(screen.queryByText(/바쁜 시간/)).toBeNull();
  });

  it("불러오는 중이면 막대 자리와 목록 스켈레톤", () => {
    view({ byDay: null });
    expect(screen.getByLabelText("불러오는 중")).toBeTruthy();
    expect(screen.queryByRole("group", { name: /하루/ })).toBeNull();
  });
});

describe("DayView 주간 줄 키보드 (#201)", () => {
  it("격자 한 줄, Tab 정지점은 그날 하나. 선택은 aria-selected, 오늘은 aria-current", () => {
    view();
    const grid = screen.getByRole("grid", { name: "이번 주" });
    const cells = grid.querySelectorAll('[role="gridcell"]');
    expect(cells).toHaveLength(7);
    const tabbable = grid.querySelectorAll('button[tabindex="0"]');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].getAttribute("data-strip")).toBe(D);
    expect(tabbable[0].getAttribute("aria-current")).toBe("date");
    expect(tabbable[0].getAttribute("aria-label")).toBe("11월 17일 (화), 일정 3개");
    expect(tabbable[0].closest('[role="gridcell"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("← → Home End 는 포커스만 옮기고, 주 밖이나 PageDown 이면 그날로 바꾼다", () => {
    const p = view();
    const start = screen.getByRole("button", { name: /^11월 17일/ });
    start.focus();
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect((document.activeElement as HTMLElement).dataset.strip).toBe("2026-11-18");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect((document.activeElement as HTMLElement).dataset.strip).toBe("2026-11-21");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect((document.activeElement as HTMLElement).dataset.strip).toBe("2026-11-15");
    expect(p.onPickDay).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(p.onPickDay).toHaveBeenLastCalledWith("2026-11-14");
    // 부모(목)가 날짜를 바꾸지 않았으니 포커스는 그날(17일) 칸으로 돌아온다. 거기서 한 주 뒤
    expect((document.activeElement as HTMLElement).dataset.strip).toBe(D);
    fireEvent.keyDown(document.activeElement!, { key: "PageDown" });
    expect(p.onPickDay).toHaveBeenLastCalledWith("2026-11-24");
  });

  it("Esc 는 escapeCloses 일 때만 월 보기로, 안쪽이 먼저 처리한 Esc 는 넘긴다", () => {
    const p = view();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(p.onMonth).not.toHaveBeenCalled();
    cleanup();
    const q = view({ escapeCloses: true });
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    e.preventDefault();
    document.dispatchEvent(e);
    expect(q.onMonth).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(q.onMonth).toHaveBeenCalledTimes(1);
  });

  it("닫히면 그 날짜의 달력 칸으로 포커스", () => {
    const cal = document.createElement("div");
    cal.innerHTML = `<div data-date="${D}"><button>칸</button></div>`;
    document.body.appendChild(cal);
    const r = render(
      <DayView
        date={D}
        today={D}
        titleId="dv"
        byDay={new Map()}
        eventsError={null}
        onRetry={vi.fn()}
        anniversaries={[]}
        members={two}
        now={t("14:10")}
        stripRef={{ current: null }}
        onPickDay={vi.fn()}
        onMonth={vi.fn()}
        onOpenEvent={vi.fn()}
        onAdd={vi.fn()}
        onAddAt={vi.fn()}
      />,
    );
    expect(document.activeElement?.tagName).toBe("H1");
    r.unmount();
    expect(document.activeElement).toBe(cal.querySelector("button"));
    cal.remove();
  });
});
