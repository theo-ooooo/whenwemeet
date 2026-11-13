/**
 * (#193) 팀 일정, 기념일, (#305) 멤버 생일 → ICS VEVENT 매핑 (설계 캘린더-내보내기.md 3장, D-217 ~ D-219). 모두 순수 함수.
 * 반복은 RRULE 대신 회차마다 VEVENT 하나 (우리 말일 보정, 기준 날짜, "이 일정만" 예외를 그대로 옮기려고)
 */
import { BIRTHDAY_ANCHOR_YEAR, birthdayTitle } from '../anniversaries/birthdays.js';
import { anniversaryItemsOn, type AnniversaryKind, sameDayInYear } from '../push/anniversary-items.js';
import { addDays, dateToDay, DAY_MS, kstDate, kstMidnight } from '../events/recurrence.js';
import type { IcsEvent, IcsTime } from './ics.js';

/** 피드 창: 오늘(KST) 기준 과거 60일 ~ 미래 400일 (Q7) */
export const FEED_PAST_DAYS = 60;
export const FEED_FUTURE_DAYS = 400;
export const UID_DOMAIN = 'whenwemeet.day';
/** SEQUENCE 기준 시각. updatedAt 의 초를 그대로 쓰면 2038년에 32비트 정수를 넘는다 (이 기준이면 2088년까지) */
const SEQUENCE_EPOCH_MS = Date.UTC(2020, 0, 1);

export interface FeedWindow {
  /** 첫날, 마지막 날 (KST, 양끝 포함) */
  firstDay: string;
  lastDay: string;
  /** 일정 조회 [from, to) */
  from: Date;
  to: Date;
}

export function feedWindow(now: Date): FeedWindow {
  const today = kstDate(now);
  const firstDay = addDays(today, -FEED_PAST_DAYS);
  const lastDay = addDays(today, FEED_FUTURE_DAYS);
  return { firstDay, lastDay, from: kstMidnight(firstDay), to: kstMidnight(addDays(lastDay, 1)) };
}

/** 피드가 쓰는 일정 한 건 (EventView 의 일부. 반복이면 회차 하나) */
export interface FeedEventInput {
  id: number;
  publicCode: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  memo: string | null;
  updatedAt: Date;
  repeat: string | null;
  occurrence: string | null;
  participants: { all: boolean; members: { displayName: string }[] };
  /** (#199) 저장된 장소 (사용자 글자와 카카오 ID). 없으면 null (생략 가능: 장소 이전 입력) */
  place?: { text: string | null; query: string | null; kakaoPlaceId: string | null; naverKey?: string | null } | null;
}

export interface FeedOptions {
  includeMemo: boolean;
  /** 개인 팀은 참여자가 늘 나 하나라 "참여:" 줄을 넣지 않는다 */
  includeParticipants: boolean;
  /** 웹 주소 (`https://whenwemeet.day`) */
  webOrigin: string;
  /** 팀 공개 코드 (`?team=`) */
  groupCode: string;
}

export function sequenceOf(updatedAt: Date): number {
  return Math.max(0, Math.floor((updatedAt.getTime() - SEQUENCE_EPOCH_MS) / 1000));
}

/**
 * 종일 일정의 [시작 날짜, 끝 날짜) (KST). 저장값은 그날 KST 00:00 ~ 다음 날 00:00 이지만 서버가 자정을 검증하지 않으므로
 * 끝은 "끝 순간 바로 앞의 날짜 + 1일" 로 구하고, 시작 다음 날보다 앞서지 않게 한다
 */
export function allDayDates(startsAt: Date, endsAt: Date): { start: string; end: string } {
  const start = kstDate(startsAt);
  const lastDay = kstDate(new Date(endsAt.getTime() - 1));
  const end = addDays(dateToDay(lastDay) < dateToDay(start) ? start : lastDay, 1);
  return { start, end };
}

/** 회차는 `e{id}-{YYYYMMDD}@…` (원래 날짜라 "이 일정만" 으로 옮겨도 같다), 한 번짜리는 `e{id}@…` */
export function eventUid(id: number, occurrence: string | null): string {
  return occurrence ? `e${id}-${occurrence.replace(/-/g, '')}@${UID_DOMAIN}` : `e${id}@${UID_DOMAIN}`;
}

