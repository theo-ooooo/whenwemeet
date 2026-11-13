// @vitest-environment happy-dom
// (#305) 내 정보 "내 생일": 줄 값, 시트에서 월일 고르기(달 바꾸면 없는 날은 마지막 날), 2월 29일 안내, 알림 칩, 저장, 지우기, 실패
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

function select(label: string): HTMLSelectElement {
  return screen.getByLabelText(label) as HTMLSelectElement;
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

  it("월일을 골라 저장: 알림을 안 바꾸면 date 만, 달을 바꾸면 없는 날은 마지막 날", async () => {
    const onChange = vi.fn();
    mutate.mockResolvedValue(ok({ date: "04-30", reminders: ["DAY_OF"] }));
    render(<BirthdayRow value={NONE} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /내 생일/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.change(select("일"), { target: { value: "31" } });
    fireEvent.change(select("월"), { target: { value: "4" } });
    expect(select("일").value).toBe("30");
    expect(select("일").options).toHaveLength(30);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
    });
    expect(mutate).toHaveBeenCalledWith({ date: "04-30" });
    expect(onChange).toHaveBeenCalledWith({ date: "04-30", reminders: ["DAY_OF"] });
    expect(show).toHaveBeenCalledWith("생일을 저장했어요");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("2월 29일이면 평년 안내, 알림을 바꾸면 reminders 를 싣는다", async () => {
    mutate.mockResolvedValue(ok({ date: "02-29", reminders: ["DAY_OF", "DAY_BEFORE"] }));
    render(<BirthdayRow value={NONE} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /내 생일/ }));
    fireEvent.change(select("월"), { target: { value: "2" } });
    fireEvent.change(select("일"), { target: { value: "29" } });
    expect(screen.getByText("윤년이 아닌 해에는 2월 28일에 보여요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "하루 전" }));
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
    expect(select("월").value).toBe("12");
    expect(select("일").value).toBe("24");
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
