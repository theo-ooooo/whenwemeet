// @vitest-environment happy-dom
// (#189) 투표 만들기 시트: 고른 구간이 후보(최소 길이)로, 후보 빼기, 제목 없으면 못 만듦, 보내는 본문(대상 기본 모두, 마감 없음)
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useCreatePoll: () => ({ mutate, isPending: false, error: null }),
}));
vi.mock("../AppShell", () => ({ useGroupContext: () => ({ group: null }) }));

const { PollCreateSheet } = await import("../PollCreateSheet");

const kst = (local: string) => new Date(`${local}+09:00`).toISOString();
const slots = [
  { startsAt: kst("2030-11-22T13:00"), endsAt: kst("2030-11-22T19:00") },
  { startsAt: kst("2030-11-23T10:00"), endsAt: kst("2030-11-23T12:00") },
  { startsAt: kst("2030-11-24T18:00"), endsAt: kst("2030-11-24T22:00") },
];
const members = [1, 2, 3].map((userId) => ({ userId, displayName: `m${userId}`, color: "#F26D6D", profileImageUrl: null }));

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

describe("PollCreateSheet (#189)", () => {
  it("고른 구간 3개가 최소 길이 후보로, 하나 빼고 제목을 적어 만들면 본문은 후보 2개 + 멤버 전원 id(#442) + 마감 없음", async () => {
    const onCreated = vi.fn();
    mutate.mockResolvedValue({ ok: true, data: { id: 1, publicCode: "poll1xxx" }, error: null });
    render(<PollCreateSheet open onClose={vi.fn()} groupId={10} members={members} meId={1} slots={slots} minMinutes={120} onCreated={onCreated} />);
    expect(screen.getByText("후보 3개")).toBeTruthy();
    expect(screen.getByText(/2030년 11월 22일 \(금\) 오후 1:00 ~ 3:00/)).toBeTruthy();
    const submit = screen.getByRole("button", { name: "투표 만들기" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /11월 23일 .* 후보 빼기/ }));
    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: " 저녁 약속 " } });
    expect(submit.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(submit);
    });
    expect(mutate).toHaveBeenCalledWith({
      title: "저녁 약속",
      options: [
        { startsAt: kst("2030-11-22T13:00"), endsAt: kst("2030-11-22T15:00"), allDay: false },
        { startsAt: kst("2030-11-24T18:00"), endsAt: kst("2030-11-24T20:00"), allDay: false },
      ],
      deadline: null,
      participants: [1, 2, 3],
    });
    expect(onCreated).toHaveBeenCalledWith({ id: 1, publicCode: "poll1xxx" });
  });

  it("서버 오류 문구를 보여 준다", async () => {
    mutate.mockResolvedValue({ ok: false, data: null, error: { status: 400, code: "VALIDATION_FAILED", message: "진행 중인 투표가 너무 많아요" } });
    render(<PollCreateSheet open onClose={vi.fn()} groupId={10} members={members} meId={1} slots={slots.slice(0, 2)} minMinutes={60} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "모임" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "투표 만들기" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("진행 중인 투표가 너무 많아요");
  });

  it("(#378) 후보는 한 줄씩. 구간이 긴 후보는 줄을 눌러 시작 시각을 고치고, 직접 추가는 같은 카드, 마감은 칸 안 세그먼트", async () => {
    mutate.mockResolvedValue({ ok: true, data: { id: 1, publicCode: "poll1xxx" }, error: null });
    render(<PollCreateSheet open onClose={vi.fn()} groupId={10} members={members} meId={1} slots={slots.slice(0, 2)} minMinutes={120} onCreated={vi.fn()} />);
    // 22일 구간(13~19시)은 2시간 후보라 줄을 눌러 시작을 고를 수 있고, 23일(10~12시)은 꽉 차 고칠 수 없다
    const row = screen.getByRole("button", { name: /2030년 11월 22일 .*, 시작 시각, 오후 1:00$/ });
    expect(row.textContent).toMatch(/오후 1:00 ~ 3:00/);
    expect(screen.queryByRole("button", { name: /11월 23일 .*, 시작 시각/ })).toBeNull();
    fireEvent.click(row);
    const typed = screen.getByPlaceholderText("HH:mm");
    fireEvent.change(typed, { target: { value: "16:30" } });
    fireEvent.keyDown(typed, { key: "Enter" });
    expect(screen.getByText(/2030년 11월 22일 \(금\) 오후 4:30 ~ 6:30/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "직접 추가" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "없음" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: /^대상/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "모임" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "투표 만들기" }));
    });
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.arrayContaining([{ startsAt: kst("2030-11-22T16:30"), endsAt: kst("2030-11-22T18:30"), allDay: false }]) }),
    );
  });
});
