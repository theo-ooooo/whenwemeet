import { PULL_REFRESH_INITIAL, pullEnabled, pullOnScroll, pullOnTouchStart, pullOnWebAllow, type PullRefresh } from "../pull-refresh";

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

describe("웹이 알린 손짓 시작 위치 (#419)", () => {
  it("모달이나 스크롤된 안쪽 영역이면 문서가 맨 위여도 끈다", () => {
    const s = pullOnWebAllow(pullOnTouchStart(PULL_REFRESH_INITIAL), false);
    expect(s.armed).toBe(true);
    expect(pullEnabled(s)).toBe(false);
  });
  it("평범한 곳에서 다시 손짓하면 켠다", () => {
    const s = pullOnWebAllow(pullOnWebAllow(PULL_REFRESH_INITIAL, false), true);
    expect(pullEnabled(s)).toBe(true);
  });
  it("문서가 맨 위가 아니면 웹이 허용해도 끈다", () => {
    const s = pullOnWebAllow(run([["scroll", 300], ["touch"]]), true);
    expect(pullEnabled(s)).toBe(false);
  });
});