/** 설명: 첫 줄 "참여: 민지, 지훈" (Q5, 이름만. 개인 팀은 없음), 메모는 켰을 때만 빈 줄 하나 띄우고 */
export function eventDescription(event: FeedEventInput, includeMemo: boolean, includeParticipants = true): string | null {
  const lines: string[] = [];
  const names = event.participants.all ? '모두' : event.participants.members.map((m) => m.displayName).join(', ');
  if (includeParticipants && names) lines.push(`참여: ${names}`);
  const memo = includeMemo ? event.memo?.trim() : '';
  if (memo) {
    if (lines.length > 0) lines.push('');
    lines.push(memo);
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/** (#199) 피드를 만들 때 고른 출처(카카오, 네이버 D-259)에서 다시 찾은 장소 (저장하지 않는다) */
export interface ResolvedPlace {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
}

/**
 * (#199) LOCATION 글자 (D-248). 다시 찾았으면 "이름, 주소"(주소가 없거나 이름과 같으면 이름만), 아니면 사용자 글자(직접 적은 것, 고를 때 검색어).
 * 메모와 달리 피드 옵션과 무관하게 싣는다
 */
export function eventLocation(place: FeedEventInput['place'], resolved: ResolvedPlace | null = null): string | null {
  if (resolved) return resolved.address && resolved.address !== resolved.name ? `${resolved.name}, ${resolved.address}` : resolved.name;
  return place?.text || place?.query || null;
}

/** (#199) 다시 찾기 캐시 키 (출처, 식별자, 검색어) */
export const placeKey = (place: { kakaoPlaceId: string | null; naverKey?: string | null; query: string | null }) =>
  place.kakaoPlaceId ? `kakao|${place.kakaoPlaceId}|${place.query}` : `naver|${place.naverKey ?? ''}|${place.query}`;

/** 그 일정(회차)의 웹 상세 주소 (#311, D-198) */
export function eventUrl(event: FeedEventInput, options: Pick<FeedOptions, 'webOrigin' | 'groupCode'>): string {
  const params = new URLSearchParams({ team: options.groupCode });
  if (event.repeat && event.occurrence) params.set('occurrence', event.occurrence);
  return `${options.webOrigin}/events/${event.publicCode}?${params.toString()}`;
}

/** resolved: (#199) 그 일정 장소를 피드를 만들 때 다시 찾은 값. 없으면 LOCATION 은 사용자 글자, GEO 없음 */
export function eventToIcs(event: FeedEventInput, options: FeedOptions, resolved: ResolvedPlace | null = null): IcsEvent {
  let start: IcsTime;
  let end: IcsTime;
  if (event.allDay) {
    const dates = allDayDates(event.startsAt, event.endsAt);
    start = { allDay: true, date: dates.start };
    end = { allDay: true, date: dates.end };
  } else {
    start = { allDay: false, at: event.startsAt };
    end = { allDay: false, at: event.endsAt };
  }
  return {
    uid: eventUid(event.id, event.repeat ? event.occurrence : null),
    dtstamp: event.updatedAt,
    lastModified: event.updatedAt,
    sequence: sequenceOf(event.updatedAt),
    start,
    end,
    summary: event.title,
    description: eventDescription(event, options.includeMemo, options.includeParticipants),
    url: eventUrl(event, options),
    location: eventLocation(event.place, resolved),
    geo: resolved ? { lat: resolved.lat, lng: resolved.lng } : null,
  };
}

export interface FeedAnniversaryInput {
  id: number;
  name: string;
  /** 'YYYY-MM-DD' */
  date: string;
  kind: AnniversaryKind;
  /** 마지막 개정 시각 */
  updatedAt: Date;
}

/**
 * (Q3) 기념일: 원래 날짜와 자동 항목(N일, N주년, 매년)을 창 안에서 종일 VEVENT 로. 하루에 항목이 여럿이면 우선순위 첫 항목 하나
 * (웹 달력, 푸시와 같은 규칙, D-92). 제목은 "이름 300일", 원래 날짜와 매년은 이름만
 */
export function anniversaryEvents(anniversary: FeedAnniversaryInput, window: Pick<FeedWindow, 'firstDay' | 'lastDay'>): IcsEvent[] {
  const out: IcsEvent[] = [];
  const first = Math.max(dateToDay(window.firstDay), dateToDay(anniversary.date));
  const last = dateToDay(window.lastDay);
  for (let day = first; day <= last; day += 1) {
    const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
    const [item] = anniversaryItemsOn(anniversary, date);
    if (!item) continue;
    out.push({
      uid: `a${anniversary.id}-${date.replace(/-/g, '')}@${UID_DOMAIN}`,
      dtstamp: anniversary.updatedAt,
      lastModified: anniversary.updatedAt,
      sequence: sequenceOf(anniversary.updatedAt),
      start: { allDay: true, date },
      end: { allDay: true, date: addDays(date, 1) },
      summary: item.label ? `${anniversary.name} ${item.label}` : anniversary.name,
      transparent: true,
    });
  }
  return out;
}

/** (#305) 피드의 멤버 생일 한 사람 (BirthdaysRepository.listForFeed) */
export interface FeedBirthdayInput {
  userId: number;
  /** 팀 표시 이름 ?? 닉네임 */
  name: string;
  /** 'MM-DD' */
  birthday: string;
  updatedAt: Date;
}

/**
 * (#305, D-233) 멤버 생일: 창 안의 그날마다 종일 VEVENT "지민 생일". 2월 29일은 평년에 2월 28일 (기념일 매년과 같음).
 * UID 는 `b{userId}-{YYYYMMDD}@…` (팀이 달라도 피드가 팀마다라 겹치지 않는다)
 */
export function birthdayEvents(birthday: FeedBirthdayInput, window: Pick<FeedWindow, 'firstDay' | 'lastDay'>): IcsEvent[] {
  const out: IcsEvent[] = [];
  const firstYear = Number(window.firstDay.slice(0, 4));
  const lastYear = Number(window.lastDay.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year += 1) {
    const date = sameDayInYear(`${BIRTHDAY_ANCHOR_YEAR}-${birthday.birthday}`, year);
    if (date < window.firstDay || date > window.lastDay) continue;
    out.push({
      uid: `b${birthday.userId}-${date.replace(/-/g, '')}@${UID_DOMAIN}`,
      dtstamp: birthday.updatedAt,
      lastModified: birthday.updatedAt,
      sequence: sequenceOf(birthday.updatedAt),
      start: { allDay: true, date },
      end: { allDay: true, date: addDays(date, 1) },
      summary: birthdayTitle(birthday.name),
      transparent: true,
    });
  }
  return out;
}
