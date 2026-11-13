// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEventDraft } from "../useEventDraft";
import { quickDraft } from "@/lib/event-draft";

const D = "2026-11-20";

describe("useEventDraft (#359)", () => {
  it("처음 값과 같으면 dirty 가 아니고, 바꾸면 dirty, 되돌리면 다시 아님", () => {
    const { result } = renderHook(() => useEventDraft("day", () => quickDraft(D)));
    expect(result.current.loaded).toBe(true);
    expect(result.current.dirty).toBe(false);
    act(() => result.current.dispatch({ type: "title", value: "a" }));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.dispatch({ type: "title", value: "" }));
    expect(result.current.dirty).toBe(false);
  });

  it("span 규칙대로 바꾼다 (빠른 추가는 자정에서 멈춤)", () => {
    const { result } = renderHook(() => useEventDraft("day", () => quickDraft(D)));
    act(() => result.current.dispatch({ type: "start", date: D, time: "23:30" }));
    expect(result.current.draft.endTime).toBe("24:00");
  });

  it("waitForLoad 면 load 전까지 처음 값이 없고 dirty 도 아니다. load 하면 그 값이 처음 값", () => {
    const { result } = renderHook(() => useEventDraft("range", () => quickDraft(D), { waitForLoad: true }));
    expect(result.current.loaded).toBe(false);
    act(() => result.current.dispatch({ type: "title", value: "a" }));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.load({ ...quickDraft(D), title: "불러온 값" }));
    expect(result.current.loaded).toBe(true);
    expect(result.current.initial?.title).toBe("불러온 값");
    expect(result.current.draft.title).toBe("불러온 값");
    expect(result.current.dirty).toBe(false);
    act(() => result.current.dispatch({ type: "memo", value: "m" }));
    expect(result.current.dirty).toBe(true);
  });

  it("touch 는 한 번 켜지면 그대로", () => {
    const { result } = renderHook(() => useEventDraft("day", () => quickDraft(D)));
    expect(result.current.touched).toBe(false);
    act(() => result.current.touch());
    act(() => result.current.touch());
    expect(result.current.touched).toBe(true);
  });
});
