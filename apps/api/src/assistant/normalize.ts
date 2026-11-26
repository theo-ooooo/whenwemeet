import type { Member } from '../common/member.js';
import { ApiException } from '../common/errors.js';
import { isCalendarDate } from '../common/validation.js';
import {
  addDays,
  dateToDay,
  kstDate,
  kstMidnight,
} from '../events/recurrence.js';
import { checkOptions } from '../polls/poll-rules.js';
import type { Interval } from '../free-slots/slots.js';
import type {
  ClarifyField,
  DaysFilter,
  EventDraftCard,
  PollDraft,
} from './assistant.types.js';
import { kstTime, kstWeekday } from './prompt.js';
import { MAX_DRAFT_EVENTS } from './tools.js';
import {
  isPastThisWeekday,
  NO_WHEN,
  resolvePeriod,
  resolveWhen,
  type WhenArg,
  type Which,
} from './when.js';

/**
 * (#450) 모델 인자 검사, 정규화 (설계 AI-비서.md 4-1, D-268). 순수 함수.
 * 날짜와 시각은 KST 글자로 받아 ISO UTC 로 바꾸고, 사람은 이름으로 받아 지금 팀 멤버 안에서만 찾는다.
 * 고칠 수 없는 값은 NormalizeProblem 으로 던진다 (되묻기, 형식 실패, 못 하는 일)
 */

export type Problem =
  | {
      kind: 'clarify';
      field: ClarifyField;
      name?: string;
      choices?: Member[];
      subject?: string;
    }
  | { kind: 'invalid' }
  | { kind: 'unsupported'; action: 'team_only' };

export class NormalizeProblem extends Error {
  constructor(readonly problem: Problem) {
    super(`볼까 인자 정규화: ${problem.kind}`);
    this.name = 'NormalizeProblem';
  }
}

const clarify = (
  field: ClarifyField,
  extra: { name?: string; choices?: Member[] } = {},
) => new NormalizeProblem({ kind: 'clarify', field, ...extra });
const invalid = () => new NormalizeProblem({ kind: 'invalid' });

export const MAX_TITLE = 50;
export const MAX_PLACE = 100;
export const MAX_NAME = 20;
export const MAX_KEYWORD = 20;
/** 일정 길이 상한 (D-15) */
export const MAX_EVENT_DAYS = 30;
/** 빈 시간, 일정 찾기 기간 상한 (일) */
export const MAX_SEARCH_DAYS = 31;
/** 기념일 찾기 기간 상한 (일). 기본은 오늘부터 1년 */
export const MAX_ANNIVERSARY_DAYS = 731;
export const DEFAULT_DAY_START = '09:00';
export const DEFAULT_DAY_END = '23:00';
export const DEFAULT_MIN_MINUTES = 120;
export const MIN_MINUTES_RANGE = [30, 720] as const;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 비서가 보는 팀 멤버 한 명 */
export interface TeamMember {
  userId: number;
  /** Membership.displayName ?? User.nickname */
  displayName: string;
  nickname: string;
  member: Member;
}

export interface NormalizeContext {
  now: Date;
  /** 요청자 */
  userId: number;
  /** 지금 팀 멤버, 가입순 */
  members: TeamMember[];
  personal: boolean;
  /**
   * (#458) 사용자가 실제로 쓴 글 (이번 글 + 대화 기록의 사용자 글). 모델이 준 이름, "모두" 를 이 글에 나온 것만 믿는다 (D-277).
   * 대화 기록의 볼까 글(서버 문구)은 넣지 않는다
   */
  spoken: string;
  /** (#459) 이번 글만. 기간 길이("일주일 동안"), 전원 말("둘 다")을 서버가 직접 읽을 때 쓴다 (D-278) */
  text: string;
  /**
   * (#474) 한 글의 일정 여러 개를 만드는 중 (D-280). 이번 글의 전원 말이 어느 일정 말인지 서버가 가를 수 없으므로
   * 모델이 일정 하나에라도 전원을 매겼으면(modelSawEveryone) 일정마다 모델 값을 따르고, 아니면 이름이 없는 일정에만 D-278 ③ 을 쓴다
   */
  multiEvent?: { modelSawEveryone: boolean };
}

// ---------- 글자 ----------

/** 앞뒤 공백, 줄바꿈, 제어 문자를 지운다 (가운데 줄바꿈, 제어 문자는 공백 하나로) */
export function cleanText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 주소처럼 보이는 글자 (http, www.) */
export const hasUrl = (text: string): boolean => /http|www\./i.test(text);

/** 글자 수(코드 포인트) 기준으로 자른다 */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

// ---------- 날짜, 시각 ----------

