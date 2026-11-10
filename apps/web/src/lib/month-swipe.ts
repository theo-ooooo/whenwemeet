// 달력 좌우 스와이프로 달 이동 (#162). 손가락 판단만 담은 순수 함수. DOM 과 애니메이션은 useMonthSwipe.ts 가 맡는다.
// 왼쪽으로 밀면 다음 달(+1), 오른쪽으로 밀면 이전 달(-1). 세로 스크롤과 날짜 탭을 방해하지 않는 것이 먼저다.

/** 화면 좌우 가장자리 이만큼 안에서 시작한 손가락은 무시한다 (iOS 뒤로가기 쓸기, Android 시스템 뒤로) */
export const EDGE_GUARD = 24;
/** 가로로 판단하려면 이만큼은 움직여야 한다 */
export const LOCK_SLOP = 10;
/** 가로로 판단하려면 |dx| 가 |dy| 의 이 배수보다 커야 한다 */
export const LOCK_RATIO = 1.5;
/** 놓을 때 이동 거리가 달력 폭의 이 비율을 넘으면 넘긴다 */
export const COMMIT_RATIO = 0.22;
/** 또는 이 속도(px/ms)를 넘게 튕기면 넘긴다 */
export const COMMIT_VELOCITY = 0.35;
/** 속도는 마지막 이 시간(ms) 동안의 표본으로 잰다 */
export const VELOCITY_WINDOW = 100;
/** 넘어가고 들어오는 애니메이션 길이(ms). 각각 이만큼 */
export const SLIDE_MS = 220;

export type Lock = "pending" | "horizontal" | "vertical";

/** 시작 지점이 가장자리 보호 구역인지 */
export function startsAtEdge(x: number, viewportWidth: number, guard = EDGE_GUARD): boolean {
  return x < guard || x > viewportWidth - guard;
}

/**
 * 시작점에서 (dx, dy) 만큼 움직였을 때 방향을 정한다. 한 번 정해지면 호출부가 유지한다.
 * 가로: |dx| > 10 이고 |dx| > 1.5|dy|. 세로: 그 전에 세로로 10 을 넘으면 (브라우저 스크롤에 양보). 그 밖은 아직 모름
 */
export function lockDirection(dx: number, dy: number): Lock {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax > LOCK_SLOP && ax > LOCK_RATIO * ay) return "horizontal";
  if (ay > LOCK_SLOP) return "vertical";
  return "pending";
}

/** 손가락을 따라가는 거리. 멀리 밀수록 조금씩 덜 따라온다 (폭만큼 밀면 약 77%) */
export function resist(dx: number, width: number): number {
  if (width <= 0) return 0;
  return dx / (1 + (0.3 * Math.abs(dx)) / width);
}

export type Sample = { x: number; t: number };

/** 마지막 VELOCITY_WINDOW 안의 표본으로 가로 속도(px/ms). 표본이 모자라면 0 */
export function velocityOf(samples: readonly Sample[], window = VELOCITY_WINDOW): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[samples.length - 2];
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > window) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

/**
 * 놓았을 때 결과. +1 다음 달(왼쪽으로 밂), -1 이전 달(오른쪽으로 밂), 0 제자리로.
 * 거리가 폭의 22% 를 넘거나, 같은 방향으로 0.35px/ms 넘게 튕겼으면 넘긴다. 멀리 밀었어도 반대로 튕겨 되돌리면 넘기지 않는다
 */
export function swipeOutcome(dx: number, velocity: number, width: number): -1 | 0 | 1 {
  if (dx === 0 || width <= 0) return 0;
  const far = Math.abs(dx) > COMMIT_RATIO * width;
  const fast = Math.abs(velocity) > COMMIT_VELOCITY;
  const same = Math.sign(velocity) === Math.sign(dx);
  // 멀리 밀었어도 마지막에 반대로 튕겨 되돌리면 취소
  if (fast && !same) return 0;
  if (!far && !(fast && same)) return 0;
  return dx < 0 ? 1 : -1;
}
