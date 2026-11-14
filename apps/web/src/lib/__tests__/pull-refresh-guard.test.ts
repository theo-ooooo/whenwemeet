import { describe, expect, it } from "vitest";
import { blocksPullRefresh, type GuardNode } from "../pull-refresh-guard";

type Opts = { attrs?: Record<string, string>; overflow?: string; scrollTop?: number; scrollHeight?: number; clientHeight?: number };
const node = (parent: GuardNode | null, o: Opts = {}): GuardNode & { overflow: string } => ({
  parentElement: parent,
  getAttribute: (k) => o.attrs?.[k] ?? null,
  scrollTop: o.scrollTop ?? 0,
  scrollHeight: o.scrollHeight ?? 100,
  clientHeight: o.clientHeight ?? 100,
  overflow: o.overflow ?? "visible",
});
const ov = (n: GuardNode) => (n as GuardNode & { overflow: string }).overflow;

describe("당겨서 새로고침 막기 판정 (#419)", () => {
  const body = node(null);

  it("평범한 화면은 막지 않는다", () => {
    expect(blocksPullRefresh(node(node(body)), ov, false)).toBe(false);
  });

  it("모달이 떠 있으면 어디를 눌러도 막는다", () => {
    expect(blocksPullRefresh(node(body), ov, true)).toBe(true);
  });

  it("다이얼로그 안의 요소면 막는다", () => {
    const dialog = node(body, { attrs: { role: "dialog" } });
    expect(blocksPullRefresh(node(node(dialog)), ov, false)).toBe(true);
  });

  it("위로 스크롤된 안쪽 영역이면 막는다", () => {
    const list = node(body, { overflow: "auto", scrollTop: 120, scrollHeight: 900, clientHeight: 400 });
    expect(blocksPullRefresh(node(list), ov, false)).toBe(true);
  });

  it("안쪽 영역이 맨 위면 막지 않는다", () => {
    const list = node(body, { overflow: "auto", scrollTop: 0, scrollHeight: 900, clientHeight: 400 });
    expect(blocksPullRefresh(node(list), ov, false)).toBe(false);
  });

  it("스크롤이 없는 overflow auto 는 무시", () => {
    const box = node(body, { overflow: "auto", scrollTop: 5, scrollHeight: 100, clientHeight: 100 });
    expect(blocksPullRefresh(node(box), ov, false)).toBe(false);
  });
});
