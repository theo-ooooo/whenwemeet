// 공유 미리보기 이미지(#159) 의 순수 계산. 그림(JSX)은 app/_og/card.tsx, 여기는 단위 테스트 대상이라 React 를 import 하지 않는다

/** 팀 이름은 최대 2줄. 길이에 따라 글자 크기를 줄이고, 그래도 넘칠 만큼 길면 말줄임 */
export const TEAM_NAME_MAX = 24;

/** 화면 표시 길이(한글, 이모지 1자로 센다) */
export function charLength(s: string): number {
  return Array.from(s).length;
}

/** (#196) "{이름}님이 초대했어요" 의 이름 최대 길이 */
export const INVITER_NAME_MAX = 20;

export function clampTeamName(name: string, max = TEAM_NAME_MAX): string {
  const chars = Array.from(name.trim().replace(/\s+/g, " "));
  if (chars.length <= max) return chars.join("");
  return `${chars
    .slice(0, max - 1)
    .join("")
    .trimEnd()}…`;
}

/** 왼쪽 글 칸(약 620px)에 2줄 안으로 들어가는 크기. 한글 한 자 폭은 글자 크기의 약 0.95 */
export function teamNameFontSize(name: string): number {
  const n = charLength(name);
  if (n <= 6) return 104;
  if (n <= 10) return 88;
  if (n <= 16) return 72;
  return 60;
}

/** 팀 이름 줄의 폭(px). card.tsx OgCopy maxWidth 와 같은 값 */
export const TEAM_NAME_WIDTH = 580;

/** 띄어쓰기 없이 긴 낱말이 한 줄을 넘으면 글자 단위로 끊는다. 아니면 낱말 단위(keep-all) */
export function teamNameWordBreak(name: string, fontSize: number): "keep-all" | "break-all" {
  const longest = Math.max(...name.split(/\s+/).map(charLength));
  return longest * fontSize * 0.95 > TEAM_NAME_WIDTH ? "break-all" : "keep-all";
}

export type MiniDay = { day: number | null; weekday: number };

/** KST 기준 그 달의 달력 칸(일요일 시작). 앞쪽 빈칸은 day=null */
export function monthGrid(now: Date): { year: number; month: number; today: number; cells: MiniDay[] } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth(); // 0~11
  const today = kst.getUTCDate();
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: MiniDay[] = [];
  for (let i = 0; i < first; i++) cells.push({ day: null, weekday: i });
  for (let d = 1; d <= days; d++) cells.push({ day: d, weekday: (first + d - 1) % 7 });
  while (cells.length % 7 !== 0) cells.push({ day: null, weekday: cells.length % 7 });
  return { year, month: month + 1, today, cells };
}

/** 그림 속 "모두 비는 날": 오늘 이후 첫 토요일 (달을 넘기면 그 달 마지막 토요일) */
export function freeDayOf(cells: MiniDay[], today: number): number {
  const sats = cells.filter((c) => c.day !== null && c.weekday === 6).map((c) => c.day as number);
  return sats.find((d) => d > today) ?? sats[sats.length - 1];
}