/** 있는 날짜인가 ('2026-02-30' 은 아님) */
export function isRealDate(date: string): boolean {
  return isCalendarDate(date);
}

/** 날짜는 오늘 1년 전 ~ 2년 뒤만. 아니면 clarify(date) */
export function checkDate(date: string, today: string): string {
  if (
    !isRealDate(date) ||
    date < addDays(today, -365) ||
    date > addDays(today, 730)
  )
    throw clarify('date');
  return date;
}

/** KST 날짜 + 'HH:mm'(24:00 은 다음 날 00:00) → UTC 순간 (+09:00 고정) */
export function kstToDate(date: string, time: string): Date {
  if (time === '24:00') return kstMidnight(addDays(date, 1));
  return new Date(`${date}T${time}:00.000+09:00`);
}

export const minutesOf = (time: string): number =>
  time === '24:00'
    ? 24 * 60
    : Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// ---------- 사람 ----------

const SELF_WORDS = new Set(['나', '저', '내', '내가', '제가']);
const EVERYONE_WORDS = new Set(['모두', '다같이', '전원', '우리', '다']);
/** 사용자 글에서 "전원" 을 뜻하는 말 (D-277). "회식" 처럼 모임 말만으로는 전원이 아니다 */
const EVERYONE_SPOKEN =
  /(다\s*(같이|함께)|모두|전원|다들|우리|전체|(둘|셋|넷|다섯|여섯)\s*(다|모두))/;
const key = (text: string): string => text.replace(/\s+/g, '').toLowerCase();

/** 받침이 있는 한글 글자인가 */
function hasFinalConsonant(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
}

/** 이름에서 "님", 받침 + "이" 를 뗀 후보들 (긴 것부터) */
function nameStems(name: string): string[] {
  const candidates: string[] = [name];
  if (name.endsWith('님') && name.length > 1)
    candidates.push(name.slice(0, -1));
  const last = candidates[candidates.length - 1];
  const chars = Array.from(last);
  if (
    chars.length > 1 &&
    chars[chars.length - 1] === '이' &&
    hasFinalConsonant(chars[chars.length - 2])
  )
    candidates.push(chars.slice(0, -1).join(''));
  return candidates;
}

export type NameMatch =
  | { kind: 'one'; member: TeamMember }
  | { kind: 'many'; members: TeamMember[] }
  | { kind: 'none' };

/**
 * 이름 → 지금 팀 멤버 (D-268). 앞 단계에서 맞으면 멈춘다.
 * ① "나", "저", "내" → 요청자 ② 표시 이름 또는 닉네임과 같음(대소문자, 공백 무시) ③ 끝의 "님" 을 뗀 값 ④ 받침 있는 이름 + "이" 의 "이" 를 뗀 값
 * ⑤ (#466) ②~④ 로 못 찾으면 세 글자 이상 한글 멤버 이름의 성(첫 글자)을 뗀 값 ("수경이" → "김수경")
 */
export function matchName(
  raw: string,
  context: Pick<NormalizeContext, 'userId' | 'members'>,
): NameMatch {
  const name = key(raw);
  if (SELF_WORDS.has(name)) {
    const me = context.members.find(
      (member) => member.userId === context.userId,
    );
    return me ? { kind: 'one', member: me } : { kind: 'none' };
  }
  for (const candidate of nameStems(name)) {
    const hits = context.members.filter(
      (member) =>
        key(member.displayName) === candidate ||
        key(member.nickname) === candidate,
    );
    if (hits.length === 1) return { kind: 'one', member: hits[0] };
    if (hits.length > 1) return { kind: 'many', members: hits };
  }
  for (const candidate of nameStems(name)) {
    const hits = context.members.filter(
      (member) =>
        givenName(member.displayName) === candidate ||
        givenName(member.nickname) === candidate,
    );
    if (hits.length === 1) return { kind: 'one', member: hits[0] };
    if (hits.length > 1) return { kind: 'many', members: hits };
  }
  return { kind: 'none' };
}

