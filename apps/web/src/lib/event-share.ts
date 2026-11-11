// (#274) 일정 카드 공유의 순수 규칙 (D-186). 보내는 쪽 문구와 카카오 카드, 받는 쪽 시각 줄과 달력 착지 주소.
// React 를 import 하지 않는다 (단위 테스트 대상). 주소와 문구는 여기 한 곳에서 만들어 복사, OS 공유, 앱 공유 브리지, 카카오톡이 같이 쓴다
import { calendarEventHref } from "./calendar-url";
import { addDays, dateKeyOf, parseKey, toKst, WEEKDAYS, dowOf, type DateKey } from "./date";
import type { KakaoFeedInput } from "./kakao-share";
import { clampTeamName } from "./og";
import { REPEAT_NAME } from "./recurrence";
import { eventShareOgImage } from "./site";
import type { EventShareLink, EventSharePreview, Repeat } from "./types";
import { JOIN_AUTO_PARAM } from "./auth";

/** API 토큰 모양 (16바이트 base64url 22자, 대소문자 구분) */
export const EVENT_SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function parseEventShareToken(raw: string | null | undefined): string | null {
  return typeof raw === "string" && EVENT_SHARE_TOKEN_PATTERN.test(raw) ? raw : null;
}

/** 공개 미리보기 API 경로 */
export function eventSharePreviewPath(token: string): string {
  return `/event-shares/${token}`;
}

/** 받는 쪽 화면 경로 */
export function eventSharePath(token: string): string {
  return `/join/e/${token}`;
}

/** 로그인 후 돌아와 바로 합류하는 next (D-41 과 같은 `?auto=1`) */
export function eventShareAutoNext(token: string): string {
  return `${eventSharePath(token)}?${JOIN_AUTO_PARAM}=1`;
}

type EventTime = { startsAt: string; endsAt: string; allDay: boolean };

const dayLabel = (key: DateKey) => {
  const { m, d } = parseKey(key);
  return `${m}월 ${d}일 (${WEEKDAYS[dowOf(key)]})`;
};

/** 오전/오후 h:mm. 자정 0시는 "오전 12:00", 정오는 "오후 12:00" */
function clock(iso: string): { meridiem: "오전" | "오후"; text: string } {
  const { h, min } = toKst(iso);
  const meridiem = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { meridiem, text: `${h12}:${String(min).padStart(2, "0")}` };
}

/**
 * 미리보기, 공유 카드의 날짜와 시각 줄 (KST).
 * - 시간 일정 하루: "11월 15일 (토) 오후 7:00 ~ 9:00" (오전/오후가 다르면 끝에도 붙인다)
 * - 종일 하루: "11월 15일 (토) 종일"
 * - 여러 날: "11월 15일 (토) ~ 17일 (월)" (달이 바뀌면 "~ 12월 2일 (수)"). 시간 일정이면 양끝에 시각
 */
export function eventShareTimeLabel(ev: EventTime): string {
  const startKey = dateKeyOf(ev.startsAt);
  const endKey = ev.allDay ? addDays(dateKeyOf(ev.endsAt), -1) : dateKeyOf(ev.endsAt);
  const endDay = () => {
    const s = parseKey(startKey);
    const e = parseKey(endKey);
    return s.y === e.y && s.m === e.m ? `${e.d}일 (${WEEKDAYS[dowOf(endKey)]})` : dayLabel(endKey);
  };
  if (ev.allDay) return startKey === endKey ? `${dayLabel(startKey)} 종일` : `${dayLabel(startKey)} ~ ${endDay()}`;
  const s = clock(ev.startsAt);
  const e = clock(ev.endsAt);
  if (startKey === endKey) {
    return `${dayLabel(startKey)} ${s.meridiem} ${s.text} ~ ${e.meridiem === s.meridiem ? "" : `${e.meridiem} `}${e.text}`;
  }
  return `${dayLabel(startKey)} ${s.meridiem} ${s.text} ~ ${endDay()} ${e.meridiem} ${e.text}`;
}

