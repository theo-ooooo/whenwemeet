// 폰 달력 칸의 일정 밀도 표시 (#139). 일정 하나에 점 하나(만든 사람 색), 최대 max 개. 넘치면 "+N"
// 예전에는 멤버 색을 중복 없이 모아 그려서 한 사람이 7개를 넣은 날도 점 1개로 보였다
type CellEvent = { creator: { color: string } };

export type CellDensity = { dots: string[]; more: number };

export function cellDensity(events: readonly CellEvent[], max = 3): CellDensity {
  const dots = events.slice(0, max).map((e) => e.creator.color);
  return { dots, more: Math.max(0, events.length - dots.length) };
}