/** (#466) 세 글자 이상 한글 이름에서 성(첫 글자)을 뗀 값. 아니면 null */
function givenName(raw: string): string | null {
  const name = key(raw);
  const chars = Array.from(name);
  return chars.length >= 3 && /^[\uac00-\ud7a3]+$/.test(name)
    ? chars.slice(1).join('')
    : null;
}

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * (#458) 모델이 준 이름이 사용자 글에 실제로 나왔는가 (D-277). 이름(공백 무시) 또는 "님", "이" 를 뗀 값, 세 글자 이상 한글 이름은
 * 성을 뗀 값("김수경" → "수경")이 **낱말 첫머리**에 있어야 한다. 낱말 첫머리여야 "강남" 속 "남" 같은 우연을 거른다
 */
export function isMentioned(raw: string, spoken: string): boolean {
  const name = key(raw);
  if (name.length === 0) return false;
  if (SELF_WORDS.has(name)) return true;
  const stems = new Set(nameStems(name));
  // 늘리는 동안 새로 넣은 값을 다시 돌지 않게 사본으로 돈다
  for (const stem of Array.from(stems)) {
    const chars = Array.from(stem);
    if (chars.length >= 3 && /^[\uac00-\ud7a3]+$/.test(stem))
      stems.add(chars.slice(1).join(''));
  }
  const text = spoken.toLowerCase();
  return [...stems].some((stem) => {
    // 이름 글자 사이 공백은 무시 ("하 늘")
    const pattern = Array.from(stem).map(escapeRegExp).join('\\s*');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}`, 'u').test(text);
  });
}

/** 사용자 글에 "다 같이, 모두, 전원, 다들, 우리, 셋 다" 같은 전원 말이 있는가 */
export const saysEveryone = (spoken: string): boolean =>
  EVERYONE_SPOKEN.test(spoken);

/** 이름 하나를 멤버 한 명으로. 없거나 여럿이면 clarify(participant) */
export function resolveName(
  raw: string,
  context: Pick<NormalizeContext, 'userId' | 'members'>,
): TeamMember {
  const name = truncate(cleanText(raw), MAX_NAME);
  const match = matchName(name, context);
  if (match.kind === 'one') return match.member;
  if (match.kind === 'many')
    throw clarify('participant', {
      name,
      choices: match.members.map((member) => member.member),
    });
  throw clarify('participant', { name });
}

export interface ParticipantInput {
  participants: string[];
  everyone: boolean;
  includeMe: boolean;
}

/**
 * 참여자 id (가입순). everyone = 지금 멤버 전원 (D-263). 아니면 찾은 이름 + includeMe 면 요청자.
 * 이름도 everyone 도 없으면 fallback: 일정 초안은 요청자만(api.md 생성 기본), 빈 시간과 투표는 전원. 개인 팀은 늘 나만.
 * (#458) 모델이 준 이름과 everyone 은 사용자 글(spoken)에 나온 것만 믿는다. 글에 없는 이름은 버리고, 전원 말이 없으면 everyone 은 false (D-277)
 */
export function resolveParticipants(
  input: ParticipantInput,
  fallback: 'me' | 'all',
  context: NormalizeContext,
): number[] {
  const all = context.members.map((member) => member.userId);
  if (context.personal) return [context.userId];
  const everyoneSaid = saysEveryone(context.spoken);
  const names = input.participants
    .map(cleanText)
    .filter((name) => name.length > 0);
  // (#459) 이번 글에 "둘 다, 다 같이, 모두" 같은 전원 말이 있으면 모델 값과 상관없이 전원 (D-278)
  const forced = forcedEveryone(context.text);
  if (forced !== null && !trustModelEveryone(names, context))
    return forcedParticipants(forced, names, input.includeMe, context);
  if (
    everyoneSaid &&
    (input.everyone || names.some((name) => EVERYONE_WORDS.has(key(name))))
  )
    return all;
  const mentioned = names.filter(
    (name) =>
      !EVERYONE_WORDS.has(key(name)) && isMentioned(name, context.spoken),
  );
  if (mentioned.length === 0)
    return fallback === 'all' ? all : [context.userId];
  const ids = new Set<number>();
  for (const name of mentioned) ids.add(resolveName(name, context).userId);
  if (input.includeMe) ids.add(context.userId);
  return all.filter((id) => ids.has(id));
}

/**
 * (#474) 일정 여럿일 때 전원 말(D-278 ③)을 이 일정에 쓰지 않는가 (D-280). 모델이 어느 일정에 전원을 매겼거나
 * 이 일정에 글에 나온 이름이 있으면 그 일정의 모델 값을 따른다 ("회식은 다 같이, 영화는 수경이랑" 의 영화는 수경이와 나)
 */
function trustModelEveryone(
  names: string[],
  context: NormalizeContext,
): boolean {
  if (!context.multiEvent) return false;
  if (context.multiEvent.modelSawEveryone) return true;
  return names.some(
    (name) =>
      !EVERYONE_WORDS.has(key(name)) && isMentioned(name, context.spoken),
  );
}

/** (#474) 모델이 이 일정에 전원을 매겼는가 (everyone 또는 participants 의 "모두, 다같이" 같은 말) */
export const markedEveryone = (input: ParticipantInput): boolean =>
  input.everyone ||
  input.participants.some((name) => EVERYONE_WORDS.has(key(cleanText(name))));

export const membersOf = (
  ids: readonly number[],
  context: NormalizeContext,
): Member[] =>
  context.members
    .filter((member) => ids.includes(member.userId))
    .map((member) => member.member);

// ---------- (#459) 서버 안전장치 (D-278) ----------
// 실모델 평가(gpt-4.1-mini, gpt-4.1)에서 남은 실수를 서버가 사용자 글로 직접 바로잡는다

/**
 * 이번 글의 전원 말. "둘 다", "셋 다" 처럼 사람 수를 말했으면 그 수, 그 밖("다 같이, 함께 다, 모두, 전원, 다들, 우리 다")은 'all', 없으면 null.
 * "다" 뒤가 "음, 른, 르, 시, 녀" 면 "다음, 다른, 다시, 다녀" 라서 전원 말이 아니다 ("우리 다음 주")
 */
const COUNT_WORDS = ['둘', '셋', '넷', '다섯', '여섯'] as const;
const DA = '다(?!음|른|르|시|녀)';
const FORCE_COUNT = new RegExp(
  `(^|[^\\p{L}])(${COUNT_WORDS.join('|')})\\s*(${DA}|모두)`,
  'u',
);
const FORCE_ALL = new RegExp(
  `${DA}\\s*(같이|함께)|함께\\s*${DA}|모두|전원|다들|우리\\s*${DA}`,
  'u',
);

export function forcedEveryone(text: string): number | 'all' | null {
  const count = FORCE_COUNT.exec(text);
  if (count)
    return COUNT_WORDS.indexOf(count[2] as (typeof COUNT_WORDS)[number]) + 2;
  return FORCE_ALL.test(text) ? 'all' : null;
}

/**
 * 전원 말이 있을 때 참여자. 기본은 지금 멤버 전원.
 * 단, "수경이랑 지훈이 둘 다"처럼 사람 수를 말했고 글에 나온 이름(이나 그 이름 + 나)이 꼭 그 수이며 팀보다 적으면 그 사람들만
 */
function forcedParticipants(
  forced: number | 'all',
  names: string[],
  includeMe: boolean,
  context: NormalizeContext,
): number[] {
  const all = context.members.map((member) => member.userId);
  if (forced === 'all' || forced >= all.length) return all;
  const ids = new Set<number>();
  for (const name of names) {
    if (EVERYONE_WORDS.has(key(name)) || !isMentioned(name, context.spoken))
      continue;
    const match = matchName(name, context);
    if (match.kind === 'one') ids.add(match.member.userId);
  }
  if (ids.size !== forced && (includeMe || ids.size + 1 === forced))
    ids.add(context.userId);
  return ids.size === forced ? all.filter((id) => ids.has(id)) : all;
}

const WEEKDAY_CHARS = new Set(['일', '월', '화', '수', '목', '금', '토']);

/** 멤버 이름 꼴 (표시 이름, 닉네임, 세 글자 이상 한글 이름은 성 뗀 값). 공백 없이 소문자 */
function nameForms(members: readonly TeamMember[]): string[] {
  const forms = new Set<string>();
  for (const member of members) {
    for (const raw of [member.displayName, member.nickname]) {
      const name = key(raw);
      if (name.length === 0) continue;
      forms.add(name);
      const chars = Array.from(name);
      if (chars.length >= 3 && /^[가-힣]+$/.test(name))
        forms.add(chars.slice(1).join(''));
    }
  }
  return [...forms];
}

/**
 * 모델이 준 요일이 사실 이름의 첫 글자인가 ("다음 주 수경이 일정" 의 "수"를 수요일로 읽음).
 * 사용자 글에서 그 요일 글자로 시작하는 멤버 이름(두 글자 이상, 낱말 첫머리)을 지운 뒤 그 글자가 남지 않으면 이름이다.
 * 글자가 하나라도 남으면("수요일에 수경이랑") 모델을 믿는다
 */
export function weekdayIsName(
  when: WhenArg,
  context: Pick<NormalizeContext, 'members' | 'spoken'>,
): boolean {
  if (
    when.kind !== 'weekday' ||
    when.weekday === null ||
    !WEEKDAY_CHARS.has(when.weekday)
  )
    return false;
  const char = when.weekday;
  const all = nameForms(context.members).filter(
    (form) => Array.from(form).length >= 2,
  );
  // 그 글자로 시작하는 이름(성 뗀 값 포함)이 없으면 이름일 수 없다. 지울 때는 "김수경" 처럼 성 붙은 꼴도 지운다
  if (!all.some((form) => form.startsWith(char))) return false;
  const forms = all.filter((form) => form.includes(char));
  let text = context.spoken.toLowerCase();
  for (const form of forms.sort((a, b) => b.length - a.length)) {
    text = text.replace(
      new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(form)}`, 'gu'),
      '$1',
    );
  }
  return !text.includes(char);
}