/** 이미 끝난 회차인지. 공유 버튼을 숨긴다 (API 는 EVENT_SHARE_ENDED) */
export function isShareEnded(endsAt: string, now: number = Date.now()): boolean {
  return new Date(endsAt).getTime() <= now;
}

/** 반복 일정 표시 줄 "매주 반복 일정". 한 번짜리 null */
export function eventShareRepeatLabel(repeat: Repeat | null): string | null {
  return repeat ? `${REPEAT_NAME[repeat]} 반복 일정` : null;
}

/** 보내는 쪽 시트의 만료 안내 "이 링크는 11월 15일까지 열려요" (KST, 만료 시각이 자정이면 그 전날) */
export function eventShareExpiryLabel(expiresAt: string): string {
  const { m, d } = parseKey(dateKeyOf(new Date(new Date(expiresAt).getTime() - 1)));
  return `이 링크는 ${m}월 ${d}일까지 열려요`;
}

/** 멤버가 링크를 열거나 합류한 뒤 갈 달력 주소 (calendar-url.ts 규칙, 반복이면 회차까지). 지난 날짜여도 그대로 */
export function eventShareLandingHref(
  landing: { groupId: number; eventId: number; occurrence: string | null; date: string },
  today: DateKey,
): string {
  return calendarEventHref(landing.groupId, landing.date, { id: landing.eventId, occurrence: landing.occurrence }, today);
}

export const EVENT_SHARE_TITLE = "언제볼까 일정";
export const EVENT_SHARE_BUTTON = "일정 보기";

export type EventShareText = {
  url: string;
  /** 공유 본문 (주소 제외). 앱 공유 브리지는 주소를 셸이 붙인다 */
  message: string;
  /** 본문 + 줄바꿈 + 주소 (Web Share 의 text, 복사 없이 붙여 넣는 곳) */
  text: string;
  title: string;
};

/** 보내는 쪽 문구 "'토요일 저녁' 11월 15일 (토) 오후 7:00 ~ 9:00, 같이 볼래요? 언제볼까에서 일정 보기" */
export function eventShareText(link: Pick<EventShareLink, "url">, ev: EventTime & { title: string }): EventShareText {
  const message = `'${ev.title}' ${eventShareTimeLabel(ev)}, 같이 볼래요? 언제볼까에서 일정 보기`;
  return { url: link.url, message, text: `${message}\n${link.url}`, title: EVENT_SHARE_TITLE };
}

/**
 * 카카오톡 피드 카드 (#195 kakaoFeedTemplate 재사용). 제목은 일정 제목, 설명은 시각 줄과 팀, 이미지는 OG 카드 `/og/join/e/<token>`.
 * 이미지 주소는 링크와 같은 오리진 (셸은 WEB_ORIGIN 밖 이미지를 버린다). 주소가 틀리면 null
 */
export function eventShareKakaoFeed(link: EventShareLink, ev: EventTime & { title: string }, groupName: string): KakaoFeedInput | null {
  let origin: string;
  try {
    origin = new URL(link.url).origin;
  } catch {
    return null;
  }
  const image = eventShareOgImage(link.token);
  return {
    title: ev.title,
    description: `${eventShareTimeLabel(ev)}, ${clampTeamName(groupName)} 팀 일정`,
    imageUrl: `${origin}${image.url}`,
    imageWidth: image.width,
    imageHeight: image.height,
    link: link.url,
    buttonTitle: EVENT_SHARE_BUTTON,
  };
}

/** 받는 쪽 메타 제목 "{일정 제목} - {팀 이름}" */
export function eventShareMetaTitle(preview: Pick<EventSharePreview, "groupName" | "event">): string {
  return `${preview.event.title} - ${clampTeamName(preview.groupName)}`;
}
