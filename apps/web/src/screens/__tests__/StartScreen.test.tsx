// @vitest-environment happy-dom
// (#278) 첫 단계 화면: 커플 저장, 저장 실패 (#378 새로 만드는 단계의 버튼은 "추가"), 건너뛰기, 가족 내 생일(#305), 친구, 스터디 매주 일정, 멤버 아님
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveStart } from "@/lib/start-guide";

const replace = vi.fn();
const createAnniversary = vi.fn();
const createEvent = vi.fn();
let groupError: { status: number } | null = null;
let me: { birthday?: { date: string | null } } | null = null;

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, className }: { href: string; children: React.ReactNode; onClick?: () => void; className?: string }) => (
    <a href={href} className={className} onClick={(e) => (e.preventDefault(), onClick?.())}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/Logo", () => ({ Symbol: () => null }));
vi.mock("@/components/GroupGone", () => ({ GroupGone: () => <p>이 팀을 열 수 없어요</p> }));
vi.mock("@/components/pickers", () => ({
  DatePicker: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} data-testid="date" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
  TimePicker: ({ id, label, value, onChange }: { id?: string; label: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, f: string) => e?.message ?? f,
  useGroup: () => ({ data: null, error: groupError, isLoading: false, refetch: vi.fn() }),
  useMe: () => ({ data: me, error: null, isLoading: false, refetch: vi.fn() }),
  useCreateAnniversary: () => ({ mutate: createAnniversary, isPending: false, error: null }),
  useCreateEvent: () => ({ mutate: createEvent, isPending: false, error: null }),
}));

const { StartScreen } = await import("../StartScreen");

beforeEach(() => {
  groupError = null;
  me = null;
  createAnniversary.mockResolvedValue({ ok: true, data: {} });
  createEvent.mockResolvedValue({ ok: true, data: {} });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

describe("StartScreen", () => {
  it("커플: 처음 만난 날을 COUNT_UP 으로 저장하고 첫 단계를 끝낸 뒤 초대 화면으로", async () => {
    saveStart(9, "two");
    render(<StartScreen groupId={9} preset="two" fromCalendar={false} />);
    expect(screen.getByRole("heading").textContent).toBe("처음 만난 날이언제예요?");
    fireEvent.change(screen.getByTestId("date"), { target: { value: "2025-10-03" } });
    expect(screen.getByText(/일째예요/)).toBeTruthy();
    await click("추가");
    expect(createAnniversary).toHaveBeenCalledWith({ name: "처음 만난 날", date: "2025-10-03", kind: "COUNT_UP" });
    expect(localStorage.getItem("wwm.start.9")).toBe("two:first");
    expect(replace).toHaveBeenCalledWith("/team?invite=1");
  });

  it("달력 안내에서 다시 열었으면 추가 뒤 달력으로", async () => {
    render(<StartScreen groupId={9} preset="two" fromCalendar />);
    await click("추가");
    expect(replace).toHaveBeenCalledWith("/calendar");
  });

  it("저장 실패면 머물고 안내도 그대로", async () => {
    createAnniversary.mockResolvedValue({ ok: false, error: { status: 429 } });
    saveStart(9, "two");
    render(<StartScreen groupId={9} preset="two" fromCalendar={false} />);
    await click("추가");
    expect(replace).not.toHaveBeenCalled();
    expect(localStorage.getItem("wwm.start.9")).toBe("two");
  });

  it("건너뛰면 안내를 남긴 채 초대 화면으로", async () => {
    saveStart(9, "study");
    render(<StartScreen groupId={9} preset="study" fromCalendar={false} />);
    await click("건너뛰기");
    expect(replace).toHaveBeenCalledWith("/team?invite=1");
    expect(localStorage.getItem("wwm.start.9")).toBe("study");
  });

  it("가족: 생일이 없으면 내 정보 생일 칸으로 가는 링크", () => {
    me = { birthday: { date: null } };
    saveStart(9, "family");
    render(<StartScreen groupId={9} preset="family" fromCalendar={false} />);
    expect(screen.getByText("아직 없어요")).toBeTruthy();
    const link = screen.getByRole("link", { name: "내 생일 넣기" });
    expect(link.getAttribute("href")).toBe("/me#birthday");
    fireEvent.click(link);
    expect(localStorage.getItem("wwm.start.9")).toBe("family:birthday");
  });

  it("가족: 이미 생일이 있으면 보여 주고 다음으로", async () => {
    me = { birthday: { date: "03-05" } };
    render(<StartScreen groupId={9} preset="family" fromCalendar={false} />);
    expect(screen.getByText("3월 5일")).toBeTruthy();
    await click("다음");
    expect(replace).toHaveBeenCalledWith("/team?invite=1");
  });

  it("친구: 만드는 것 없이 초대 화면으로", async () => {
    render(<StartScreen groupId={9} preset="friends" fromCalendar={false} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "1단계, 친구들을 초대해요",
      "2단계, 모두 비는 시간을 찾아요",
      "3단계, 후보를 골라 투표로 정해요",
    ]);
    await click("초대하러 가기");
    expect(replace).toHaveBeenCalledWith("/team?invite=1");
  });

  it("스터디: 매주 반복, 모두 참여. 끝이 시작보다 이르면 저장 못 함", async () => {
    render(<StartScreen groupId={9} preset="study" fromCalendar={false} />);
    fireEvent.click(screen.getByRole("radio", { name: "목" }));
    fireEvent.change(screen.getByLabelText("끝 시각"), { target: { value: "18:00" } });
    expect(screen.getByRole("alert").textContent).toBe("끝 시각이 시작보다 늦어야 해요");
    expect((screen.getByRole("button", { name: "추가" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("끝 시각"), { target: { value: "21:30" } });
    expect(screen.getByText(/^첫 모임은 \d+월 \d+일 \(목\)/)).toBeTruthy();
    await click("추가");
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ title: "정기 모임", repeat: "WEEKLY", participants: "ALL", allDay: false }));
    const body = createEvent.mock.calls[0][0] as { startsAt: string; endsAt: string };
    expect(Date.parse(body.endsAt) - Date.parse(body.startsAt)).toBe(150 * 60_000);
    expect(new Date(Date.parse(body.startsAt) + 9 * 3600_000).getUTCDay()).toBe(4);
  });

  it("멤버가 아니거나 없는 팀이면 팀 화면과 같은 안내", () => {
    groupError = { status: 403 };
    render(<StartScreen groupId={9} preset="two" fromCalendar={false} />);
    expect(screen.getByText("이 팀을 열 수 없어요")).toBeTruthy();
  });
});
