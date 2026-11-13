// @vitest-environment happy-dom
// (#278) 팀 만들기 쓰임 칩: 예시 이름 채우기, 요청 본문의 preset, 만든 뒤 첫 단계(또는 지금처럼 초대), 이 기기 안내 저장
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const mutate = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/Logo", () => ({ Symbol: () => null }));
vi.mock("@/hooks", () => ({
  messageOf: (_: unknown, f: string) => f,
  useCreateGroup: () => ({ mutate, isPending: false, error: null }),
}));

const { NewGroupScreen } = await import("../NewGroupScreen");

beforeEach(() => {
  mutate.mockResolvedValue({ ok: true, data: { id: 42 } });
});
afterEach(() => {
  cleanup();
  replace.mockReset();
  mutate.mockReset();
  localStorage.clear();
  document.cookie = "wwm_group=; Max-Age=0; Path=/";
});

const nameInput = () => screen.getByLabelText("팀 이름") as HTMLInputElement;
const chip = (name: string) => screen.getByRole("radio", { name });
const submit = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "만들기" }));
  });
};

describe("NewGroupScreen 쓰임 칩", () => {
  it("처음은 직접 정하기, 칩 다섯 개", () => {
    render(<NewGroupScreen />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["커플", "가족", "친구", "스터디", "직접 정하기"]);
    expect(chip("직접 정하기").getAttribute("aria-checked")).toBe("true");
    expect(nameInput().value).toBe("");
  });

  it("칩을 고르면 예시 이름, 고친 이름은 다른 칩을 골라도 그대로", () => {
    render(<NewGroupScreen />);
    fireEvent.click(chip("커플"));
    expect(nameInput().value).toBe("우리 둘");
    fireEvent.click(chip("가족"));
    expect(nameInput().value).toBe("우리 가족");
    fireEvent.change(nameInput(), { target: { value: "김씨네" } });
    fireEvent.click(chip("스터디"));
    expect(nameInput().value).toBe("김씨네");
  });

  it("화살표로 칩을 옮겨 고른다", () => {
    render(<NewGroupScreen />);
    fireEvent.keyDown(chip("직접 정하기"), { key: "ArrowRight" });
    expect(chip("커플").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(chip("커플"), { key: "End" });
    expect(chip("직접 정하기").getAttribute("aria-checked")).toBe("true");
  });

  it("칩을 골라 만들면 preset 을 싣고 이 기기에 안내를 남긴 뒤 첫 단계로", async () => {
    render(<NewGroupScreen />);
    fireEvent.click(chip("스터디"));
    await submit();
    expect(mutate).toHaveBeenCalledWith({ name: "목요 스터디", preset: "study" });
    expect(localStorage.getItem("wwm.start.42")).toBe("study");
    expect(replace).toHaveBeenCalledWith("/groups/start?preset=study");
  });

  it("직접 정하기는 지금 흐름 그대로 (preset 없음, 초대 화면, 안내 없음)", async () => {
    render(<NewGroupScreen />);
    fireEvent.change(nameInput(), { target: { value: "우리 팀" } });
    await submit();
    expect(mutate).toHaveBeenCalledWith({ name: "우리 팀" });
    expect(localStorage.getItem("wwm.start.42")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/team?invite=1");
  });

  it("칩을 고른 뒤 이름을 지우면 만들 수 없다", () => {
    render(<NewGroupScreen />);
    fireEvent.click(chip("친구"));
    fireEvent.change(nameInput(), { target: { value: " " } });
    expect((screen.getByRole("button", { name: "만들기" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("만들기 실패면 이동하지 않고 안내도 남기지 않는다", async () => {
    mutate.mockResolvedValue({ ok: false, error: { status: 500 } });
    render(<NewGroupScreen />);
    fireEvent.click(chip("커플"));
    await submit();
    expect(replace).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
});

describe("NewGroupScreen 옛 API", () => {
  it("쓰임을 모르는 API 가 400 이면 쓰임 없이 한 번 더 보내고 첫 단계로 간다", async () => {
    mutate.mockResolvedValueOnce({ ok: false, error: { status: 400 } }).mockResolvedValueOnce({ ok: true, data: { id: 43 } });
    render(<NewGroupScreen />);
    fireEvent.click(chip("가족"));
    await submit();
    expect(mutate.mock.calls).toEqual([[{ name: "우리 가족", preset: "family" }], [{ name: "우리 가족" }]]);
    expect(replace).toHaveBeenCalledWith("/groups/start?preset=family");
  });
});
