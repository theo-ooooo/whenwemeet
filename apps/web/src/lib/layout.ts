// 화면 폭 구간 (docs/설계/폴더블.md 3장, D-58). JS 판단과 Tailwind 변형(fold:, lg:, wide:) 이 같은 경계를 쓴다
//   phone <600 : 지금 모바일 1단, 날짜 상세 = 바텀 시트
//   fold 600~1023 : 레일 + 2단(860 부터, 그 아래는 개요를 달력 아래로 #128), 날짜 상세 = 날짜 칸 옆 팝오버
//   pc ≥1024 : 2단 (1024~1199 는 레일, 1200 부터 사이드바), 날짜 상세 = 팝오버
// React 를 import 하지 않는다 (단위 테스트 대상)

export type Layout = "phone" | "fold" | "pc";

export const FOLD_MIN = 600;
export const PC_MIN = 1024;
/** 이 폭부터 레일 대신 PC 사이드바 */
export const SIDEBAR_MIN = 1200;
/** 이 폭부터 달력 옆에 개요 칸(272px)을 둔다. 600 에서 2단이면 달력(약 212px)이 칸보다 좁아진다 (#128).
 *  globals.css --breakpoint-split 과 같은 값 */
export const SPLIT_MIN = 860;

export const FOLD_QUERY = `(min-width: ${FOLD_MIN}px)`;
export const PC_QUERY = `(min-width: ${PC_MIN}px)`;

/** 폭(CSS px) → 배치 */
export function layoutOf(width: number): Layout {
  if (width >= PC_MIN) return "pc";
  if (width >= FOLD_MIN) return "fold";
  return "phone";
}

/** 왼쪽 레일을 쓰는 폭인지 (600~1199) */
export function hasRail(width: number): boolean {
  return width >= FOLD_MIN && width < SIDEBAR_MIN;
}

/** 달력 옆에 개요 칸을 두는 폭인지 (≥860). 아래 폭은 1단(phone 은 카드, fold 600~859 는 달력 아래 개요) */
export function hasSplit(width: number): boolean {
  return width >= SPLIT_MIN;
}

/** 레일 폭(AppShell 64px), 달력 화면 좌우 여백(fold:px-4), 2단 간격(gap-2), 개요 칸 폭(272, lg 부터 300) */
export const RAIL_W = 64;
const CAL_PAD_X = 32;
const SPLIT_GAP = 8;
export function overviewWidthOf(width: number): number {
  return width >= PC_MIN ? 300 : 272;
}

/** 레일 폭(600~1199)에서 달력 타일 폭(CSS px). 2단이면 개요 칸과 간격을 뺀다 */
export function calendarWidthOf(width: number): number {
  const body = width - RAIL_W - CAL_PAD_X;
  return hasSplit(width) ? body - SPLIT_GAP - overviewWidthOf(width) : body;
}

/** matchMedia 두 개의 결과 → 배치 (useLayout 이 쓴다) */
export function layoutFromMatches(fold: boolean, pc: boolean): Layout {
  return pc ? "pc" : fold ? "fold" : "phone";
}
