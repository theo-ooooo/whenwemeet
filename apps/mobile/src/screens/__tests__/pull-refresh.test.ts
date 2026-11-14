import { PULL_REFRESH_INITIAL, pullOnScroll, pullOnTouchStart, type PullRefresh } from "../pull-refresh";

const run = (steps: (["scroll", number] | ["touch"])[], from: PullRefresh = PULL_REFRESH_INITIAL) =>
  steps.reduce((s, st) => (st[0] === "scroll" ? pullOnScroll(s, st[1]) : pullOnTouchStart(s)), from);

describe("당겨서 새로고침 판정 (#415)", () => {
  it("처음 열었을 때(맨 위)는 켜져 있다", () => {
    expect(run([["touch"]]).armed).toBe(true);
  });

  it("중간에서 위로 올리다 맨 위에 닿아도 같은 손짓에서는 꺼져 있다", () => {
    const s = run([["touch"], ["scroll", 800], ["touch"], ["scroll", 300], ["scroll", 0]]);
    expect(s.atTop).toBe(true);
    expect(s.armed).toBe(false);
  });

  it("맨 위에서 손을 뗐다가 다시 대면 켜진다", () => {
    const s = run([["scroll", 500], ["touch"], ["scroll", 0], ["touch"]]);
    expect(s.armed).toBe(true);
  });

  it("관성으로 맨 위에 닿은 뒤에도 다음 손짓 전까지는 꺼져 있다", () => {
    const s = run([["scroll", 1200], ["scroll", 0]]);
    expect(s.armed).toBe(false);
    expect(pullOnTouchStart(s).armed).toBe(true);
  });

  it("맨 위를 벗어나면 바로 끈다", () => {
    expect(run([["touch"], ["scroll", 1]]).armed).toBe(false);
  });

  it("바뀔 게 없으면 같은 객체(리렌더 없음)", () => {
    const s = PULL_REFRESH_INITIAL;
    expect(pullOnScroll(s, 0)).toBe(s);
    expect(pullOnTouchStart(s)).toBe(s);
  });
});
