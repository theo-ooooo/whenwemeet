import { describe, expect, it } from "vitest";
import { lockDirection, resist, startsAtEdge, swipeOutcome, velocityOf } from "../month-swipe";

describe("startsAtEdge (좌우 24px 는 시스템 뒤로가기 몫)", () => {
  it.each([
    [0, true],
    [23, true],
    [24, false],
    [195, false],
    [366, false],
    [367, true],
    [389, true],
  ] as const)("390 폭에서 x=%i → %s", (x, want) => {
    expect(startsAtEdge(x, 390)).toBe(want);
  });
});

describe("lockDirection (|dx|>10 이고 |dx|>1.5|dy| 일 때만 가로)", () => {
  it("움직임이 작으면 아직 모른다", () => {
    expect(lockDirection(0, 0)).toBe("pending");
    expect(lockDirection(10, 0)).toBe("pending");
    expect(lockDirection(-8, 6)).toBe("pending");
  });
  it("가로가 충분히 크면 가로", () => {
    expect(lockDirection(11, 0)).toBe("horizontal");
    expect(lockDirection(-30, 19)).toBe("horizontal");
  });
  it("비스듬하면 가로로 보지 않는다", () => {
    expect(lockDirection(15, 10)).toBe("pending"); // 15 = 1.5 * 10, 초과가 아니다
    expect(lockDirection(15, 11)).toBe("vertical");
  });
  it("세로가 먼저 10 을 넘으면 세로 (스크롤에 양보)", () => {
    expect(lockDirection(2, 11)).toBe("vertical");
    expect(lockDirection(-5, -40)).toBe("vertical");
  });
});

describe("swipeOutcome (폭 22% 또는 0.35px/ms)", () => {
  const W = 378;
  it("짧고 느리면 제자리", () => {
    expect(swipeOutcome(-80, -0.1, W)).toBe(0); // 80 < 83.16
    expect(swipeOutcome(80, 0.2, W)).toBe(0);
    expect(swipeOutcome(0, 1, W)).toBe(0);
  });
  it("폭의 22% 를 넘기면 넘긴다. 왼쪽이 다음 달", () => {
    expect(swipeOutcome(-84, 0, W)).toBe(1);
    expect(swipeOutcome(84, 0, W)).toBe(-1);
  });
  it("짧아도 같은 방향으로 빠르게 튕기면 넘긴다", () => {
    expect(swipeOutcome(-30, -0.5, W)).toBe(1);
    expect(swipeOutcome(30, 0.36, W)).toBe(-1);
    expect(swipeOutcome(30, 0.35, W)).toBe(0); // 초과가 아니다
  });
  it("멀리 밀었어도 반대로 튕겨 되돌리면 취소", () => {
    expect(swipeOutcome(-150, 0.6, W)).toBe(0);
    expect(swipeOutcome(150, -0.4, W)).toBe(0);
  });
  it("멀리 밀고 천천히 반대로 움직이면 그대로 넘긴다", () => {
    expect(swipeOutcome(-150, 0.1, W)).toBe(1);
  });
  it("폭이 0 이면 아무것도 안 한다", () => {
    expect(swipeOutcome(-200, -1, 0)).toBe(0);
  });
});

describe("velocityOf", () => {
  it("표본이 하나면 0", () => {
    expect(velocityOf([{ x: 0, t: 0 }])).toBe(0);
  });
  it("마지막 100ms 안의 표본만 본다", () => {
    const s = [
      { x: 0, t: 0 },
      { x: 0, t: 500 }, // 오래 멈춘 뒤
      { x: -20, t: 540 },
      { x: -50, t: 580 },
    ];
    expect(velocityOf(s)).toBeCloseTo(-50 / 80);
  });
  it("창 안에 하나뿐이면 바로 앞 표본과 잰다", () => {
    expect(
      velocityOf([
        { x: 0, t: 0 },
        { x: 30, t: 300 },
      ]),
    ).toBeCloseTo(0.1);
  });
  it("시간 차가 0 이면 0", () => {
    expect(
      velocityOf([
        { x: 0, t: 5 },
        { x: 30, t: 5 },
      ]),
    ).toBe(0);
  });
});

describe("resist", () => {
  it("방향은 그대로, 거리는 조금 줄인다", () => {
    expect(resist(0, 390)).toBe(0);
    expect(resist(-100, 390)).toBeLessThan(0);
    expect(Math.abs(resist(-100, 390))).toBeLessThan(100);
    expect(Math.abs(resist(-100, 390))).toBeGreaterThan(90);
    expect(resist(390, 390)).toBeCloseTo(300);
    expect(resist(50, 0)).toBe(0);
  });
});
