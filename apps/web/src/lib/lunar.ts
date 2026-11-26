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
 * 달력 칸, 주 보기 머리의 작은 음력 글자 (D-297, #566 D-298).
 * - text: 모든 날 "10.6" (달을 늘 붙여 날짜 숫자와 헷갈리지 않게), 윤달은 "윤4.6"
 * - first: 초하루 (글자를 조금 진하게)
 * - label: 읽기용 "음력 10월 6일"
 */
export function lunarCellText(key: DateKey): { text: string; first: boolean; label: string } | null {
  const l = solarToLunar(key);
  if (!l) return null;
  return { text: `${l.leap ? "윤" : ""}${l.month}.${l.day}`, first: l.day === 1, label: formatLunar(l.month, l.day, l.leap) };
}

/** (#566) 그 양력 날짜의 음력 "음력 10월 16일" (일 상세 머리, 일정 상세). 범위 밖이면 null */
export function lunarLabelOf(key: DateKey): string | null {
  const l = solarToLunar(key);
  return l ? formatLunar(l.month, l.day, l.leap) : null;
}

/**
 * (#566) 일정 날짜를 음력으로 고를 때의 오류 한 줄 (D-298). 맞으면 null.
 * 그 해에 없는 윤달, 29일 달의 30일, 변환표 밖(음력 2050년 뒤)은 저장을 막는다. 기념일 폼과 같은 문장
 */
export function lunarPickError(l: LunarDate): string | null {
  if (l.year < LUNAR_MIN_YEAR || l.year > LUNAR_MAX_YEAR) return `음력 ${LUNAR_MAX_YEAR}년까지만 고를 수 있어요`;
  if (l.leap && !hasLeapMonth(l.year, l.month)) return `음력 ${l.year}년에는 윤${l.month}월이 없어요`;
  if (!isLunarDate(l)) return `음력 ${l.year}년 ${l.leap ? "윤" : ""}${l.month}월은 29일까지예요`;
  return null;
}