/** 이번 글의 주 말 ("다다음 주", "다음 주, 담주", "이번 주") */
export function spokenWeek(text: string): Which | null {
  if (/다다음\s*주/.test(text)) return 'after_next';
  if (/(다음|담)\s*주/.test(text)) return 'next';
  if (/이번\s*주/.test(text)) return 'this';
  return null;
}

/** 일정, 투표 초안: 이름을 요일로 읽었으면 날짜를 말하지 않은 것으로 본다 (되묻기) */
const draftWhen = (when: WhenArg, context: NormalizeContext): WhenArg =>
  weekdayIsName(when, context) ? NO_WHEN : when;

/**
 * 빈 시간, 일정 찾기: 이름을 요일로 읽었으면 시작은 글의 주(없으면 모델의 주, 요일만이면 이번 주) 전체, 끝은 말하지 않은 것으로
 */
function periodWhens(
  from: WhenArg,
  to: WhenArg,
  context: NormalizeContext,
): { from: WhenArg; to: WhenArg } {
  let safeFrom = from;
  if (weekdayIsName(from, context)) {
    const which =
      spokenWeek(context.text) ??
      (from.which === null || from.which === 'nearest' ? 'this' : from.which);
    safeFrom = { ...NO_WHEN, kind: 'week', which };
  }
  return { from: safeFrom, to: weekdayIsName(to, context) ? NO_WHEN : to };
}

