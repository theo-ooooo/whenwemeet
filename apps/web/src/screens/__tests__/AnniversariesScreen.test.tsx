// @vitest-environment happy-dom
// (#305) 기념일 화면의 멤버 생일 줄: 기념일과 같이 다음 날짜순, 고치지 않음(내 것은 내 정보 링크), 내 생일이 없을 때 안내
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Anniversary, Birthday, GroupDetail } from "@/lib/types";

let anniversaries: Anniversary[] | null = [];
let birthdays: Birthday[] | null = [];
let showBirthday: boolean | undefined = true;
const noop = { mutate: vi.fn(), isPending: false, error: null };

vi.mock("@/components/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/components/ReminderPicker", () => ({ ReminderNote: () => null }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/AppShell", () => ({
  useGroupContext: () => ({
    groupId: 10,
    setFabAction: vi.fn(),
    group: { id: 10, type: "TEAM", me: { userId: 1, displayName: "지우", color: "#5B6CF4", profileImageUrl: null, showBirthday } } as unknown as GroupDetail,
  }),
}));
vi.mock("@/hooks", () => ({
  messageOf: (_e: unknown, fallback: string) => fallback,
  useAnniversaries: () => ({ data: anniversaries, error: null, refetch: vi.fn(), setData: vi.fn() }),
  useBirthdays: () => ({ data: birthdays, error: null, refetch: vi.fn() }),
  useCreateAnniversary: () => noop,
  useUpdateAnniversary: () => noop,
  useDeleteAnniversary: () => noop,
}));
vi.mock("@/lib/date", async (orig) => ({ ...(await orig<typeof import("@/lib/date")>()), todayKey: () => "2026-11-13" }));

const { AnniversariesScreen } = await import("../AnniversariesScreen");

const jiu = { userId: 1, displayName: "지우", color: "#5B6CF4", profileImageUrl: null };
const haneul = { userId: 2, displayName: "하늘", color: "#F2994A", profileImageUrl: null };
const ANN: Anniversary = { id: 5, groupId: 10, name: "처음 만난 날", date: "2026-03-01", kind: "COUNT_UP", creator: jiu, createdAt: "2026-03-01T00:00:00.000Z" };

describe("AnniversariesScreen 멤버 생일 (#305)", () => {
  beforeEach(() => {
    anniversaries = [ANN];
    birthdays = [];
    showBirthday = true;
  });
  afterEach(cleanup);

  it("생일은 다음 날짜순으로 섞이고, 남의 생일은 누를 수 없고 내 생일은 내 정보로 간다", () => {
    birthdays = [
      { member: haneul, date: "11-20" },
      { member: jiu, date: "01-02" },
    ];
    render(<AnniversariesScreen />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("b")?.textContent)).toEqual(["하늘 생일", "처음 만난 날", "지우 생일"]);
    expect(within(rows[0]).queryByRole("button")).toBeNull();
    expect(within(rows[0]).queryByRole("link")).toBeNull();
    expect(rows[0].textContent).toContain("매년 11월 20일");
    expect(rows[0].textContent).toContain("D-7");
    expect(within(rows[1]).getByRole("button")).toBeTruthy();
    const mine = within(rows[2]).getByRole("link");
    expect(mine.getAttribute("href")).toBe("/me#birthday");
    expect(rows[2].textContent).toContain("내 정보에서 바꿀 수 있어요");
    // 내 생일이 목록에 있으면 안내 없음
    expect(screen.queryByText("내 생일 넣기")).toBeNull();
  });

  it("내 생일이 없으면 '내 생일 넣기', 이 팀에서 껐으면 '팀 설정' 안내", () => {
    birthdays = [{ member: haneul, date: "11-20" }];
    render(<AnniversariesScreen />);
    expect(screen.getByText("내 생일 넣기").getAttribute("href")).toBe("/me#birthday");
    cleanup();
    showBirthday = false;
    render(<AnniversariesScreen />);
    expect(screen.getByText("이 팀 달력에는 내 생일을 보이지 않게 해 두었어요")).toBeTruthy();
    expect(screen.getByText("팀 설정").getAttribute("href")).toBe("/team");
  });

  it("생일을 못 받으면 기념일만, 안내도 없음", () => {
    birthdays = null;
    render(<AnniversariesScreen />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("내 생일 넣기")).toBeNull();
  });
});
