// @vitest-environment happy-dom
// (#199) 일정 폼의 장소 칸: 적으면 후보, 고르면 onPick, 키보드 고르기, 검색 실패 안내, 지우기
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/types";

type Q = { data: { items: PlaceCandidate[] } | null; error: { code: string } | null; isLoading: boolean };
let result: Q = { data: null, error: null, isLoading: false };
const searched = vi.fn();
vi.mock("@/hooks", () => ({
  usePlaceResolve: (p: unknown) => ({ data: p ? { place: { name: "다시 찾은 서울숲", address: "서울 성동구" } } : null, error: null }),
  usePlaceSearch: (q: string, provider: string, enabled: boolean) => {
    searched(q, provider, enabled);
    return { ...result, refetch: vi.fn(), setData: vi.fn() };
  },
}));

const { PlaceField } = await import("../PlaceField");

const C = (id: string, name: string): PlaceCandidate => ({ provider: "kakao", kakaoPlaceId: id, naverKey: null, name, address: `${name} 주소`, lat: 37.5, lng: 127, category: "카페" });
const N = (key: string, name: string): PlaceCandidate => ({ provider: "naver", kakaoPlaceId: null, naverKey: key, name, address: `${name} 주소`, lat: 37.5, lng: 127, category: "카페" });

function setup(text = "카페", picked: null | { name: string | null } = null) {
  const onType = vi.fn();
  const onPick = vi.fn();
  const onClear = vi.fn();
  render(
    <PlaceField
      place={{ text: picked ? "" : text, picked: picked ? { provider: "kakao", id: "1", query: "숲", name: picked.name, address: picked.name ? "서울" : null } : null }}
      onType={onType}
      onPick={onPick}
      onClear={onClear}
    />,
  );
  return { onType, onPick, onClear, input: screen.queryByRole("combobox", { name: "장소" }) as HTMLInputElement };
}

afterEach(() => {
  cleanup();
  searched.mockClear();
  result = { data: null, error: null, isLoading: false };
});

describe("PlaceField", () => {
  it("포커스하면 후보를 띄우고, 누르면 고른다", () => {
    result = { data: { items: [C("1", "카페 온화"), C("2", "카페 달")] }, error: null, isLoading: false };
    const { onPick, input } = setup();
    fireEvent.focus(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.click(screen.getByRole("option", { name: /카페 달/ }));
    // 고를 때 적혀 있던 사용자 검색어를 같이 넘긴다 (저장하는 것은 ID 와 검색어뿐)
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kakaoPlaceId: "2" }), "카페");
  });

  it("화살표와 엔터로 고른다. Esc 는 목록만 닫는다", () => {
    result = { data: { items: [C("1", "카페 온화"), C("2", "카페 달")] }, error: null, isLoading: false };
    const { onPick, input } = setup();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toMatch(/-1$/);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kakaoPlaceId: "2" }), "카페");
  });

  it("적으면 onType. 고른 장소는 입력칸 대신 카드(고른 순간 이름), 불러온 일정은 다시 찾은 이름, 풀기", () => {
    const { onType, input } = setup("서울");
    fireEvent.change(input, { target: { value: "서울숲 정문" } });
    expect(onType).toHaveBeenCalledWith("서울숲 정문");
    cleanup();
    searched.mockClear();
    const { onClear } = setup("", { name: "서울숲" });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("서울숲")).toBeTruthy();
    expect(searched).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
    fireEvent.click(screen.getByRole("button", { name: "고른 장소 풀기" }));
    expect(onClear).toHaveBeenCalled();
    cleanup();
    setup("", { name: null });
    expect(screen.getByText("다시 찾은 서울숲")).toBeTruthy();
  });

  it("검색이 안 되면(503 등) 적은 이름 그대로 저장된다고 알린다", () => {
    result = { data: null, error: { code: "PLACE_SEARCH_NOT_CONFIGURED" }, isLoading: false };
    const { input } = setup("우리 집");
    fireEvent.focus(input);
    expect(screen.getByText("지금은 장소를 찾을 수 없어요. 적은 이름 그대로 저장돼요")).toBeTruthy();
  });

  it("(D-259) 검색 출처는 지도 선택(기본 네이버). 결과 출처를 작게 한 줄, 카카오맵으로 바꾸면 카카오로 찾는다", () => {
    result = { data: { items: [N("0123456789abcdef", "서울숲")] }, error: null, isLoading: false };
    const { onPick, input } = setup("서울숲");
    fireEvent.focus(input);
    expect(searched).toHaveBeenLastCalledWith("서울숲", "naver", true);
    expect(screen.getByText("네이버 검색 결과")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /서울숲/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ provider: "naver", naverKey: "0123456789abcdef" }), "서울숲");
    cleanup();
    window.localStorage.setItem("wwm_map_app", "kakao");
    try {
      result = { data: { items: [C("1", "서울숲")] }, error: null, isLoading: false };
      const again = setup("서울숲");
      fireEvent.focus(again.input);
      expect(searched).toHaveBeenLastCalledWith("서울숲", "kakao", true);
      expect(screen.getByText("카카오 검색 결과")).toBeTruthy();
    } finally {
      window.localStorage.removeItem("wwm_map_app");
    }
  });

  it("(D-259) 고른 네이버 장소 안내는 네이버로", () => {
    render(
      <PlaceField place={{ text: "", picked: { provider: "naver", id: "0123456789abcdef", query: "숲", name: "서울숲", address: "서울" } }} onType={vi.fn()} onPick={vi.fn()} onClear={vi.fn()} />,
    );
    expect(document.body.textContent).toContain("네이버 장소로 저장돼요");
  });

  it("지우기 단추", () => {
    const { onClear } = setup("집");
    fireEvent.click(screen.getByRole("button", { name: "장소 지우기" }));
    expect(onClear).toHaveBeenCalled();
  });
});
