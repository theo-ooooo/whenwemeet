// (#562) 음력 ↔ 양력 변환 (설계 음력.md, D-297). React 를 import 하지 않는 순수 함수 (단위 테스트 대상).
// 변환표는 한국천문연구원 기준 `korean-lunar-calendar` (음력 1000-01-01 ~ 2050-11-18). 범위 밖은 null.
// 서버 apps/api/src/common/lunar.ts 와 같은 규칙: 윤달이 없는 해는 평달, 그 달에 없는 30일은 그 달 마지막 날
import KoreanLunarCalendar from "korean-lunar-calendar";
import { keyOf, type DateKey } from "./date";

/** 기념일, 생일 날짜의 달력 종류 (api.md 2.4) */
export type CalendarKind = "SOLAR" | "LUNAR";

/** 음력 날짜. leap = 윤달 */
export type LunarDate = { year: number; month: number; day: number; leap: boolean };

/** 변환표가 받는 마지막 음력 해 (입력 막기) */
export const LUNAR_MAX_YEAR = 2050;
const LUNAR_MIN_YEAR = 1000;

// 상태를 가진 변환기 하나를 돌려 쓴다 (화면 그리기는 한 스레드라 섞이지 않는다)
let calendar: KoreanLunarCalendar | null = null;
const conv = () => (calendar ??= new KoreanLunarCalendar());

/** 정확히 그 음력 날짜의 양력. 없는 날짜(그해에 없는 윤달, 29일 달의 30일)나 범위 밖은 null */
export function lunarToSolar(l: LunarDate): DateKey | null {
  const c = conv();
  if (!c.setLunarDate(l.year, l.month, l.day, l.leap)) return null;
  const s = c.getSolarCalendar();
  return keyOf(s.year, s.month, s.day);
}

/** 양력 날짜 키의 음력. 범위 밖이면 null */
export function solarToLunar(key: DateKey): LunarDate | null {
  const [y, m, d] = key.split("-").map(Number);
  const c = conv();
  if (!c.setSolarDate(y, m, d)) return null;
  const l = c.getLunarCalendar();
  return { year: l.year, month: l.month, day: l.day, leap: l.intercalation === true };
}

/** 그 음력 날짜가 실제로 있는가 */
export const isLunarDate = (l: LunarDate) => lunarToSolar(l) !== null;

/** 그 해 그 달에 윤달이 있는가 */
export const hasLeapMonth = (year: number, month: number) => isLunarDate({ year, month, day: 1, leap: true });

/**
 * 해마다 돌아오는 음력 월일의 그해 양력 (D-297). 윤달이 없는 해는 평달, 그 달에 없는 30일은 마지막 날(29일). 범위 밖은 null
 */
export function lunarOccurrence(year: number, month: number, day: number, leap: boolean): DateKey | null {
  if (year < LUNAR_MIN_YEAR || year > LUNAR_MAX_YEAR) return null;
  const useLeap = leap && hasLeapMonth(year, month);
  for (let d = day; d >= Math.min(day, 29); d -= 1) {
    const solar = lunarToSolar({ year, month, day: d, leap: useLeap });
    if (solar) return solar;
  }
  return null;
}

/** "음력 3월 15일", 윤달 "음력 윤4월 15일". withYear 면 "음력 2000년 3월 15일" */
export function formatLunar(month: number, day: number, leap: boolean, year?: number): string {
  return `음력 ${year !== undefined ? `${year}년 ` : ""}${leap ? "윤" : ""}${month}월 ${day}일`;
}

/**
 * 달력 칸의 작은 음력 글자 (D-297).
 * - text: 넓은 칸(숫자 줄 오른쪽). 보통 "10.6", 초하루 "음 11.1", 윤달은 "윤4.6"
 * - short: 낮은 넓은 칸(왼쪽 위 모서리). "10.6", 초하루 "11.1"
 * - compact: 폰 칸(왼쪽 위 모서리). 칸마다 숫자가 둘이면 어느 게 날짜인지 헷갈려서 초하루와 보름만 "11.1", "11.15". 다른 날은 빈 문자열(안 그림)
 * first = 초하루 (글자를 조금 진하게), label = 읽기용 "음력 10월 6일"
 */
export function lunarCellText(key: DateKey): { text: string; short: string; compact: string; first: boolean; label: string } | null {
  const l = solarToLunar(key);
  if (!l) return null;
  const leap = l.leap ? "윤" : "";
  const md = `${leap}${l.month}.${l.day}`;
  const first = l.day === 1;
  return { text: first && !l.leap ? `음 ${md}` : md, short: md, compact: first || l.day === 15 ? md : "", first, label: formatLunar(l.month, l.day, l.leap) };
}
