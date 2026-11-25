// (#537) 관리자 대시보드 표기 (D-290). 단위 테스트 대상이라 React 를 import 하지 않는다
import type { AdminStats, AdminStatsRange } from "./types";

/** URL `?range=` (기본 7) */
export function statsRangeOf(raw: string | null): AdminStatsRange {
  return raw === "30" ? 30 : 7;
}

/** 'YYYY-MM-DD' → '11.25' */
export function statsDayLabel(day: string): string {
  return `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}`;
}

/** 막대 높이 비율 0~1. 최댓값이 0 이면 모두 0 */
export function barRatios(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max === 0 ? 0 : v / max));
}

/** 막대 그래프 x 축 글자를 몇 칸마다 둘지 (7일은 매일, 30일은 5일마다. 마지막 날은 늘) */
export function axisLabelEvery(count: number): number {
  return count <= 10 ? 1 : 5;
}

export function showAxisLabel(index: number, count: number): boolean {
  return index === count - 1 || index % axisLabelEvery(count) === 0;
}

/** 쓰는 곳 막대: 사람 수와 전체 사용자 대비 비율(정수 %). 한 사람이 여러 기종이면 합이 100 을 넘는다 */
export function platformRows(stats: Pick<AdminStats, "platforms" | "totals">): { key: string; label: string; count: number; percent: number }[] {
  const total = stats.totals.users;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
  const p = stats.platforms;
  return [
    { key: "ios", label: "iOS", count: p.ios, percent: pct(p.ios) },
    { key: "android", label: "Android", count: p.android, percent: pct(p.android) },
    { key: "web", label: "웹", count: p.web, percent: pct(p.web) },
    { key: "unknown", label: "앱 (기종 모름)", count: p.unknown, percent: pct(p.unknown) },
  ];
}

/** 숫자 천 단위 쉼표 */
export function statNumber(n: number): string {
  return n.toLocaleString("ko-KR");
}
