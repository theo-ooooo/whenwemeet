// @vitest-environment happy-dom
// (#305) 내 정보 "내 생일": 줄 값, 시트에서 월일 고르기, 2월 29일 안내, 알림, 저장, 지우기, 실패.
// (#378) 기기 선택 상자 둘 대신 생일 줄(월, 일 고르기) 하나, 알림은 줄 → 고르기
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BirthdaySettings } from "@/lib/types";

type Outcome<T> = { ok: true; data: T; error: null } | { ok: false; data: null; error: { message?: string } };
const mutate = vi.fn<(input: { date: string | null; reminders?: string[] }) => Promise<Outcome<BirthdaySettings>>>();
const show = vi.fn();

vi.mock("@/components/Toast", () => ({ useToast: () => ({ show }) }));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useUpdateBirthday: () => ({ mutate, isPending: false, error: null }),
}));
vi.mock("@/components/ReminderPicker", () => ({ ReminderNote: () => null }));

const { BirthdayRow } = await import("../BirthdayRow");

const ok = <T,>(d: T): Outcome<T> => ({ ok: true, data: d, error: null });
const NONE: BirthdaySettings = { date: null, reminders: ["DAY_OF"] };

/** (#378) 생일 줄을 눌러 월, 일 고르기를 열고 달, 날을 누른다 */
function pickMonthDay(m: number, d: number) {
  fireEvent.click(screen.getByRole("button", { name: /^생일,/ }));
  fireEvent.click(screen.getByRole("radio", { name: `${m}월` }));
  fireEvent.click(screen.getByRole("button", { name: `${m}월 ${d}일` }));
}

describe("BirthdayRow (#305)", () => {
  beforeEach(() => {
    mutate.mockReset();
    show.mockReset();
    window.location.hash = "";
  });
  afterEach(cleanup);

  it("값이 없으면 '넣지 않음', 받기 전에는 누를 수 없다", () => {
    const { rerender } = render(<BirthdayRow value={undefined} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /내 생일/ })).toHaveProperty("disabled", true);
    rerender(<BirthdayRow value={NONE} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /내 생일/ }).textContent).toContain("넣지 않음");
  });

  it("월일을 골라 저장: 고르기 전에는 저장 못 함, 알림을 안 바꾸면 date 만, 달마다 그 달 날 수만큼", async () => {
    const onChange = vi.fn();
    mutate.mockResolvedValue(ok({ date: "04-30", reminders: ["DAY_OF"] }));
    render(<BirthdayRow value={NONE} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /내 생일/ }));
    expect(screen.getByRole("dialog", { name: "내 생일" })).toBeTruthy();
    // 기기 기본 선택 상자 대신 날짜 줄 하나 (#378)
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "생일, 선택 안 함" }).textContent).toContain("고르기");
    expect((screen.getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^생일,/ }));
    fireEvent.click(screen.getByRole("radio", { name: "4월" }));
    expect(screen.getByRole("group", { name: "4월 날짜" }).querySelectorAll("button")).toHaveLength(30);
    fireEvent.click(screen.getByRole("radio", { name: "2월" }));
    expect(screen.getByRole("group", { name: "2월 날짜" }).querySelectorAll("button")).toHaveLength(29);
    fireEvent.click(screen.getByRole("radio", { name: "4월" }));
    fireEvent.click(screen.getByRole("button", { name: "4월 30일" }));
    // 날을 누르면 고르기가 닫히고 줄에 값
    expect(screen.queryByRole("group", { name: "4월 날짜" })).toBeNull();
    expect(screen.getByRole("button", { name: "생일, 4월 30일" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
    });
    expect(mutate).toHaveBeenCalledWith({ date: "04-30" });
    expect(onChange).toHaveBeenCalledWith({ date: "04-30", reminders: ["DAY_OF"] });
    expect(show).toHaveBeenCalledWith("생일을 저장했어요");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("2월 29일이면 평년 안내, 알림 줄에서 시점을 바꾸면 reminders 를 싣는다", async () => {
    mutate.mockResolvedValue(ok({ date: "02-29", reminders: ["DAY_OF", "DAY_BEFORE"] }));
    render(<BirthdayRow value={NONE} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /내 생일/ }));
    pickMonthDay(2, 29);
    expect(screen.getByText("윤년이 아닌 해에는 2월 28일에 보여요")).toBeTruthy();
    // 알림은 줄 → 고르기 (여러 개, 기념일과 같은 규칙)
    fireEvent.click(screen.getByRole("button", { name: "팀원에게 알림 오전 9시, 당일" }));
    fireEvent.click(screen.getByRole("button", { name: "하루 전" }));
    expect(screen.getByRole("button", { name: "하루 전" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    expect(screen.getByRole("button", { name: "팀원에게 알림 오전 9시, 당일, 하루 전" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
    });
    expect(mutate).toHaveBeenCalledWith({ date: "02-29", reminders: ["DAY_OF", "DAY_BEFORE"] });
  });

  it("있는 생일은 시트에 채워지고 '생일 지우기' 는 date null, 실패하면 시트에 오류", async () => {
    const onChange = vi.fn();
    render(<BirthdayRow value={{ date: "12-24", reminders: ["WEEK_BEFORE"] }} onChange={onChange} />);
    expect(screen.getByRole("button", { name: /내 생일/ }).textContent).toContain("12월 24일");
    fireEvent.click(screen.getByRole("button", { name: /내 생일/ }));
    expect(screen.getByRole("button", { name: "생일, 12월 24일" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "팀원에게 알림 오전 9시, 일주일 전" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "생일, 12월 24일" }));
    expect(screen.getByRole("radio", { name: "12월" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "12월 24일" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(screen.getByRole("button", { name: "12월 24일" }), { key: "Escape" });
    mutate.mockResolvedValueOnce({ ok: false, data: null, error: { message: "잠시 후 다시 시도해 주세요" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "생일 지우기" }));
    });
    expect(mutate).toHaveBeenCalledWith({ date: null });
    expect(screen.getByRole("alert").textContent).toBe("잠시 후 다시 시도해 주세요");
    expect(onChange).not.toHaveBeenCalled();

    mutate.mockResolvedValueOnce(ok({ date: null, reminders: ["WEEK_BEFORE"] }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "생일 지우기" }));
    });
    expect(onChange).toHaveBeenCalledWith({ date: null, reminders: ["WEEK_BEFORE"] });
    expect(show).toHaveBeenCalledWith("생일을 지웠어요");
  });

  it("/me#birthday 로 열리면 값을 받자마자 시트를 연다", async () => {
    window.location.hash = "#birthday";
    const { rerender } = render(<BirthdayRow value={undefined} onChange={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      rerender(<BirthdayRow value={NONE} onChange={vi.fn()} />);
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
