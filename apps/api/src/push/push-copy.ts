/**
 * 알림 문구와 경로 (#188, 설계 푸시-알림.md 6장, D-95, D-98). 순수 함수 (단위 테스트 대상).
 * 시각은 KST `오전/오후 h:mm`, 날짜는 `M월 D일 (요일)` (올해가 아니면 `YYYY년` 앞에). 메모는 넣지 않는다
 */
import { addDays, DAY_MS, KST_OFFSET_MS, kstDate, kstMidnight, type Repeat } from '../events/recurrence.js';
import type { ChangeAction } from './coalesce.js';
import type { EventReminder } from './remind-at.js';

export type PushKindName = 'REMINDER' | 'CHANGE' | 'ANNIVERSARY' | 'JOIN';
export type Platform = 'IOS' | 'ANDROID';

/** PushNotification.payload. 펼칠 때(일정 알림, 기념일은 예약할 때) 만든다 */
export interface PushPayload {
  title: string;
  /** 팀 이름. IOS 는 subtitle, ANDROID 는 제목 앞 `[팀 이름]`. JOIN 은 null */
  subtitle: string | null;
  body: string | null;
  /** 웹 경로. 셸이 WEB_ORIGIN 을 붙인다 */
  url: string;
  /** Expo expiration (epoch 초). REMINDER 는 보낼 때 now + 10분 과 큰 쪽 (D-98) */
  expiration: number;
}

