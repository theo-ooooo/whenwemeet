// @vitest-environment happy-dom
// (#355) 폰 월 달력 이름 칩: 하루짜리 연한 면 + 먹색 글자, 여러 날 진한 막대 + --on-member, 주 조각마다 제목 한 번, 줄 위치, 각진 끝
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { addDays, kstToIso } from "@/lib/date";
import { groupByDay, isMultiDay } from "@/lib/day-detail";
import { MEMBER_COLORS, type Event } from "@/lib/types";
import { packWeek, phoneWeek } from "@/lib/month-lanes";
import { PhoneWeekChips } from "../PhoneMonthChips";

const member = (userId: number, name: string, color: string) => ({
  userId,
  displayName: name,
  color,
  profileImageUrl: null,
  joinedAt: "2026-11-01T00:00:00.000Z",
});
let seq = 0;
const ev = (title: string, first: string, last: string, over: Partial<Event> = {}): Event =>
  ({
    id: ++seq,
    groupId: 6,
    publicCode: `code${seq}`,
    title,
    memo: null,
    startsAt: kstToIso(first),
    endsAt: kstToIso(addDays(last, 1)),
    allDay: true,
    creator: member(1, "지우", MEMBER_COLORS[0]),
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    repeat: null,
    repeatUntil: null,
    occurrence: null,
    seriesStartsAt: null,
    repeatAnchor: null,
    participants: { all: false, members: [member(2, "하늘", MEMBER_COLORS[1]), member(1, "지우", MEMBER_COLORS[0])] },
    ...over,
  }) as Event;

const week = (sunday: string) => Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
const chipsOf = (days: string[], events: Event[]) => phoneWeek(packWeek(days, groupByDay(events), isMultiDay)).chips;

afterEach(cleanup);

describe("PhoneWeekChips (#355)", () => {
  it("하루짜리: 첫 참여자 색 26%(--day-chip-mix) 를 --tile 에 섞은 면 + 먹색 글자, 시각 없이 제목만", () => {
    const { container } = render(<PhoneWeekChips chips={chipsOf(week("2026-11-08"), [ev("치과", "2026-11-10", "2026-11-10")])} />);
    const chip = container.querySelector<HTMLElement>("[data-chip=day]")!;
    expect(chip.textContent).toBe("치과");
    expect(chip.style.getPropertyValue("--chip-c")).toBe("var(--m2)");
    expect(chip.className).toContain("bg-[color-mix(in_srgb,var(--chip-c)_var(--day-chip-mix),var(--tile))]");
    expect(chip.className).toContain("text-ink");
    expect(chip.style.top).toBe("29px");
    expect(chip.style.left).toBe("calc(2 * 100% / 7 + 1px)");
    expect(chip.className).toContain("rounded-l-[4px]");
    expect(chip.className).toContain("rounded-r-[4px]");
  });

  it("(#566) 음력 표시를 켜면 숫자 아래 음력 한 줄(12px)만큼 칩이 내려간다: 첫 줄 41, 둘째 줄 58", () => {
    const chips = chipsOf(week("2026-11-08"), [ev("치과", "2026-11-10", "2026-11-10"), ev("헬스", "2026-11-10", "2026-11-10")]);
    const { container } = render(<PhoneWeekChips chips={chips} lunarRow />);
    expect([...container.querySelectorAll<HTMLElement>("[data-chip=day]")].map((c) => c.style.top)).toEqual(["41px", "58px"]);
  });

  it("일정 색을 고르면 그 색", () => {
    const { container } = render(<PhoneWeekChips chips={chipsOf(week("2026-11-08"), [ev("헬스", "2026-11-10", "2026-11-10", { color: MEMBER_COLORS[4] })])} />);
    expect(container.querySelector<HTMLElement>("[data-chip=day]")!.style.getPropertyValue("--chip-c")).toBe("var(--m5)");
  });

  it("여러 날: 진한 막대 + --on-member, 주를 넘으면 조각마다 제목 한 번, 끊긴 쪽은 각지게", () => {
    const trip = ev("제주 여행", "2026-11-12", "2026-11-17", { color: MEMBER_COLORS[7] });
    const a = render(<PhoneWeekChips chips={chipsOf(week("2026-11-08"), [trip])} />).container.querySelectorAll<HTMLElement>("[data-chip=multi]");
    expect(a).toHaveLength(1);
    expect(a[0].textContent).toBe("제주 여행");
    expect(a[0].style.getPropertyValue("--chip-c")).toBe("var(--m8)");
    expect(a[0].className).toContain("bg-(--chip-c) text-on-member");
    expect(a[0].style.width).toBe("calc(3 * 100% / 7 - 1px)");
    expect(a[0].className).toContain("rounded-l-[4px]");
    expect(a[0].className).not.toContain("rounded-r-");
    cleanup();
    const b = render(<PhoneWeekChips chips={chipsOf(week("2026-11-15"), [trip])} />).container.querySelectorAll<HTMLElement>("[data-chip=multi]");
    expect(b).toHaveLength(1);
    expect(b[0].textContent).toBe("제주 여행");
    expect(b[0].style.left).toBe("calc(0 * 100% / 7 + 0px)");
    expect(b[0].className).not.toContain("rounded-l-");
  });

  it("줄마다 17px 아래 (높이 15 + 간격 2), 4줄까지만", () => {
    const d = "2026-11-11";
    const evs = ["가", "나", "다", "라", "마", "바"].map((t) => ev(t, d, d));
    const { container } = render(<PhoneWeekChips chips={chipsOf(week("2026-11-08"), evs)} />);
    const tops = [...container.querySelectorAll<HTMLElement>("[data-chip]")].map((c) => c.style.top);
    expect(tops).toEqual(["29px", "46px", "63px", "80px"]);
  });
});
