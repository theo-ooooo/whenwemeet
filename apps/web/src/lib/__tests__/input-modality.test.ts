// (#339) 마지막 입력 방식: 키보드로 연 패널만 제목 포커스 테두리를 그린다
import { afterEach, describe, expect, it } from "vitest";
import { lastInputWasKeyboard, resetInputModality, trackInputModality } from "../input-modality";

type Listener = (e: { key?: string }) => void;

/** document 대신 쓰는 가짜 대상. 건 리스너를 이름별로 모은다 */
function fakeTarget() {
  const map = new Map<string, Set<Listener>>();
  const target = {
    addEventListener: (type: string, fn: Listener) => {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: Listener) => {
      map.get(type)?.delete(fn);
    },
  };
  const fire = (type: string, e: { key?: string } = {}) => map.get(type)?.forEach((fn) => fn(e));
  const count = () => [...map.values()].reduce((n, s) => n + s.size, 0);
  return { target: target as unknown as Document, fire, count };
}

afterEach(resetInputModality);

describe("input-modality", () => {
  it("아무 입력 없이(주소로 바로 연 경우) 는 키보드가 아니다", () => {
    expect(lastInputWasKeyboard()).toBe(false);
  });

  it("키를 누르면 키보드, 포인터를 누르면 포인터", () => {
    const t = fakeTarget();
    const stop = trackInputModality(t.target);
    t.fire("keydown", { key: "Enter" });
    expect(lastInputWasKeyboard()).toBe(true);
    t.fire("pointerdown");
    expect(lastInputWasKeyboard()).toBe(false);
    t.fire("keydown", { key: "Tab" });
    expect(lastInputWasKeyboard()).toBe(true);
    stop();
  });

  it("수정 키만 누른 것은 입력 방식을 바꾸지 않는다 (Cmd+클릭)", () => {
    const t = fakeTarget();
    const stop = trackInputModality(t.target);
    t.fire("pointerdown");
    t.fire("keydown", { key: "Meta" });
    t.fire("keydown", { key: "Shift" });
    expect(lastInputWasKeyboard()).toBe(false);
    stop();
  });

  it("되돌리면 리스너를 모두 뗀다", () => {
    const t = fakeTarget();
    const stop = trackInputModality(t.target);
    expect(t.count()).toBe(2);
    stop();
    expect(t.count()).toBe(0);
  });
});
