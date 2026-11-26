/**
 * 알림 문구와 경로 (#188, 설계 푸시-알림.md 6장, D-95, D-98). 순수 함수 (단위 테스트 대상).
 * 시각은 KST `오전/오후 h:mm`, 날짜는 `M월 D일 (요일)` (올해가 아니면 `YYYY년` 앞에). 메모는 넣지 않는다
 */
import {
  addDays,
  DAY_MS,
  KST_OFFSET_MS,
  kstDate,
  kstMidnight,
  type Repeat,
} from '../events/recurrence.js';
import type { ChangeAction } from './coalesce.js';
import type { EventReminder } from './remind-at.js';

export type PushKindName =
  'REMINDER' | 'CHANGE' | 'ANNIVERSARY' | 'JOIN' | 'WEEKLY' | 'POLL' | 'NOTICE';
/** (#277) WEEKLY 의 변형. 주간 요약, 조용한 팀 깨우기 (D-203) */
export type WeeklyVariant = 'SUMMARY' | 'NUDGE';
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
  /** (#277) WEEKLY 만. 깨우기 4주 간격 판정에 쓴다 (Expo 메시지에는 싣지 않는다) */
  variant?: WeeklyVariant;
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
const REPEAT_NAME: Record<Repeat, string> = {
  WEEKLY: '매주',
  BIWEEKLY: '격주',
  MONTHLY: '매월',
  YEARLY: '매년',
  YEARLY_LUNAR: '매년(음력)',
};
const MINUTE_MS = 60 * 1000;
export const DELETED_MEMBER_NAME = '탈퇴한 멤버';

const epochSeconds = (ms: number) => Math.floor(ms / 1000);

