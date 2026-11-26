/**
 * (#562) 음력 ↔ 양력 변환 (설계 음력.md, D-297). 순수 함수.
 * 변환표는 한국천문연구원(KASI) 기준 데이터를 담은 `korean-lunar-calendar` (음력 1000-01-01 ~ 2050-11-18, 양력 1000-02-13 ~ 2050-12-31).
 * 범위 밖은 null 이고 입력 검증이 막는다. 날짜는 KST 달력 날짜 'YYYY-MM-DD'.
 * 웹 `apps/web/src/lib/lunar.ts` 와 같은 규칙 (두 앱이 같은 결과를 내야 달력, 알림, 피드가 같은 날을 가리킨다)
 */
import lunarModule from 'korean-lunar-calendar';

/** 기념일, 생일 날짜의 달력 종류 (DB enum CalendarType 과 같은 값) */
export type CalendarKind = 'SOLAR' | 'LUNAR';
export const CALENDAR_KINDS: readonly CalendarKind[] = ['SOLAR', 'LUNAR'];

/** 음력 날짜. leap = 윤달 */
export interface LunarDate {
  year: number;
  month: number;
  day: number;
  leap: boolean;
}

/** 라이브러리가 받는 마지막 음력 해. 이 해 뒤는 계산하지 않는다 (2050년 음력 11월 18일까지) */
export const LUNAR_MAX_YEAR = 2050;
export const LUNAR_MIN_YEAR = 1000;

// 패키지 타입 선언이 CJS 로 읽혀(nodenext) default 가 한 겹 더 감싼 것처럼 보인다. 실행은 ESM 빌드의 클래스 그대로라 둘 다 받는다
type LunarCalendarClass = typeof lunarModule.default;
const KoreanLunarCalendar = ((lunarModule as unknown as { default?: LunarCalendarClass }).default ?? lunarModule) as LunarCalendarClass;

// 상태를 가진 변환기 하나를 돌려 쓴다 (JS 는 한 스레드라 호출 사이에 섞이지 않는다)
const calendar = new KoreanLunarCalendar();

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
const toKey = (y: number, m: number, d: number): string => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** 정확히 그 음력 날짜의 양력 'YYYY-MM-DD'. 없는 날짜(윤달이 없는 해의 윤달, 29일 달의 30일)나 범위 밖은 null */
export function lunarToSolar(lunar: LunarDate): string | null {
  if (!calendar.setLunarDate(lunar.year, lunar.month, lunar.day, lunar.leap)) return null;
  const solar = calendar.getSolarCalendar();
  return toKey(solar.year, solar.month, solar.day);
}

/** 양력 'YYYY-MM-DD' 의 음력. 형식이 틀리거나 범위 밖이면 null */
export function solarToLunar(date: string): LunarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  if (!calendar.setSolarDate(Number(match[1]), Number(match[2]), Number(match[3]))) return null;
  const lunar = calendar.getLunarCalendar();
  return { year: lunar.year, month: lunar.month, day: lunar.day, leap: lunar.intercalation === true };
}

/** 그 음력 날짜가 실제로 있는가 (입력 검증) */
export const isLunarDate = (lunar: LunarDate): boolean => lunarToSolar(lunar) !== null;

/**
 * 해마다 돌아오는 음력 월일의 그해 양력 날짜 (D-297).
 * - 윤달로 넣었는데 그해에 그 윤달이 없으면 평달
 * - 그 달에 그날이 없으면(30일인데 그해 그 달이 29일) 그 달 마지막 날
 * 범위 밖 해는 null
 */
export function lunarOccurrence(year: number, month: number, day: number, leap: boolean): string | null {
  if (year < LUNAR_MIN_YEAR || year > LUNAR_MAX_YEAR) return null;
  const useLeap = leap && isLunarDate({ year, month, day: 1, leap: true });
  for (let d = day; d >= Math.min(day, 29); d -= 1) {
    const solar = lunarToSolar({ year, month, day: d, leap: useLeap });
    if (solar) return solar;
  }
  return null;
}

/** "음력 3월 15일", 윤달이면 "음력 윤4월 15일" */
export const formatLunarMonthDay = (month: number, day: number, leap: boolean): string => `음력 ${leap ? '윤' : ''}${month}월 ${day}일`;