const NATIVE_DAYS: Record<string, number> = {
  하루: 1,
  이틀: 2,
  사흘: 3,
  나흘: 4,
  닷새: 5,
  엿새: 6,
  이레: 7,
  열흘: 10,
  보름: 15,
};
const NATIVE_COUNT: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4 };
const SPAN = '\\s*(동안|간|내|이내|안에)';
const countOf = (word: string): number => NATIVE_COUNT[word] ?? Number(word);

/** 이번 글의 기간 길이 ("3일 동안", "이틀간", "일주일 동안", "한 주", "2주 동안", "한 달 동안"). 일이면 { days }, 달이면 { months } */
export function spokenDuration(
  text: string,
): { days: number } | { months: number } | null {
  if (new RegExp(`일주일${SPAN}`).test(text)) return { days: 7 };
  const week = new RegExp(
    `(^|[^\\p{L}\\p{N}])(\\d{1,2}|한|두|세|네)\\s*주(일)?${SPAN}`,
    'u',
  ).exec(text);
  if (week) return { days: countOf(week[2]) * 7 };
  const month = new RegExp(
    `(^|[^\\p{L}\\p{N}])(\\d{1,2}|한|두|세)\\s*(달|개월)${SPAN}`,
    'u',
  ).exec(text);
  if (month) return { months: countOf(month[2]) };
  const day = new RegExp(
    `(^|[^\\p{L}\\p{N}])(\\d{1,3})\\s*일${SPAN}`,
    'u',
  ).exec(text);
  if (day) return { days: Number(day[2]) };
  const native = new RegExp(
    `(${Object.keys(NATIVE_DAYS).join('|')})${SPAN}`,
    'u',
  ).exec(text);
  if (native) return { days: NATIVE_DAYS[native[1]] };
  return null;
}

