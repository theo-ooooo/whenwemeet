// @vitest-environment happy-dom
// (#378) 기념일 추가/수정 시트: 이름은 라벨 없는 큰 칸(글자 수는 80% 부터), 날짜 줄, 칸 안 종류 세그먼트, 알림 줄 → 여러 개 고르기,
// 안내 한 줄, "추가"/"저장". 보내는 본문은 예전과 같다(알림은 기본값과 다를 때만)
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Anniversary, GroupDetail } from "@/lib/types";

const create = vi.fn();
const update = vi.fn();

vi.mock("@/components/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/AppShell", () => ({
  useGroupContext: () => ({
    groupId: 10,
    setFabAction: vi.fn(),
    group: {
      id: 10,
      type: "TEAM",
      me: { userId: 1, displayName: "지우", color: "#5B6CF4", profileImageUrl: null, showBirthday: true },
    } as unknown as GroupDetail,
  }),
}));
let anniversaries: Anniversary[] = [];
vi.mock("@/hooks", () => ({
  messageOf: (_e: unknown, fallback: string) => fallback,
  useAnniversaries: () => ({ data: anniversaries, error: null, refetch: vi.fn(), setData: vi.fn() }),
  useBirthdays: () => ({ data: [], error: null, refetch: vi.fn() }),
  useCreateAnniversary: () => ({ mutate: create, isPending: false, error: null }),
  useUpdateAnniversary: () => ({ mutate: update, isPending: false, error: null }),
  useDeleteAnniversary: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock("@/lib/date", async (orig) => ({ ...(await orig<typeof import("@/lib/date")>()), todayKey: () => "2026-11-13" }));

const { AnniversariesScreen } = await import("../AnniversariesScreen");

const jiu = { userId: 1, displayName: "지우", color: "#5B6CF4", profileImageUrl: null };
const ANN: Anniversary = {
  id: 5,
  groupId: 10,
  name: "결혼기념일",
  date: "2020-05-02",
  kind: "YEARLY",
  reminders: ["DAY_BEFORE"],
  creator: jiu,
  createdAt: "2026-03-01T00:00:00.000Z",
};

beforeEach(() => {
  anniversaries = [ANN];
  create.mockResolvedValue({ ok: true, data: { ...ANN, id: 9 } });
  update.mockResolvedValue({ ok: true, data: ANN });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const openNew = () => fireEvent.click(screen.getByRole("button", { name: "기념일 추가" }));

describe("기념일 시트 (#378)", () => {
  it("추가: 라벨 글자, 0/30 없이 큰 칸, 날짜 줄, 종류 세그먼트, 알림 줄, 안내 한 줄, '추가'", async () => {
    render(<AnniversariesScreen />);
    openNew();
    const dialog = screen.getByRole("dialog", { name: "기념일 추가" });
    expect(dialog.textContent).not.toContain("0/30");
    const name = screen.getByLabelText("기념일 이름") as HTMLInputElement;
    expect(name.getAttribute("placeholder")).toBe("예: 처음 만난 날, 결혼기념일");
    expect(screen.getByRole("button", { name: /^기념일 날짜, 2026년 11월 13일/ }).textContent).toContain("날짜");
    expect(screen.getByRole("radio", { name: "함께한 날 세기" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("100일, 200일, 1주년이 달력에 자동으로 보여요")).toBeTruthy();
    expect(screen.getByRole("button", { name: "알림 오전 9시, 당일" })).toBeTruthy();
    const submit = screen.getByRole("button", { name: "추가" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // 글자 수는 24자부터
    fireEvent.change(name, { target: { value: "가".repeat(24) } });
    expect(screen.getByText("24/30")).toBeTruthy();
    fireEvent.change(name, { target: { value: "처음 만난 날" } });
    expect(screen.queryByText(/\/30$/)).toBeNull();
    await act(async () => {
      fireEvent.click(submit);
    });
    // 알림이 기본(당일) 그대로면 싣지 않는다
    expect(create).toHaveBeenCalledWith({ name: "처음 만난 날", date: "2026-11-13", kind: "COUNT_UP" });
  });

  it("알림 줄 → 여러 개 고르기. 일주일 전을 켜면 안내가 100일 단위 안내로 바뀌고 본문에 reminders", async () => {
    render(<AnniversariesScreen />);
    openNew();
    fireEvent.change(screen.getByLabelText("기념일 이름"), { target: { value: "100일" } });
    fireEvent.click(screen.getByRole("button", { name: "알림 오전 9시, 당일" }));
    fireEvent.click(screen.getByRole("button", { name: "일주일 전" }));
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    expect(screen.getByRole("button", { name: "알림 오전 9시, 당일, 일주일 전" })).toBeTruthy();
    expect(screen.getByText("100일 단위는 하루 전까지만 알려 드려요")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "매년 반복" }));
    expect(screen.getByText("생일처럼 매년 같은 날 달력에 보여요")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "추가" }));
    });
    expect(create).toHaveBeenCalledWith({ name: "100일", date: "2026-11-13", kind: "YEARLY", reminders: ["DAY_OF", "WEEK_BEFORE"] });
  });

  it("수정: 값이 채워지고 버튼은 '저장', 알림 '없음' 은 셋을 끈다", async () => {
    render(<AnniversariesScreen />);
    fireEvent.click(screen.getByRole("button", { name: /결혼기념일/ }));
    expect(screen.getByRole("dialog", { name: "기념일 수정" })).toBeTruthy();
    expect((screen.getByLabelText("기념일 이름") as HTMLInputElement).value).toBe("결혼기념일");
    expect(screen.getByRole("radio", { name: "매년 반복" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "알림 오전 9시, 하루 전" }));
    fireEvent.click(screen.getByRole("button", { name: "없음" }));
    expect(screen.getByRole("button", { name: "없음" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "하루 전" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.keyDown(screen.getByRole("button", { name: "없음" }), { key: "Escape" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
    });
    expect(update).toHaveBeenCalledWith({ id: 5, input: { name: "결혼기념일", date: "2020-05-02", kind: "YEARLY", reminders: [] } });
  });
});