/** Expo 푸시 메시지 한 건 (D-94) */
export interface ExpoMessage {
  to: string;
  title: string;
  subtitle?: string;
  body?: string;
  sound: 'default';
  priority: 'high';
  channelId: 'default';
  data: { url: string; kind: PushKindName; nid: number };
  expiration: number;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const REPEAT_NAME: Record<Repeat, string> = { WEEKLY: '매주', BIWEEKLY: '격주', MONTHLY: '매월', YEARLY: '매년' };
const MINUTE_MS = 60 * 1000;
export const DELETED_MEMBER_NAME = '탈퇴한 멤버';

const epochSeconds = (ms: number) => Math.floor(ms / 1000);

/** '14:30' 순간 → '오후 2:30'. 0시는 오전 12시, 12시는 오후 12시 (웹 meridiem) */
export function kstTimeLabel(instant: Date): string {
  const minutes = Math.floor((((instant.getTime() + KST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / MINUTE_MS);
  const h = Math.floor(minutes / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h < 12 ? '오전' : '오후'} ${h12}:${String(minutes % 60).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' → '11월 9일 (일)'. 올해(KST, today 기준)가 아니면 '2027년 1월 5일 (화)' (웹 formatDateKo, newsDateLabel) */
export function kstDateLabel(key: string, today: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const dow = new Date(`${key}T00:00:00.000Z`).getUTCDay();
  const base = `${m}월 ${d}일 (${WEEKDAYS[dow]})`;
  return key.slice(0, 4) === today.slice(0, 4) ? base : `${y}년 ${base}`;
}

/** 'YYYY-MM-DD' → 'M월 D일' (웹 newsPhrase 의 md) */
function monthDay(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${m}월 ${d}일`;
}

/** 끝 글자 받침 유무로 '이에요/예요'. 한글이 아니면 받침 없음 쪽 (웹 lib/text.ts 규칙) */
export function copula(word: string): string {
  const code = word.trim().slice(-1).charCodeAt(0) - 0xac00;
  const batchim = code >= 0 && code <= 11171 && code % 28 !== 0;
  return `${word}${batchim ? '이에요' : '예요'}`;
}

/** 일정 상세 경로 (웹 calendarEventHref 모양, 오늘이어도 date 를 붙인다) */
export function eventUrl(groupId: number, eventId: number, date: string, occurrence: string | null): string {
  const query = new URLSearchParams({ date, day: '1', event: String(eventId) });
  if (occurrence) query.set('occurrence', occurrence);
  return `/g/${groupId}/calendar?${query.toString()}`;
}

export const newsUrl = (groupId: number) => `/g/${groupId}/news`;
export const anniversariesUrl = (groupId: number) => `/g/${groupId}/anniversaries`;
export const calendarUrl = (groupId: number) => `/g/${groupId}/calendar`;

/** 종일 일정의 마지막 날 (끝은 배타적) */
function lastAllDayDate(endsAt: Date): string {
  return kstDate(new Date(endsAt.getTime() - 1));
}

export interface ReminderTarget {
  groupId: number;
  groupName: string;
  eventId: number;
  /** 반복이면 회차의 원래 날짜, 한 번짜리는 null */
  occurrence: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  reminder: EventReminder;
}

/** 일정 알림 (설계 6장 REMINDER). today 는 지금의 KST 날짜 (연도 표기 판단) */
export function reminderPayload(target: ReminderTarget, today: string): PushPayload {
  const date = kstDate(target.startsAt);
  let body: string;
  if (target.allDay) {
    const when = target.reminder === 'DAY_BEFORE_0900' ? '내일' : '오늘';
    const last = lastAllDayDate(target.endsAt);
    body = last <= date ? `${when} 종일` : `${when}부터 ${kstDateLabel(last, today)}까지`;
  } else {
    const time = kstTimeLabel(target.startsAt);
    const lead: Partial<Record<EventReminder, string>> = { AT_START: '지금', MIN_10: '10분 뒤', HOUR_1: '1시간 뒤', DAY_1: '내일' };
    body = `${lead[target.reminder] ?? '지금'} ${time}`;
  }
  // 회차 시작(종일은 그날 끝 KST 24:00) 이 지나면 의미 없다 (D-98)
  const expiresAt = target.allDay ? kstMidnight(addDays(lastAllDayDate(target.endsAt), 1)).getTime() : target.startsAt.getTime();
  return {
    title: target.title,
    subtitle: target.groupName,
    body,
    url: eventUrl(target.groupId, target.eventId, date, target.occurrence),
    expiration: epochSeconds(expiresAt),
  };
}

export interface ChangeLogSnapshot {
  eventId: number | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  repeat: Repeat | null;
  scope: 'THIS' | 'FOLLOWING' | null;
  /** 'YYYY-MM-DD' */
  occurrence: string | null;
}

export interface ChangeTarget {
  groupId: number;
  groupName: string;
  /** 변경한 사람의 그 팀 표시 이름 (나갔으면 닉네임, 탈퇴했으면 "탈퇴한 멤버") */
  actorName: string;
  /** 묶은 결과 동작 */
  action: ChangeAction;
  /** 묶음이 가리키는 일정 (로그의 eventId 가 지워져 null 이면 이 값) */
  eventId: number | null;
  log: ChangeLogSnapshot;
}

/** 웹 newsPhrase 와 같은 문장 (추가는 묶은 결과라 로그의 범위와 관계없이 반복 여부만 본다) */
export function changePhrase(action: ChangeAction, log: Pick<ChangeLogSnapshot, 'repeat' | 'scope' | 'occurrence'>): string {
  if (action === 'CREATED') return log.repeat ? `${REPEAT_NAME[log.repeat]} 반복 일정을 추가했어요` : '일정을 추가했어요';
  if (log.scope && log.occurrence) {
    const day = monthDay(log.occurrence);
    if (action === 'UPDATED') return log.scope === 'THIS' ? `${day} 일정만 수정했어요` : `${day}부터 반복 일정을 수정했어요`;
    return log.scope === 'THIS' ? `${day} 일정을 삭제했어요` : `${day}부터 반복을 삭제했어요`;
  }
  return action === 'UPDATED' ? '일정을 수정했어요' : '일정을 삭제했어요';
}

/** 팀원 변경 (설계 6장 CHANGE). now 는 펼치는 시각 */
export function changePayload(target: ChangeTarget, now: Date): PushPayload {
  const { log } = target;
  const startDate = kstDate(log.startsAt);
  const when = log.allDay ? '종일' : kstTimeLabel(log.startsAt);
  const eventId = log.eventId ?? target.eventId;
  let url: string;
  if (target.action === 'DELETED' || eventId === null) {
    url = newsUrl(target.groupId);
  } else if (log.scope === 'THIS' && log.occurrence) {
    url = eventUrl(target.groupId, eventId, startDate, log.occurrence);
  } else {
    // 그 밖의 반복은 스냅샷이 (새) 원본 첫 회차라 회차 날짜도 스냅샷 시작 날짜
    url = eventUrl(target.groupId, eventId, startDate, log.repeat ? startDate : null);
  }
  return {
    title: `${target.actorName}님이 ${changePhrase(target.action, log)}`,
    subtitle: target.groupName,
    body: `${log.title}, ${kstDateLabel(startDate, kstDate(now))} ${when}`,
    url,
    expiration: epochSeconds(now.getTime() + DAY_MS),
  };
}

/** (#269) 기념일 알림 시점의 앞당김 일수 */
export type ReminderOffsetDays = 0 | 1 | 7;

/** 끝 글자 받침 유무로 '이/가' (copula 와 같은 판정) */
export function subjectParticle(word: string): string {
  const code = word.trim().slice(-1).charCodeAt(0) - 0xac00;
  const batchim = code >= 0 && code <= 11171 && code % 28 !== 0;
  return `${word}${batchim ? '이' : '가'}`;
}

export interface AnniversaryTarget {
  groupId: number;
  groupName: string;
  name: string;
  /** "300일", "1주년". 매년/원래 날짜는 null */
  label: string | null;
  /** 그날 'YYYY-MM-DD' (KST) */
  date: string;
  /** (#269) 그날보다 며칠 앞서 보내는가: 0 당일, 1 하루 전, 7 일주일 전 */
  offsetDays: ReminderOffsetDays;
}

/**
 * 기념일 (설계 6장 ANNIVERSARY, #269 D-147). 제목은 시점과 관계없이 `{이름} {라벨}`.
 * 만료는 보내는 날 KST 24:00 (다음 날 받으면 "내일은" 이 틀린 말이 된다)
 */
export function anniversaryPayload(target: AnniversaryTarget): PushPayload {
  const title = target.label ? `${target.name} ${target.label}` : target.name;
  const body =
    target.offsetDays === 0
      ? `오늘은 ${copula(title)}`
      : target.offsetDays === 1
        ? `내일은 ${copula(title)}`
        : `${subjectParticle(title)} 일주일 남았어요`;
  const sendDay = addDays(target.date, -target.offsetDays);
  return {
    title,
    subtitle: target.groupName,
    body,
    url: anniversariesUrl(target.groupId),
    expiration: epochSeconds(kstMidnight(addDays(sendDay, 1)).getTime()),
  };
}

/** 새 멤버 합류 (설계 6장 JOIN). 문장에 팀 이름이 있어 subtitle 을 두지 않는다 */
export function joinPayload(groupId: number, groupName: string, memberName: string, now: Date): PushPayload {
  return {
    title: `${memberName}님이 '${groupName}' 에 들어왔어요`,
    subtitle: null,
    body: null,
    url: calendarUrl(groupId),
    expiration: epochSeconds(now.getTime() + DAY_MS),
  };
}

/**
 * (#279) 일정 가져오기 한 번에 팀원 변경 알림 1건 (D-166). 제목은 새 소식 줄과 같은 문장, 누르면 그 팀 달력.
 * 일정마다 보내지 않는다 (가져오기는 EventLog 와 2분 묶음을 거치지 않는다)
 */
export function importPayload(groupId: number, groupName: string, actorName: string, count: number, now: Date): PushPayload {
  return {
    title: `${actorName}님이 일정 ${count.toLocaleString('en-US')}개를 가져왔어요`,
    subtitle: groupName,
    body: null,
    url: calendarUrl(groupId),
    expiration: epochSeconds(now.getTime() + DAY_MS),
  };
}

/**
 * 기기 하나로 보낼 Expo 메시지. IOS 는 subtitle, ANDROID 는 제목 앞 `[팀 이름]`.
 * REMINDER 의 만료는 보내는 때 기준 최소 10분 뒤 (D-98)
 */
export function toExpoMessage(
  kind: PushKindName,
  notificationId: number,
  payload: PushPayload,
  device: { token: string; platform: Platform },
  now: Date,
): ExpoMessage {
  const message: ExpoMessage = {
    to: device.token,
    title: payload.title,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    data: { url: payload.url, kind, nid: notificationId },
    expiration: kind === 'REMINDER' ? Math.max(payload.expiration, epochSeconds(now.getTime() + 10 * MINUTE_MS)) : payload.expiration,
  };
  if (payload.subtitle) {
    if (device.platform === 'IOS') message.subtitle = payload.subtitle;
    else message.title = `[${payload.subtitle}] ${payload.title}`;
  }
  if (payload.body) message.body = payload.body;
  return message;
}