/** 시작 날짜 + 기간 길이 → 끝 날짜 (양끝 포함: 시작 + 길이 - 1일. 달은 다음 달 같은 날 - 1일, 그날이 없으면 말일) */
export function durationEnd(
  fromDate: string,
  duration: { days: number } | { months: number },
): string {
  if ('days' in duration)
    return addDays(fromDate, Math.max(1, duration.days) - 1);
  const [year, month, day] = fromDate.split('-').map(Number);
  const index = month - 1 + duration.months;
  const y = year + Math.floor(index / 12);
  const m = (index % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const same = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  return addDays(same, day > last ? 0 : -1);
}

/**
 * 빈 시간, 일정 찾기의 기간. 이름을 요일로 읽은 값은 바로잡고, 이번 글에 기간 길이가 있는데 모델이 끝을 빼먹었거나(하루로 끝남)
 * 시작도 없으면(오늘부터) 끝 = 시작 + 길이 - 1일
 */
export function spokenPeriodDates(
  from: WhenArg,
  to: WhenArg,
  context: NormalizeContext,
): { fromDate: string; toDate: string } {
  const today = kstDate(context.now);
  const safe = periodWhens(from, to, context);
  const duration = spokenDuration(context.text);
  if (duration === null) return periodDates(safe.from, safe.to, today);
  const start: WhenArg =
    safe.from.kind === null
      ? { ...NO_WHEN, kind: 'relativeDays', days: 0 }
      : safe.from;
  if (safe.to.kind !== null) {
    const period = periodDates(start, safe.to, today);
    return period.toDate !== period.fromDate
      ? period
      : {
          fromDate: period.fromDate,
          toDate: durationEnd(period.fromDate, duration),
        };
  }
  const fromDate = resolveWhen(start, { today, edge: 'start' });
  if (fromDate === null) throw clarify('period');
  return { fromDate, toDate: durationEnd(fromDate, duration) };
}

// ---------- 도구별 ----------

/** 카드에 나가는 모델 글자 (제목). URL 이면 형식 실패, 비면 clarify(title) */
export function cardTitle(raw: string): string {
  const title = cleanText(raw);
  if (hasUrl(title)) throw invalid();
  if (title.length === 0) throw clarify('title');
  return truncate(title, MAX_TITLE);
}

export interface DraftEventArgs extends ParticipantInput {
  title: string;
  date: WhenArg;
  startTime: string | null;
  endDate: WhenArg;
  endTime: string | null;
  allDay: boolean;
  place: string | null;
}

/** (#474) draft_event 인자. 한 글의 일정 여러 개 (1~5개, D-280) */
export interface DraftEventsArgs {
  events: DraftEventArgs[];
}

/** 지금 KST 분 (0~1439) */
const nowMinutesOf = (now: Date): number => minutesOf(kstTime(now));

/**
 * (#458) 일정, 투표 초안의 날짜 표현 → KST 날짜 (D-276). 없거나 풀 수 없거나 범위 밖이면 clarify(date).
 * "이번 주 X요일" 이 이미 지난 날이면 지난 일정을 몰래 만들지도, 다음 주로 몰래 옮기지도 않고 되묻는다
 */
export function draftDate(
  when: WhenArg,
  context: NormalizeContext,
  startTime: string | null,
): string {
  const today = kstDate(context.now);
  const date = resolveWhen(when, {
    today,
    nowMinutes: nowMinutesOf(context.now),
    startMinutes: startTime === null ? null : minutesOf(startTime),
  });
  if (date === null || isPastThisWeekday(when, date, today))
    throw clarify('date');
  return checkDate(date, today);
}

/** draft_event → 일정 초안 카드 (끝 없음 +1시간, 끝 <= 시작 = 다음 날, 종일은 KST 자정 경계, 30일 상한) */
export function normalizeDraftEvent(
  args: DraftEventArgs,
  context: NormalizeContext,
): EventDraftCard {
  const today = kstDate(context.now);
  const title = cardTitle(args.title);
  const startWhen = draftWhen(args.date, context);
  const date = draftDate(
    startWhen,
    context,
    args.allDay ? null : args.startTime,
  );
  let endDate: string | null = null;
  const endWhen = draftWhen(args.endDate, context);
  if (endWhen.kind !== null) {
    const resolved = resolveWhen(endWhen, {
      today,
      edge: 'end',
      notBefore: date,
    });
    if (resolved === null) throw clarify('date');
    endDate = checkDate(resolved, today);
  }
  let startsAt: Date;
  let endsAt: Date;
  if (args.allDay) {
    startsAt = kstMidnight(date);
    endsAt = kstMidnight(addDays(endDate ?? date, 1));
  } else {
    if (args.startTime === null) throw clarify('time');
    startsAt = kstToDate(date, args.startTime);
    if (args.endTime === null) endsAt = new Date(startsAt.getTime() + HOUR_MS);
    else if (
      endDate === null &&
      minutesOf(args.endTime) <= minutesOf(args.startTime)
    )
      endsAt = kstToDate(addDays(date, 1), args.endTime);
    else endsAt = kstToDate(endDate ?? date, args.endTime);
  }
  const length = endsAt.getTime() - startsAt.getTime();
  if (length <= 0 || length > MAX_EVENT_DAYS * DAY_MS) throw clarify('time');

  let place: { text: string } | null = null;
  if (args.place !== null) {
    const text = cleanText(args.place);
    if (hasUrl(text)) throw invalid();
    if (text.length > 0) place = { text: truncate(text, MAX_PLACE) };
  }
  const participants = resolveParticipants(args, 'me', context);
  return {
    title,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    allDay: args.allDay,
    place,
    participants,
    members: membersOf(participants, context),
    // (#566) "음력 3월 15일" 로 말했으면 음력으로 넣은 일정 (D-298). 카드와 저장한 일정이 음력 날짜를 같이 보인다
    ...(startWhen.kind === 'lunarMonthDay'
      ? { lunarInput: true as const }
      : {}),
  };
}

/**
 * (#474) draft_event → 일정 초안 카드 여러 개 (D-280). 앞 5개만, 말한 순서대로.
 * 전부 아니면 하나도: 하나라도 되물어야 하면 처음 걸린 일정의 되묻기만 답한다 (여럿이면 제목을 실어 "'영화'는 언제로 할까요?").
 * 사용자는 빠진 값을 넣어 다시 말하고, 반쪽 카드가 남아 같은 일정을 두 번 넣는 일이 없다
 */
export function normalizeDraftEvents(
  args: DraftEventsArgs,
  context: NormalizeContext,
): EventDraftCard[] {
  const events = args.events.slice(0, MAX_DRAFT_EVENTS);
  const multi = events.length > 1;
  const scoped: NormalizeContext = multi
    ? {
        ...context,
        multiEvent: { modelSawEveryone: events.some(markedEveryone) },
      }
    : context;
  return events.map((event) => {
    try {
      return normalizeDraftEvent(event, scoped);
    } catch (error) {
      if (
        !multi ||
        !(error instanceof NormalizeProblem) ||
        error.problem.kind !== 'clarify'
      )
        throw error;
      // 어느 일정을 되묻는지 제목을 싣는다 (주소처럼 보이는 제목은 싣지 않는다)
      const title = cleanText(event.title);
      throw new NormalizeProblem({
        ...error.problem,
        subject: title && !hasUrl(title) ? title : undefined,
      });
    }
  });
}

/** 양끝 포함 KST 날짜 기간 → [from 00:00, to 다음 날 00:00). 1~maxDays 일이 아니면 clarify(period) */
export function normalizePeriod(
  fromDate: string,
  toDate: string,
  maxDays: number,
  today: string,
): { fromDate: string; toDate: string; from: Date; to: Date } {
  if (!isRealDate(fromDate) || !isRealDate(toDate)) throw clarify('period');
  checkPeriodDate(fromDate, today);
  checkPeriodDate(toDate, today);
  const days = dateToDay(toDate) - dateToDay(fromDate) + 1;
  if (days < 1 || days > maxDays) throw clarify('period');
  return {
    fromDate,
    toDate,
    from: kstMidnight(fromDate),
    to: kstMidnight(addDays(toDate, 1)),
  };
}

function checkPeriodDate(date: string, today: string): void {
  if (date < addDays(today, -365) || date > addDays(today, 730))
    throw clarify('period');
}

/** (#458) 기간 표현 → 양끝 포함 KST 날짜 (D-276). 없거나 풀 수 없으면 clarify(period) */
export function periodDates(
  from: WhenArg,
  to: WhenArg,
  today: string,
): { fromDate: string; toDate: string } {
  const period = resolvePeriod(from, to, today);
  if (period === null) throw clarify('period');
  return period;
}

export interface FindFreeTimeArgs extends ParticipantInput {
  from: WhenArg;
  to: WhenArg;
  days: DaysFilter;
  dayStart: string | null;
  dayEnd: string | null;
  minMinutes: number | null;
  next: 'show' | 'poll';
  purpose: string | null;
}

export interface FreeTimePlan {
  fromDate: string;
  toDate: string;
  from: Date;
  to: Date;
  dayStart: string;
  dayEnd: string;
  minMinutes: number;
  days: DaysFilter;
  participants: number[];
  poll: boolean;
  pollTitle: string | null;
}

/** 모델 글자에서 온 짧은 제목. URL, 줄바꿈(정리 전 기준)이 있거나 비면 버린다 (설계 5장) */
function optionalTitle(raw: string | null): string | null {
  if (raw === null || /[\r\n]/.test(raw)) return null;
  const text = cleanText(raw);
  if (text.length === 0 || hasUrl(text)) return null;
  return truncate(text, MAX_TITLE);
}

/** find_free_time → 계산 조건 (기간 1~31일, 하루 창 기본 09:00~23:00, 최소 길이 기본 120분, 30~720 으로 자름) */
export function normalizeFreeTime(
  args: FindFreeTimeArgs,
  context: NormalizeContext,
): FreeTimePlan {
  const today = kstDate(context.now);
  const { fromDate, toDate } = spokenPeriodDates(args.from, args.to, context);
  const period = normalizePeriod(fromDate, toDate, MAX_SEARCH_DAYS, today);
  const dayStart = args.dayStart ?? DEFAULT_DAY_START;
  const dayEnd = args.dayEnd ?? DEFAULT_DAY_END;
  if (minutesOf(dayStart) >= minutesOf(dayEnd)) throw clarify('period');
  const minMinutes = Math.min(
    MIN_MINUTES_RANGE[1],
    Math.max(MIN_MINUTES_RANGE[0], args.minMinutes ?? DEFAULT_MIN_MINUTES),
  );
  return {
    ...period,
    dayStart,
    dayEnd,
    minMinutes,
    days: args.days,
    participants: resolveParticipants(args, 'all', context),
    poll: args.next === 'poll' && !context.personal,
    pollTitle: optionalTitle(args.purpose),
  };
}

/** 주말 = KST 토, 일 / 평일 = 월~금 (공휴일은 따지지 않음). 구간 시작 날짜 기준 */
export function filterByDays(
  slots: readonly Interval[],
  days: DaysFilter,
): Interval[] {
  if (days === 'all') return [...slots];
  return slots.filter((slot) => {
    const weekday = kstWeekday(kstDate(slot.startsAt));
    const weekend = weekday === 0 || weekday === 6;
    return days === 'weekend' ? weekend : !weekend;
  });
}

export interface DraftPollArgs {
  title: string;
  options: { date: WhenArg; startTime: string; endTime: string }[];
  participants: string[];
  everyone: boolean;
}

/** draft_poll → 투표 초안 (개인 팀은 못 함, 후보 검사는 api.md 2.13 과 같은 함수) */
export function normalizeDraftPoll(
  args: DraftPollArgs,
  context: NormalizeContext,
): PollDraft {
  if (context.personal)
    throw new NormalizeProblem({ kind: 'unsupported', action: 'team_only' });
  const title = cardTitle(args.title);
  const raw = args.options.map((option) => {
    const date = draftDate(
      draftWhen(option.date, context),
      context,
      option.startTime,
    );
    return {
      startsAt: kstToDate(date, option.startTime),
      endsAt: kstToDate(date, option.endTime),
      allDay: false as const,
    };
  });
  let options;
  try {
    options = checkOptions(raw, context.now);
  } catch (error) {
    if (error instanceof ApiException) throw clarify('period');
    throw error;
  }
  const participants = resolveParticipants(
    {
      participants: args.participants,
      everyone: args.everyone,
      includeMe: true,
    },
    'all',
    context,
  );
  return {
    title,
    options: options.map((option) => ({
      startsAt: option.startsAt.toISOString(),
      endsAt: option.endsAt.toISOString(),
      allDay: false as const,
    })),
    participants,
  };
}

export interface ListEventsArgs {
  from: WhenArg;
  to: WhenArg;
  member: string | null;
}

/** list_events → 기간(1~31일)과 거를 사람. 사람이 없거나 여럿이면 clarify(participant). 글에 없는 이름은 거르지 않는다 (D-277) */
export function normalizeListEvents(
  args: ListEventsArgs,
  context: NormalizeContext,
) {
  const today = kstDate(context.now);
  const { fromDate, toDate } = spokenPeriodDates(args.from, args.to, context);
  const period = normalizePeriod(fromDate, toDate, MAX_SEARCH_DAYS, today);
  const name = args.member === null ? '' : cleanText(args.member);
  const said = name.length > 0 && isMentioned(name, context.spoken);
  return {
    ...period,
    memberId: said ? resolveName(name, context).userId : null,
  };
}

export interface FindAnniversaryArgs {
  keyword: string | null;
  from: WhenArg;
  to: WhenArg;
}

/** 그 자체로 기간인 표현 (주, 주말, 달) */
const RANGE_KINDS = new Set<WhenArg['kind']>(['week', 'weekend', 'month']);

/** find_anniversary → 기간(없으면 오늘부터 1년, 하루 표현 하나면 그날부터 1년, 주나 달이면 그 기간)과 검색어 (20자) */
export function normalizeFindAnniversary(
  args: FindAnniversaryArgs,
  context: NormalizeContext,
) {
  const today = kstDate(context.now);
  let fromDate = today;
  let toDate = addDays(today, 365);
  if (args.from.kind !== null) {
    if (args.to.kind !== null || RANGE_KINDS.has(args.from.kind)) {
      ({ fromDate, toDate } = periodDates(args.from, args.to, today));
    } else {
      const start = resolveWhen(args.from, { today });
      if (start === null) throw clarify('period');
      fromDate = start;
      toDate = addDays(start, 365);
    }
  }
  const period = normalizePeriod(fromDate, toDate, MAX_ANNIVERSARY_DAYS, today);
  const keyword =
    args.keyword === null ? '' : truncate(cleanText(args.keyword), MAX_KEYWORD);
  return { ...period, keyword: keyword.length === 0 ? null : keyword };
}