/** '14:30' 순간 → '오후 2:30'. 0시는 오전 12시, 12시는 오후 12시 (웹 meridiem) */
export function kstTimeLabel(instant: Date): string {
  const minutes = Math.floor(
    ((((instant.getTime() + KST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS) /
      MINUTE_MS,
  );
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

/**
 * (#311) 알림이 여는 웹 경로. 팀은 `?team=<팀 공개 코드>` 로 지정하고(웹이 쿠키를 바꾸고 주소에서 뗀다) 일정은 `/events/<일정 공개 코드>`.
 * 예전 `/g/<id>/...` 모양은 웹이 308 로 새 주소에 맞춰 주므로 이미 보낸 알림도 그대로 열린다
 */
export function eventUrl(
  groupCode: string,
  eventCode: string,
  occurrence: string | null,
): string {
  const query = new URLSearchParams({ team: groupCode });
  if (occurrence) query.set('occurrence', occurrence);
  return `/events/${eventCode}?${query.toString()}`;
}

export const newsUrl = (groupCode: string) => `/news?team=${groupCode}`;
export const anniversariesUrl = (groupCode: string) =>
  `/anniversaries?team=${groupCode}`;
export const calendarUrl = (groupCode: string) => `/calendar?team=${groupCode}`;
/** (#277) 다가오는 일정 목록 (D-70), 빈 시간 찾기 */
export const upcomingUrl = (groupCode: string) => `/upcoming?team=${groupCode}`;
export const freeUrl = (groupCode: string) => `/free?team=${groupCode}`;
/** (#189) 약속 투표 화면 */
export const pollUrl = (groupCode: string, pollCode: string) =>
  `/polls/${pollCode}?team=${groupCode}`;
/**
 * (#528) 공지 상세. 팀과 무관한 공개 경로. (#544) `?from=push` 로 웹이 읽은 경로를 push 로 기록한다 (D-293).
 * 이미 보낸 옛 경로(`/notices/{id}`)도 그대로 열리고 경로는 detail 로 남는다
 */
export const noticeUrl = (noticeId: number) => `/notices/${noticeId}?from=push`;

/** 종일 일정의 마지막 날 (끝은 배타적) */
function lastAllDayDate(endsAt: Date): string {
  return kstDate(new Date(endsAt.getTime() - 1));
}

export interface ReminderTarget {
  groupId: number;
  groupName: string;
  /** (#311) 팀 공개 코드 */
  groupCode: string;
  eventId: number;
  /** (#311) 일정 공개 코드 */
  eventCode: string;
  /** 반복이면 회차의 원래 날짜, 한 번짜리는 null */
  occurrence: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  reminder: EventReminder;
}

/** 일정 알림 (설계 6장 REMINDER). today 는 지금의 KST 날짜 (연도 표기 판단) */
export function reminderPayload(
  target: ReminderTarget,
  today: string,
): PushPayload {
  const date = kstDate(target.startsAt);
  let body: string;
  if (target.allDay) {
    const when = target.reminder === 'DAY_BEFORE_0900' ? '내일' : '오늘';
    const last = lastAllDayDate(target.endsAt);
    body =
      last <= date
        ? `${when} 종일`
        : `${when}부터 ${kstDateLabel(last, today)}까지`;
  } else {
    const time = kstTimeLabel(target.startsAt);
    const lead: Partial<Record<EventReminder, string>> = {
      AT_START: '지금',
      MIN_10: '10분 뒤',
      HOUR_1: '1시간 뒤',
      DAY_1: '내일',
    };
    body = `${lead[target.reminder] ?? '지금'} ${time}`;
  }
  // 회차 시작(종일은 그날 끝 KST 24:00) 이 지나면 의미 없다 (D-98)
  const expiresAt = target.allDay
    ? kstMidnight(addDays(lastAllDayDate(target.endsAt), 1)).getTime()
    : target.startsAt.getTime();
  return {
    title: target.title,
    subtitle: target.groupName,
    body,
    url: eventUrl(target.groupCode, target.eventCode, target.occurrence),
    expiration: epochSeconds(expiresAt),
  };
}

export interface ChangeLogSnapshot {
  eventId: number | null;
  /** (#311) 지금 남아 있는 원본의 공개 코드. 삭제됐으면 null (새 소식 화면으로) */
  eventCode: string | null;
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
  /** (#311) 팀 공개 코드 */
  groupCode: string;
  /** 변경한 사람의 그 팀 표시 이름 (나갔으면 닉네임, 탈퇴했으면 "탈퇴한 멤버") */
  actorName: string;
  /** 묶은 결과 동작 */
  action: ChangeAction;
  log: ChangeLogSnapshot;
}

/** 웹 newsPhrase 와 같은 문장 (추가는 묶은 결과라 로그의 범위와 관계없이 반복 여부만 본다) */
export function changePhrase(
  action: ChangeAction,
  log: Pick<ChangeLogSnapshot, 'repeat' | 'scope' | 'occurrence'>,
): string {
  if (action === 'CREATED')
    return log.repeat
      ? `${REPEAT_NAME[log.repeat]} 반복 일정을 추가했어요`
      : '일정을 추가했어요';
  if (log.scope && log.occurrence) {
    const day = monthDay(log.occurrence);
    if (action === 'UPDATED')
      return log.scope === 'THIS'
        ? `${day} 일정만 수정했어요`
        : `${day}부터 반복 일정을 수정했어요`;
    return log.scope === 'THIS'
      ? `${day} 일정을 삭제했어요`
      : `${day}부터 반복을 삭제했어요`;
  }
  return action === 'UPDATED' ? '일정을 수정했어요' : '일정을 삭제했어요';
}

/** 팀원 변경 (설계 6장 CHANGE). now 는 펼치는 시각 */
export function changePayload(target: ChangeTarget, now: Date): PushPayload {
  const { log } = target;
  const startDate = kstDate(log.startsAt);
  const when = log.allDay ? '종일' : kstTimeLabel(log.startsAt);
  let url: string;
  // 원본이 지워졌으면(로그의 eventId SetNull) 코드가 없다 → 새 소식 화면
  if (target.action === 'DELETED' || log.eventCode === null) {
    url = newsUrl(target.groupCode);
  } else if (log.scope === 'THIS' && log.occurrence) {
    url = eventUrl(target.groupCode, log.eventCode, log.occurrence);
  } else {
    // 그 밖의 반복은 스냅샷이 (새) 원본 첫 회차라 회차 날짜도 스냅샷 시작 날짜
    url = eventUrl(
      target.groupCode,
      log.eventCode,
      log.repeat ? startDate : null,
    );
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
  /** (#311) 팀 공개 코드 */
  groupCode: string;
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
    url: anniversariesUrl(target.groupCode),
    expiration: epochSeconds(kstMidnight(addDays(sendDay, 1)).getTime()),
  };
}

/** 새 멤버 합류 (설계 6장 JOIN). 문장에 팀 이름이 있어 subtitle 을 두지 않는다 */
export function joinPayload(
  groupCode: string,
  groupName: string,
  memberName: string,
  now: Date,
): PushPayload {
  return {
    title: `${memberName}님이 '${groupName}' 에 들어왔어요`,
    subtitle: null,
    body: null,
    url: calendarUrl(groupCode),
    expiration: epochSeconds(now.getTime() + DAY_MS),
  };
}

/**
 * (#279) 일정 가져오기 한 번에 팀원 변경 알림 1건 (D-166). 제목은 새 소식 줄과 같은 문장, 누르면 그 팀 달력.
 * 일정마다 보내지 않는다 (가져오기는 EventLog 와 2분 묶음을 거치지 않는다)
 */
export function importPayload(
  groupCode: string,
  groupName: string,
  actorName: string,
  count: number,
  now: Date,
): PushPayload {
  return {
    title: `${actorName}님이 일정 ${count.toLocaleString('en-US')}개를 가져왔어요`,
    subtitle: groupName,
    body: null,
    url: calendarUrl(groupCode),
    expiration: epochSeconds(now.getTime() + DAY_MS),
  };
}

/** (#189) 약속 투표 알림의 공통 대상 */
export interface PollTarget {
  groupName: string;
  groupCode: string;
  pollCode: string;
  title: string;
}

/** (#189) 후보 하나를 문장으로: '11월 22일 (토) 오후 7:00', 종일은 '11월 22일 (토) 종일'. today 는 지금의 KST 날짜 (연도 표기) */
export function pollTimeLabel(
  option: { startsAt: Date; allDay: boolean },
  today: string,
): string {
  return `${kstDateLabel(kstDate(option.startsAt), today)} ${option.allDay ? '종일' : kstTimeLabel(option.startsAt)}`;
}

/**
 * (#189) 투표 열림 (설계 약속-투표.md 6장). 대상 팀원(연 사람 제외)에게 바로. 본문은 후보 수와 마감.
 * 만료는 24시간 뒤와 마감 중 이른 쪽 (마감이 지나면 답할 수 없다)
 */
export function pollOpenedPayload(
  target: PollTarget & {
    actorName: string;
    optionCount: number;
    deadline: Date | null;
  },
  now: Date,
): PushPayload {
  const deadline = target.deadline
    ? `, 마감 ${pollTimeLabel({ startsAt: target.deadline, allDay: false }, kstDate(now))}`
    : '';
  const expiresAt = Math.min(
    now.getTime() + DAY_MS,
    target.deadline?.getTime() ?? Number.POSITIVE_INFINITY,
  );
  return {
    title: `${target.actorName}님이 '${target.title}' 시간을 묻고 있어요`,
    subtitle: target.groupName,
    body: `후보 ${target.optionCount}개${deadline}`,
    url: pollUrl(target.groupCode, target.pollCode),
    expiration: epochSeconds(
      Math.max(expiresAt, now.getTime() + 10 * MINUTE_MS),
    ),
  };
}

/** (#189) 마감 (연 사람에게 1건). 정하기는 마감 뒤에도 된다 */
export function pollDeadlinePayload(
  target: PollTarget,
  now: Date,
): PushPayload {
  return {
    title: `'${target.title}' 투표가 끝났어요`,
    subtitle: target.groupName,
    body: '시간을 정해 주세요',
    url: pollUrl(target.groupCode, target.pollCode),
    expiration: epochSeconds(now.getTime() + DAY_MS),
  };
}

/** (#189) 정함. 그 확정으로 생긴 일정의 팀원 변경 알림 대신 이 1건 (D-236). 누르면 그 일정 */
export function pollClosedPayload(
  target: PollTarget & {
    actorName: string;
    eventCode: string;
    option: { startsAt: Date; allDay: boolean };
  },
  now: Date,
): PushPayload {
  return {
    title: `${target.actorName}님이 '${target.title}' 시간을 정했어요`,
    subtitle: target.groupName,
    body: pollTimeLabel(target.option, kstDate(now)),
    url: eventUrl(target.groupCode, target.eventCode, null),
    expiration: epochSeconds(now.getTime() + DAY_MS),
  };
}

/** (#528) 공지 푸시 본문 상한 (글자). 잠금 화면 두세 줄 안. 넘치면 잘라 '…' (D-287) */
export const NOTICE_BODY_PREVIEW_MAX = 80;

const graphemes = new Intl.Segmenter('ko', { granularity: 'grapheme' });

/** (#528) 본문의 첫 줄(빈 줄은 건너뜀)을 앞뒤 공백을 자르고 상한까지. 글자는 보이는 글자(grapheme) 단위로 센다(이모지가 쪼개지지 않게) */
export function noticeBodyPreview(
  body: string,
  max = NOTICE_BODY_PREVIEW_MAX,
): string | null {
  const line = body
    .split(/\r?\n/)
    .map((row) => row.trim())
    .find((row) => row.length > 0);
  if (!line) return null;
  const chars = Array.from(graphemes.segment(line), (part) => part.segment);
  return chars.length <= max
    ? line
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/**
 * (#528) 공지 푸시 (D-287). 제목 = 공지 제목, 본문 = 본문 첫 줄. 팀이 없어 subtitle 과 Android 앞머리를 두지 않는다.
 * 누르면 공지 상세. 만료는 24시간 뒤 (변경 알림과 같음)
 */
export function noticePayload(
  notice: { id: number; title: string; body: string },
  now: Date,
): PushPayload {
  return {
    title: notice.title,
    subtitle: null,
    body: noticeBodyPreview(notice.body),
    url: noticeUrl(notice.id),
    expiration: epochSeconds(now.getTime() + DAY_MS),
  };
}

/** (#277) 순간 → KST 요일 한 글자 (월~일) */
export function kstWeekday(instant: Date): string {
  return WEEKDAYS[new Date(instant.getTime() + KST_OFFSET_MS).getUTCDay()];
}

/** (#277) 요약 본문에 넣는 일정 한 줄. startsAt 은 이번 주 안으로 자른 시작 (지난주부터 이어지는 여러 날 일정은 월요일) */
export interface WeeklyItem {
  title: string;
  startsAt: Date;
}

export interface WeeklySummaryTarget {
  groupName: string;
  groupCode: string;
  /** 그 주 월요일 'YYYY-MM-DD' (KST) */
  monday: string;
  /** 이번 주와 겹치는 회차 수 (1 이상) */
  count: number;
  /** 시작 순 앞 2개 */
  items: WeeklyItem[];
  /** 이번 주 첫 기념일 항목 (D-92 우선순위). 없으면 null */
  anniversary: { date: string; title: string } | null;
}

/** 주간 알림 만료: 그 주 월요일 KST 24:00 (D-98 확장, D-203) */
const weeklyExpiration = (monday: string) =>
  epochSeconds(kstMidnight(addDays(monday, 1)).getTime());

/**
 * (#277) 주간 요약 (설계 6장 WEEKLY SUMMARY). 숫자와 사실만, 권유형 문구 금지 (D-204).
 * 본문 `{요일} {제목}, {요일} {제목} 외 {N-2}개`. 이번 주 기념일이 있으면 `. {요일}요일은 {제목}이에요`
 */
export function weeklySummaryPayload(target: WeeklySummaryTarget): PushPayload {
  const shown = target.items.slice(0, 2);
  let body = shown
    .map((item) => `${kstWeekday(item.startsAt)} ${item.title}`)
    .join(', ');
  if (target.count > shown.length)
    body += ` 외 ${target.count - shown.length}개`;
  if (target.anniversary) {
    const dow =
      WEEKDAYS[
        new Date(`${target.anniversary.date}T00:00:00.000Z`).getUTCDay()
      ];
    body += `. ${dow}요일은 ${copula(target.anniversary.title)}`;
  }
  return {
    title: `이번 주 일정 ${target.count}개`,
    subtitle: target.groupName,
    body,
    url: upcomingUrl(target.groupCode),
    expiration: weeklyExpiration(target.monday),
    variant: 'SUMMARY',
  };
}

export interface WeeklyNudgeTarget {
  groupName: string;
  groupCode: string;
  monday: string;
  /** 이번 주 다 같이 비는 시간 (1개 이상, 시작 순) */
  slots: { startsAt: Date; endsAt: Date }[];
}

/** (#277) 조용한 팀 깨우기 (설계 6장 WEEKLY NUDGE). 첫 빈 시간 하나와 나머지 수 */
export function weeklyNudgePayload(target: WeeklyNudgeTarget): PushPayload {
  const [first] = target.slots;
  const rest = target.slots.length - 1;
  return {
    title: '2주 동안 같이 잡은 일정이 없어요',
    subtitle: target.groupName,
    body: `이번 주 다 같이 비는 시간: ${kstWeekday(first.startsAt)} ${kstTimeLabel(first.startsAt)}~${kstTimeLabel(first.endsAt)}${rest > 0 ? ` 외 ${rest}개` : ''}`,
    url: freeUrl(target.groupCode),
    expiration: weeklyExpiration(target.monday),
    variant: 'NUDGE',
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
    expiration:
      kind === 'REMINDER'
        ? Math.max(
            payload.expiration,
            epochSeconds(now.getTime() + 10 * MINUTE_MS),
          )
        : payload.expiration,
  };
  if (payload.subtitle) {
    if (device.platform === 'IOS') message.subtitle = payload.subtitle;
    else message.title = `[${payload.subtitle}] ${payload.title}`;
  }
  if (payload.body) message.body = payload.body;
  return message;
}
