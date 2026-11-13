import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { Member, MemberResolver, paletteColorOf } from '../common/member.js';
import { parsePublicCode } from '../common/public-code.js';
import { isCalendarDate, parseIsoDate } from '../common/validation.js';
import { MembershipService } from '../groups/membership.service.js';
import { type EventReminder, remindAt, reminderFits, reminderMismatchMessage } from '../push/remind-at.js';
import { EventResponsesRepository } from '../event-responses/event-responses.repository.js';
import {
  type ReactionMember,
  reactionMembers,
  type ReactionSummary,
  type RsvpMember,
  rsvpMembers,
  type RsvpSummary,
  occurrenceKey,
  summarizeReactions,
  summarizeRsvp,
} from '../event-responses/responses.js';
import type { EventInputDto, EventPatchDto } from './dto/event.dto.js';
import {
  EventCreateInput,
  EventExceptionRow,
  EventRow,
  EventsRepository,
  type EventUpdateInput,
  type ExceptionFields,
  likePattern,
  type LogSnapshot,
  type ScopeLog,
} from './events.repository.js';
import {
  type ParticipantSet,
  type ParticipantsInput,
  type ParticipantsView,
  parseParticipants,
  participantsFailed,
  PARTICIPANTS_THIS_SCOPE_MESSAGE,
  resolveParticipants,
  sameParticipants,
  toParticipantsView,
} from './participants.js';
import {
  compareSearchItems,
  type MatchedField,
  matchedFields,
  parseSearchQuery,
  representativeOccurrence,
  SEARCH_SERIES_CAP,
} from './event-search.js';
import { CLEARED_PLACE, parsePlace, type PlaceView, samePlace, toPlaceView } from './place.js';
import {
  anchorMatchesStart,
  applyException,
  expand,
  fitsInPeriod,
  isOccurrenceDate,
  kstDate,
  type Occurrence,
  originalOccurrence,
  type Repeat,
  type SeriesRule,
  withinShiftLimit,
} from './recurrence.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 일정 길이 상한 (결정기록 D-15) */
export const MAX_EVENT_DAYS = 30;
/** 기간 조회 상한. 월 그리드 42일 + 여유 */
export const MAX_RANGE_DAYS = 62;

export interface EventView {
  id: number;
  groupId: number;
  /** (#311) 주소용 공개 코드 (`/events/<코드>`) */
  publicCode: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  memo: string | null;
  creator: Member;
  createdAt: Date;
  updatedAt: Date;
  /** (#187) 반복 주기. 한 번짜리는 null */
  repeat: Repeat | null;
  /** (#187) 반복 종료일 'YYYY-MM-DD'. 계속이면 null */
  repeatUntil: string | null;
  /** (#187) 회차 날짜 (KST, 원래 날짜). 한 번짜리는 null */
  occurrence: string | null;
  /** (#187) 반복이면 첫 회차 시작 */
  seriesStartsAt: Date | null;
  /** (#228) 반복 기준 날짜 'YYYY-MM-DD'. null 이면 seriesStartsAt 의 KST 날짜 (D-71) */
  repeatAnchor: string | null;
  /** (#188) 그 회차의 실제 알림 (예외 반영) */
  reminder: EventReminder;
  /** (#248) 참여자 (D-134). 반복 회차는 원본 값 */
  participants: ParticipantsView;
  /** (#343) 일정 색 (팔레트 키). null 이면 자동 = 참여자 색. 반복 회차는 원본 값 (D-215) */
  color: string | null;
  /** (#199) 장소. 없으면 null. 반복 회차는 예외 반영 (D-242) */
  place: PlaceView | null;
}

/** (#190) 응답 집계를 붙인 일정 (목록, 단건, 생성, 수정 응답) */
export interface EventWithResponses extends EventView {
  rsvp: RsvpSummary;
  reactions: ReactionSummary;
}

/** 단건 GET 응답. 웹이 "이후 모두" 확인 문구를 띄울지 정한다 (D-67). (#190) 사람별 응답은 단건에만 */
export interface EventDetailView extends EventWithResponses {
  hasLaterExceptions: boolean;
  rsvpMembers: RsvpMember[];
  reactionMembers: ReactionMember[];
}

/** (#190) 응답, 반응의 대상 회차 하나 */
export interface ResponseTarget {
  view: EventView;
  /** 'YYYY-MM-DD'. 한 번짜리는 시작 KST 날짜 */
  occurrence: string;
  /** 그 회차의 지금 참여자 (모두면 지금 팀원 전원), 가입순 */
  participants: Member[];
  /** 지금 팀원, 가입순 */
  members: Member[];
}

/** (#190) 응답이 붙는 회차 날짜. 한 번짜리는 시작 KST 날짜 (D-224) */
export function responseOccurrence(view: Pick<EventView, 'occurrence' | 'startsAt'>): string {
  return view.occurrence ?? kstDate(view.startsAt);
}

/** (#190) 사람 목록의 userId (탈퇴자 null 은 빼고) */
const idsOf = (members: readonly Member[]): number[] => members.flatMap((member) => (member.userId === null ? [] : [member.userId]));

/** (#199) 검색 결과 한 줄 (api.md 2.3 일정 검색) */
export interface SearchItem {
  event: EventView;
  group: { id: number; name: string; publicCode: string };
  matched: MatchedField[];
  /** 끝이 지금보다 뒤면 true */
  upcoming: boolean;
}

export interface SearchResult {
  items: SearchItem[];
  /** limit 를 넘는 결과가 더 있으면 true. 페이지 넘김 대신 "검색어를 더 구체적으로" (D-245) */
  hasMore: boolean;
}

/** 반복 일정 수정/삭제 범위 쿼리 (원문) */
export interface ScopeQuery {
  occurrence?: unknown;
  scope?: unknown;
}

type Scope = 'this' | 'following';

/** 비교와 저장에 쓰는 일정 값 */
type EventValues = Pick<EventUpdateInput, 'title' | 'startsAt' | 'endsAt' | 'allDay' | 'memo' | 'reminder' | 'place'>;

/** `endsAt > startsAt`, 길이 30일 이하. 아니면 EVENT_RANGE_INVALID */
export function assertEventRange(startsAt: Date, endsAt: Date): void {
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new ApiException('EVENT_RANGE_INVALID', '종료 시각은 시작 시각보다 뒤여야 해요');
  }
  if (endsAt.getTime() - startsAt.getTime() > MAX_EVENT_DAYS * DAY_MS) {
    throw new ApiException('EVENT_RANGE_INVALID', `일정은 최대 ${MAX_EVENT_DAYS}일까지 만들 수 있어요`);
  }
}

/**
 * 반복 규칙 검증 (설계 4-1). `repeatUntil` 만 있으면 VALIDATION_FAILED,
 * 길이 >= 주기 또는 `repeatUntil` < 첫 회차 날짜면 EVENT_RANGE_INVALID
 */
export function assertRepeatRule(repeat: Repeat | null, repeatUntil: string | null, startsAt: Date, endsAt: Date): void {
  if (repeat === null) {
    if (repeatUntil !== null) {
      const message = '반복 주기 없이 종료 날짜만 정할 수 없어요';
      throw new ApiException('VALIDATION_FAILED', message, [{ field: 'repeatUntil', message }]);
    }
    return;
  }
  if (!fitsInPeriod(repeat, startsAt, endsAt)) {
    throw new ApiException('EVENT_RANGE_INVALID', '반복 간격보다 긴 일정은 반복할 수 없어요');
  }
  if (repeatUntil !== null && repeatUntil < kstDate(startsAt)) {
    throw new ApiException('EVENT_RANGE_INVALID', '종료 날짜는 시작 날짜 뒤여야 해요');
  }
}

/**
 * "이후 모두" 에서 본문에 repeatUntil 이 없을 때 이어받는 종료 날짜 (QA3-L1).
 * 사용자가 종료를 건드리지 않았는데 회차를 종료 날짜 뒤로 옮겼으면, 옮긴 회차가 남도록 종료를 새 시작 날짜로 늘린다
 */
export function inheritedUntil(seriesUntil: string | null, startsAt: Date): string | null {
  if (seriesUntil === null) return null;
  const startDate = kstDate(startsAt);
  return seriesUntil < startDate ? startDate : seriesUntil;
}

/** 조회 구간 검증. `to > from`, `to - from <= maxDays` */
export function parseRange(fromRaw: string, toRaw: string, maxDays: number): { from: Date; to: Date } {
  const from = parseIsoDate(fromRaw, 'from');
  const to = parseIsoDate(toRaw, 'to');
  if (to.getTime() <= from.getTime()) {
    throw new ApiException('EVENT_RANGE_INVALID', 'to 는 from 보다 뒤여야 해요');
  }
  if (to.getTime() - from.getTime() > maxDays * DAY_MS) {
    throw new ApiException('EVENT_RANGE_INVALID', `조회 범위는 최대 ${maxDays}일이에요`);
  }
  return { from, to };
}

/** 저장하려는 값이 현재 값과 모두 같은지. 시각은 같은 순간이면 같다 (`+09:00` 표기 차이 무시). 알림 포함 (#188) */
export function isUnchanged(current: EventValues, next: EventValues): boolean {
  return (
    current.title === next.title &&
    current.startsAt.getTime() === next.startsAt.getTime() &&
    current.endsAt.getTime() === next.endsAt.getTime() &&
    current.allDay === next.allDay &&
    current.memo === next.memo &&
    current.reminder === next.reminder &&
    samePlace(current.place, next.place)
  );
}

/** (#188) 알림 시각을 정하는 회차 값(시작, 끝, 종일, 알림)이 바뀌었는지 (D-86) */
export function reminderTimingChanged(current: EventValues, next: EventValues): boolean {
  return (
    current.startsAt.getTime() !== next.startsAt.getTime() ||
    current.endsAt.getTime() !== next.endsAt.getTime() ||
    current.allDay !== next.allDay ||
    current.reminder !== next.reminder
  );
}

/**
 * (#188) 저장할 알림 (설계 4-1, D-84). 본문 값이 종일 여부와 안 맞으면 VALIDATION_FAILED,
 * 본문에 없는데 종일이 바뀌어 지금 값이 안 맞게 되면 NONE
 */
export function resolveReminder(input: EventReminder | null | undefined, current: EventReminder, allDay: boolean): EventReminder {
  if (input !== undefined && input !== null) {
    if (!reminderFits(allDay, input)) throw validationFailed('reminder', reminderMismatchMessage(allDay));
    return input;
  }
  return reminderFits(allDay, current) ? current : 'NONE';
}

/** (#188) 한 번짜리만 알림 시각을 저장한다. 반복 원본은 null (D-85) */
function storedRemindAt(values: EventValues, repeat: Repeat | null | undefined): Date | null {
  return repeat ? null : remindAt(values.startsAt, values.allDay, values.reminder);
}

/** 회차 값 비교. 메모는 null 과 '' 를 같은 "메모 없음" 으로 본다 (예외의 메모 지움은 '', D-65) */
function sameOccurrenceValues(a: EventValues, b: EventValues): boolean {
  return isUnchanged({ ...a, memo: a.memo ?? '' }, { ...b, memo: b.memo ?? '' });
}

/** 한 번짜리 일정, 또는 반복 원본의 첫 회차(예외 없음)로 본 응답 */
export function toEventView(row: EventRow, resolver: MemberResolver): EventView {
  return {
    id: row.id,
    groupId: row.groupId,
    publicCode: row.publicCode,
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    memo: row.memo,
    creator: resolver.resolve(row.creatorId, row.creator),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    repeat: row.repeat ?? null,
    repeatUntil: row.repeatUntil ?? null,
    occurrence: row.repeat ? kstDate(row.startsAt) : null,
    seriesStartsAt: row.repeat ? row.startsAt : null,
    repeatAnchor: row.repeat ? row.repeatAnchor : null,
    reminder: row.reminder,
    participants: toParticipantsView(row, resolver),
    color: row.color,
    place: toPlaceView(row.place),
  };
}

/** (#248) 저장된 참여자 */
export function participantsOf(row: Pick<EventRow, 'allMembers' | 'participantIds'>): ParticipantSet {
  return { allMembers: row.allMembers, ids: row.allMembers ? [] : row.participantIds };
}

/** 반복 원본의 회차 하나로 본 응답. 예외로 바꾼 제목/메모가 있으면 그 값 */
export function toOccurrenceView(row: EventRow, occurrence: Occurrence, resolver: MemberResolver): EventView {
  return {
    ...toEventView(row, resolver),
    title: occurrence.title ?? row.title,
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
    allDay: occurrence.allDay,
    memo: occurrence.memo ?? row.memo,
    occurrence: occurrence.occurrence,
    reminder: occurrence.reminder ?? row.reminder,
    place: toPlaceView(occurrence.place ?? row.place),
  };
}

/** startsAt 오름차순, 같으면 id, 그다음 회차 날짜 */
function sortViews(views: EventView[]): EventView[] {
  return views.sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id || (a.occurrence ?? '').localeCompare(b.occurrence ?? ''),
  );
}

function seriesRule(row: EventRow): SeriesRule {
  return {
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    repeat: row.repeat as Repeat,
    repeatUntil: row.repeatUntil,
    repeatAnchor: row.repeatAnchor,
  };
}

/**
 * "이후 모두" 로 저장할 반복 기준 날짜 (D-71). 반복 주기가 그대로인 매월/매년이고 날짜를 바꾸지 않았으면 기준을 잇는다.
 * 첫 회차(원본 수정)는 원본 값 그대로, 그 뒤 회차(새 원본)는 원본 기준 또는 원본 시작 날짜. 날짜나 주기를 바꾸면 null (새 시작이 기준)
 */
export function followingAnchor(series: EventRow, repeat: Repeat | null, dateChanged: boolean, isFirst: boolean): string | null {
  if (repeat !== series.repeat || dateChanged || (repeat !== 'MONTHLY' && repeat !== 'YEARLY')) return null;
  return isFirst ? series.repeatAnchor : (series.repeatAnchor ?? kstDate(series.startsAt));
}

/** 회차의 현재 값 (예외 반영) */
function occurrenceValues(row: EventRow, occurrence: Occurrence): EventValues {
  return {
    title: occurrence.title ?? row.title,
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
    allDay: occurrence.allDay,
    memo: occurrence.memo ?? row.memo,
    reminder: occurrence.reminder ?? row.reminder,
    // (#199) 이 회차만 지운 장소(이름 '')는 null
    place: occurrence.place ? (occurrence.place.name === '' ? null : occurrence.place) : row.place,
  };
}

/** 부분 변경을 기준 값과 합친다. 시각 형식 오류는 VALIDATION_FAILED. 알림은 합친 종일 여부로 검사 (#188) */
function mergeValues(base: EventValues, dto: EventPatchDto): EventValues {
  const allDay = dto.allDay ?? base.allDay;
  return {
    title: dto.title ?? base.title,
    startsAt: dto.startsAt !== undefined ? parseIsoDate(dto.startsAt, 'startsAt') : base.startsAt,
    endsAt: dto.endsAt !== undefined ? parseIsoDate(dto.endsAt, 'endsAt') : base.endsAt,
    allDay,
    // 빈 메모('')는 메모 지우기 = null. 회차 예외에서는 아래에서 '' 로 다시 바꿔 저장한다 (D-65)
    memo: dto.memo !== undefined ? (dto.memo === '' ? null : dto.memo) : base.memo,
    reminder: resolveReminder(dto.reminder, base.reminder, allDay),
    // (#199) 생략은 그대로, null 은 지우기 (D-242)
    place: dto.place !== undefined ? (parsePlace(dto.place) ?? null) : base.place,
  };
}

/** (#343) 색만 이 일정만 범위로 바꾸려 할 때 (참여자와 같은 규칙, D-215) */
export const COLOR_THIS_SCOPE_MESSAGE = '반복 일정의 색은 이후 모두로만 바꿀 수 있어요';

/**
 * (#343) 본문의 색 → 저장할 값. undefined 는 그대로(생략), null 은 자동. DTO 가 팔레트 키만 통과시키므로 대문자로만 맞춘다 (D-215)
 */
export function colorInput(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined || raw === null) return raw;
  return paletteColorOf(raw) ?? raw;
}

function validationFailed(field: string, message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', message, [{ field, message }]);
}

/** `occurrence` 쿼리. 'YYYY-MM-DD' 실제 날짜가 아니면 VALIDATION_FAILED */
function parseOccurrence(raw: unknown): string {
  if (typeof raw !== 'string' || !isCalendarDate(raw)) {
    throw validationFailed('occurrence', 'occurrence 는 YYYY-MM-DD 형식의 실제 날짜여야 해요');
  }
  return raw;
}

/** 반복 일정 수정/삭제 쿼리 (설계 4장). 없거나 틀리면 VALIDATION_FAILED */
function parseScopeQuery(query: ScopeQuery): { scope: Scope; occurrence: string } {
  if (query.scope !== 'this' && query.scope !== 'following') {
    throw validationFailed('scope', '반복 일정은 scope 를 this 또는 following 으로 골라야 해요');
  }
  return { scope: query.scope, occurrence: parseOccurrence(query.occurrence) };
}

const NOT_FOUND = () => new ApiException('NOT_FOUND', '일정을 찾을 수 없어요');

/** (#190) 목록 집계용: (eventId, 회차) 키로 묶는다 */
function groupBy<T extends { eventId: number; occurrence: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = occurrenceKey(row.eventId, row.occurrence);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly events: EventsRepository,
    private readonly memberships: MembershipService,
    private readonly responses: EventResponsesRepository,
  ) {}

  /**
   * (#190) 일정들에 응답 집계를 붙인다. 목록 창의 회차 날짜 범위로 응답, 반응을 한 번씩 읽는다 (D-224)
   */
  private async withSummaries(views: EventView[], userId: number, resolver: MemberResolver): Promise<EventWithResponses[]> {
    if (views.length === 0) return [];
    const keys = views.map(responseOccurrence);
    const sorted = [...keys].sort();
    const { rsvps, reactions } = await this.responses.listForEvents([...new Set(views.map((view) => view.id))], sorted[0], sorted[sorted.length - 1]);
    const rsvpBy = groupBy(rsvps);
    const reactionBy = groupBy(reactions);
    const memberIds = idsOf(resolver.all());
    return views.map((view, index) => {
      const key = occurrenceKey(view.id, keys[index]);
      return {
        ...view,
        rsvp: summarizeRsvp(idsOf(view.participants.members), rsvpBy.get(key) ?? [], userId),
        reactions: summarizeReactions(memberIds, reactionBy.get(key) ?? [], userId),
      };
    });
  }

  private async withSummary(view: EventView, userId: number, resolver: MemberResolver): Promise<EventWithResponses> {
    const [decorated] = await this.withSummaries([view], userId, resolver);
    return decorated;
  }

  /**
   * (#190) 응답 대상 회차. 멤버 확인, 일정 찾기, 회차 확인(반복은 occurrence 필수, 규칙상 회차가 아니거나 취소된 회차면 404)은 단건 GET 과 같다
   */
  async resolveTarget(userId: number, groupId: number, eventId: number, occurrenceRaw: unknown): Promise<ResponseTarget> {
    await this.memberships.assertMember(userId, groupId);
    const row = await this.findInGroup(groupId, eventId);
    const resolver = await this.memberships.resolverFor(groupId);
    let view: EventView;
    if (!row.repeat) {
      view = toEventView(row, resolver);
    } else {
      if (occurrenceRaw === undefined || occurrenceRaw === '') throw validationFailed('occurrence', '반복 일정은 회차 날짜(occurrence)를 함께 보내야 해요');
      const date = parseOccurrence(occurrenceRaw);
      const exceptions = await this.events.listExceptions(row.id);
      view = toOccurrenceView(row, this.resolveOccurrence(row, exceptions, date), resolver);
    }
    return { view, occurrence: responseOccurrence(view), participants: view.participants.members, members: resolver.all() };
  }

  /**
   * 겹침 조건 `startsAt < to AND endsAt > from`. 반복 원본은 기간 안 회차로 펼친다 (#187).
   * startsAt 오름차순, 같으면 id, 그다음 회차 날짜
   */
  async list(userId: number, groupId: number, fromRaw: string, toRaw: string): Promise<EventWithResponses[]> {
    await this.memberships.assertMember(userId, groupId);
    const { from, to } = parseRange(fromRaw, toRaw, MAX_RANGE_DAYS);
    const [rows, series] = await Promise.all([this.events.listInRange(groupId, from, to), this.events.listSeriesForRange(groupId, from, to)]);
    const resolver = await this.memberships.resolverFor(groupId);
    const views = rows.map((row) => toEventView(row, resolver));
    for (const row of series) {
      for (const occurrence of expand(seriesRule(row), row.exceptions, from, to)) views.push(toOccurrenceView(row, occurrence, resolver));
    }
    // (#190) 집계만 붙인다. 사람 목록은 단건에만 (목록 응답이 커지지 않게)
    return this.withSummaries(sortViews(views), userId, resolver);
  }

  /**
   * (#193) 구독 피드용 기간 조회. 멤버십은 호출자(피드 서비스)가 이미 확인했고, 기간 상한(62일) 없이 피드 창(461일)을 그대로 쓴다.
   * 펼치기, 예외, 응답 모양은 list 와 같다
   */
  async listForFeed(groupId: number, from: Date, to: Date): Promise<EventView[]> {
    const [rows, series] = await Promise.all([this.events.listInRange(groupId, from, to), this.events.listSeriesForRange(groupId, from, to)]);
    const resolver = await this.memberships.resolverFor(groupId);
    const views = rows.map((row) => toEventView(row, resolver));
    for (const row of series) {
      for (const occurrence of expand(seriesRule(row), row.exceptions, from, to)) views.push(toOccurrenceView(row, occurrence, resolver));
    }
    return sortViews(views);
  }

  /**
   * (#199) 일정 검색 `GET /events/search?q=&groupId=&limit=` (D-245, D-246). 권한은 첫 단계에서 내 팀 목록으로만 정한다.
   * 한 번짜리는 그대로, 반복은 원본이 맞으면 한 줄(다음 회차, 없으면 마지막 회차), "이 일정만" 예외가 맞으면 그 회차를 따로 한 줄.
   * 취소된 회차는 빠진다. 다가오는 일정 먼저(시작 오름차순), 그다음 지난 일정(시작 내림차순)
   */
  async search(userId: number, raw: { q?: unknown; groupId?: unknown; limit?: unknown }, now: Date = new Date()): Promise<SearchResult> {
    const query = parseSearchQuery(raw);
    const groups = await this.memberships.listGroupsOf(userId);
    const scoped = query.groupId === null ? groups : groups.filter((group) => group.id === query.groupId);
    if (query.groupId !== null && scoped.length === 0) throw new ApiException('FORBIDDEN');
    const groupIds = scoped.map((group) => group.id);
    const pattern = likePattern(query.q);
    const [once, found] = await Promise.all([
      this.events.searchOnce(groupIds, pattern, now, query.limit + 1),
      this.events.searchSeries(groupIds, pattern, SEARCH_SERIES_CAP),
    ]);

    const resolvers = new Map<number, MemberResolver>();
    const resolverOf = async (groupId: number) => {
      let resolver = resolvers.get(groupId);
      if (!resolver) {
        resolver = await this.memberships.resolverFor(groupId);
        resolvers.set(groupId, resolver);
      }
      return resolver;
    };
    const candidates: { view: EventView; matched: MatchedField[] }[] = [];
    const push = (view: EventView, values: Pick<EventValues, 'title' | 'memo' | 'place'>) =>
      candidates.push({ view, matched: matchedFields(values, query.q) });

    for (const row of [...once.upcoming, ...once.past]) push(toEventView(row, await resolverOf(row.groupId)), row);

    const matchedIds = new Set(found.matchedIds);
    for (const series of found.series) {
      const resolver = await resolverOf(series.groupId);
      const rule = seriesRule(series);
      const hitDates = new Set(found.exceptionHits.filter((hit) => hit.eventId === series.id).map((hit) => hit.occurrence));
      for (const date of hitDates) {
        if (!isOccurrenceDate(rule, date)) continue;
        const occurrence = applyException(originalOccurrence(rule, date), series.exceptions.find((exception) => exception.occurrence === date));
        if (occurrence) push(toOccurrenceView(series, occurrence, resolver), occurrenceValues(series, occurrence));
      }
      if (!matchedIds.has(series.id)) continue;
      const occurrence = representativeOccurrence(rule, series.exceptions, now, hitDates);
      if (occurrence) push(toOccurrenceView(series, occurrence, resolver), series);
    }

    const nameOf = new Map(scoped.map((group) => [group.id, group]));
    const items = candidates
      .map(({ view, matched }) => ({ view, matched, upcoming: view.endsAt.getTime() > now.getTime() }))
      .sort((a, b) => compareSearchItems({ ...a, startsAt: a.view.startsAt, id: a.view.id, occurrence: a.view.occurrence }, { ...b, startsAt: b.view.startsAt, id: b.view.id, occurrence: b.view.occurrence }));
    return {
      items: items.slice(0, query.limit).map(({ view, matched, upcoming }) => ({
        event: view,
        group: nameOf.get(view.groupId) as SearchItem['group'],
        matched,
        upcoming,
      })),
      hasMore: items.length > query.limit,
    };
  }

  /** 반복이면 `occurrence` 회차 (없으면 첫 회차). 한 번짜리는 `occurrence` 를 무시한다. (#190) 응답 집계와 사람별 응답을 붙인다 */
  async get(userId: number, groupId: number, eventId: number, occurrenceRaw?: unknown): Promise<EventDetailView> {
    await this.memberships.assertMember(userId, groupId);
    const row = await this.findInGroup(groupId, eventId);
    const resolver = await this.memberships.resolverFor(groupId);
    let view: EventView;
    let hasLaterExceptions = false;
    if (!row.repeat) {
      view = toEventView(row, resolver);
    } else {
      const date = occurrenceRaw === undefined || occurrenceRaw === '' ? kstDate(row.startsAt) : parseOccurrence(occurrenceRaw);
      const exceptions = await this.events.listExceptions(row.id);
      view = toOccurrenceView(row, this.resolveOccurrence(row, exceptions, date), resolver);
      hasLaterExceptions = exceptions.some((exception) => exception.occurrence > date);
    }
    const { rsvps, reactions } = await this.responses.listForOccurrence(view.id, responseOccurrence(view));
    const members = resolver.all();
    return {
      ...view,
      rsvp: summarizeRsvp(idsOf(view.participants.members), rsvps, userId),
      reactions: summarizeReactions(idsOf(members), reactions, userId),
      hasLaterExceptions,
      rsvpMembers: rsvpMembers(view.participants.members, rsvps, view.startsAt, view.endsAt),
      reactionMembers: reactionMembers(members, reactions),
    };
  }

  /**
   * (#311) 공개 코드로 일정 하나 (`GET /events/:code`). 웹의 `/events/<코드>` 페이지가 팀과 날짜를 알아내는 데 쓴다.
   * 코드가 틀리거나 없거나 그 팀 멤버가 아니면 모두 같은 NOT_FOUND (코드의 존재를 드러내지 않는다, D-197)
   */
  async getByCode(userId: number, codeRaw: unknown, occurrenceRaw?: unknown): Promise<EventDetailView> {
    const code = parsePublicCode(codeRaw);
    const row = code === null ? null : await this.events.findByPublicCode(code);
    if (!row || !(await this.memberships.isMember(userId, row.groupId))) throw NOT_FOUND();
    return this.get(userId, row.groupId, row.id, occurrenceRaw);
  }

  async create(userId: number, groupId: number, dto: EventInputDto): Promise<EventWithResponses> {
    await this.memberships.assertMember(userId, groupId);
    const startsAt = parseIsoDate(dto.startsAt, 'startsAt');
    const endsAt = parseIsoDate(dto.endsAt, 'endsAt');
    assertEventRange(startsAt, endsAt);
    const repeat = dto.repeat ?? null;
    const repeatUntil = dto.repeatUntil ?? null;
    assertRepeatRule(repeat, repeatUntil, startsAt, endsAt);
    const reminder = resolveReminder(dto.reminder, 'NONE', dto.allDay);
    // (#248) 생략하면 [요청자] (D-131, D-133). 멤버 검사는 저장 트랜잭션 안에서
    const participants = resolveParticipants(parseParticipants(dto.participants), null, userId, true);

    const row = await this.events.createWithLogTx(
      {
        groupId,
        title: dto.title,
        startsAt,
        endsAt,
        allDay: dto.allDay,
        memo: dto.memo ?? null,
        creatorId: userId,
        ...(repeat ? { repeat, repeatUntil } : {}),
        reminder,
        remindAt: repeat ? null : remindAt(startsAt, dto.allDay, reminder),
        reminderSetAt: new Date(),
        participants,
        color: colorInput(dto.color) ?? null,
        place: parsePlace(dto.place) ?? null,
      },
      userId,
    );
    const resolver = await this.memberships.resolverFor(groupId);
    return this.withSummary(toEventView(row, resolver), userId, resolver);
  }

  /**
   * 부분 변경은 현재 값과 합쳐 검증한 뒤 UPDATED 로그와 함께 저장.
   * 합친 값이 현재 값과 같으면 저장도 로그도 하지 않고 현재 값을 돌려준다 (updatedAt 유지, 새 소식 없음, #62).
   * 반복 일정은 `occurrence` + `scope` 필수 (설계 4장 표). 한 번짜리는 둘 다 무시한다
   */
  async update(userId: number, groupId: number, eventId: number, dto: EventPatchDto, query: ScopeQuery = {}): Promise<EventWithResponses> {
    const view = await this.updateView(userId, groupId, eventId, dto, query);
    // (#190) 응답 집계를 붙인다 (수정 뒤에도 회차 날짜가 같으면 응답이 남는다)
    return this.withSummary(view, userId, await this.memberships.resolverFor(groupId));
  }

  private async updateView(userId: number, groupId: number, eventId: number, dto: EventPatchDto, query: ScopeQuery): Promise<EventView> {
    await this.memberships.assertMember(userId, groupId);
    const current = await this.findInGroup(groupId, eventId);
    const participants = parseParticipants(dto.participants);
    if (!current.repeat) return this.updateOnce(userId, current, dto, participants);

    const { scope, occurrence: date } = parseScopeQuery(query);
    if (scope === 'this' && (dto.repeat !== undefined || dto.repeatUntil !== undefined)) {
      const field = dto.repeat !== undefined ? 'repeat' : 'repeatUntil';
      throw validationFailed(field, '이 일정만 수정할 때는 반복을 바꿀 수 없어요');
    }
    // (#248) 참여자는 원본에만 붙는다 (기획 3-5, D-135)
    if (scope === 'this' && participants !== undefined) throw participantsFailed(PARTICIPANTS_THIS_SCOPE_MESSAGE);
    // (#343) 색도 원본 단위 (D-215)
    if (scope === 'this' && dto.color !== undefined) throw validationFailed('color', COLOR_THIS_SCOPE_MESSAGE);
    const exceptions = await this.events.listExceptions(current.id);
    const occurrence = this.resolveOccurrence(current, exceptions, date);
    return scope === 'this'
      ? this.updateThis(userId, current, occurrence, dto)
      : this.updateFollowing(userId, current, exceptions, occurrence, dto, participants);
  }

  /** 삭제 전 스냅샷으로 DELETED 로그를 남긴다. 반복 일정은 `occurrence` + `scope` 필수 (설계 4장 표) */
  async remove(userId: number, groupId: number, eventId: number, query: ScopeQuery = {}): Promise<{ ok: true }> {
    await this.memberships.assertMember(userId, groupId);
    const current = await this.findInGroup(groupId, eventId);
    if (!current.repeat) {
      await this.events.deleteWithLogTx(current, userId);
      return { ok: true };
    }

    const { scope, occurrence: date } = parseScopeQuery(query);
    const exceptions = await this.events.listExceptions(current.id);
    const occurrence = this.resolveOccurrence(current, exceptions, date);
    const snapshot: LogSnapshot = { ...occurrenceValues(current, occurrence), repeat: current.repeat };
    const log: ScopeLog = { actorId: userId, scope: scope === 'this' ? 'THIS' : 'FOLLOWING', occurrence: date };
    if (scope === 'this') {
      await this.events.cancelOccurrenceWithLogTx(current, date, log, snapshot);
    } else if (date === kstDate(current.startsAt)) {
      await this.events.deleteSeriesWithLogTx(current, log, snapshot);
    } else {
      await this.events.splitSeriesTx(current, date, log, null, snapshot);
    }
    return { ok: true };
  }

  /** 한 번짜리 일정 수정. 반복을 켜면 이 일정이 첫 회차가 된다 (기획 3-4) */
  private async updateOnce(userId: number, current: EventRow, dto: EventPatchDto, input: ParticipantsInput | undefined): Promise<EventView> {
    const next: EventUpdateInput = mergeValues(current, dto);
    assertEventRange(next.startsAt, next.endsAt);
    const repeat = dto.repeat ?? null;
    const repeatUntil = dto.repeatUntil ?? null;
    assertRepeatRule(repeat, repeatUntil, next.startsAt, next.endsAt);
    if (repeat) Object.assign(next, { repeat, repeatUntil });
    // (#248) 참여자만 바꿔도 수정이다 (D-136). 바뀐 경우만 행을 다시 쓴다. 반복을 켜도 같은 행이라 참여자는 유지
    const participants = resolveParticipants(input, participantsOf(current), userId, false);
    const participantsChanged = !sameParticipants(participantsOf(current), participants);
    if (participantsChanged) next.participants = participants;

    const color = colorInput(dto.color);
    const colorChanged = color !== undefined && color !== current.color;

    const unchanged = !repeat && !participantsChanged && isUnchanged(current, next);
    const resolver = await this.memberships.resolverFor(current.groupId);
    // (#343) 색만 바꾸면 로그, 새 소식, 푸시 없이 색만 저장 (D-215)
    if (unchanged) return toEventView(colorChanged ? await this.events.updateColor(current.id, color) : current, resolver);
    if (colorChanged) next.color = color;
    // (#188) 반복을 켜면 회차마다 틱에서 계산. 시각, 종일, 알림, 반복이 바뀌면 기준 시각을 지금으로 (D-85, D-86)
    next.remindAt = storedRemindAt(next, repeat);
    if (repeat || reminderTimingChanged(current, next)) next.reminderSetAt = new Date();
    const row = await this.events.updateWithLogTx(current, next, userId);
    return toEventView(row, resolver);
  }

  /**
   * "이 일정만" 수정 (D-65). 원래 회차와 다른 필드만 예외에 저장하고, 모두 원래 값이 되면 예외 행을 지운다.
   * 회차의 현재 값과 같으면 저장도 로그도 없다 (#62)
   */
  private async updateThis(userId: number, series: EventRow, occurrence: Occurrence, dto: EventPatchDto): Promise<EventView> {
    const current = occurrenceValues(series, occurrence);
    const next = mergeValues(current, dto);
    assertEventRange(next.startsAt, next.endsAt);
    if (!withinShiftLimit(occurrence.occurrence, next.startsAt, next.endsAt)) {
      throw new ApiException('EVENT_RANGE_INVALID', '이 회차는 앞뒤 30일 안으로만 옮길 수 있어요');
    }
    const resolver = await this.memberships.resolverFor(series.groupId);
    if (sameOccurrenceValues(current, next)) return toOccurrenceView(series, occurrence, resolver);

    const original = originalOccurrence(seriesRule(series), occurrence.occurrence);
    const fields: ExceptionFields = {
      title: next.title !== series.title ? next.title : null,
      startsAt: next.startsAt.getTime() !== original.startsAt.getTime() ? next.startsAt : null,
      endsAt: next.endsAt.getTime() !== original.endsAt.getTime() ? next.endsAt : null,
      allDay: next.allDay !== series.allDay ? next.allDay : null,
      memo: (next.memo ?? '') !== (series.memo ?? '') ? (next.memo ?? '') : null,
      // (#188) 원래 회차 값(원본 알림)과 같으면 null
      reminder: next.reminder !== series.reminder ? next.reminder : null,
      // (#199) 원본 장소와 같으면 null, 이 회차만 지우면 이름 '' (메모와 같은 규칙)
      place: samePlace(next.place, series.place) ? null : (next.place ?? CLEARED_PLACE),
    };
    const isEmpty = Object.values(fields).every((value) => value === null);
    await this.events.saveExceptionWithLogTx(
      series,
      occurrence.occurrence,
      isEmpty ? null : fields,
      { actorId: userId, scope: 'THIS', occurrence: occurrence.occurrence },
      // (#248) 로그 참여자는 원본 값 (D-136)
      { ...next, repeat: series.repeat, participants: participantsOf(series) },
      reminderTimingChanged(current, next) ? new Date() : null,
    );
    const saved = applyException(original, { occurrence: occurrence.occurrence, cancelled: false, ...fields }) as Occurrence;
    return toOccurrenceView(series, saved, resolver);
  }

  /**
   * "이후 모두" 수정 (D-66, D-67, D-71). 기준 값은 그 회차의 **규칙 자리**(예외 적용 전 원래 회차, 말일 보정 그대로) + 본문.
   * 옮긴 회차("이 일정만")에서 골라도 본문에 시각이 없으면 원래 요일, 날짜에서 잇는다 (QA3-M3).
   * 첫 회차면 원본을 수정하고 예외를 모두 지운다. 그 뒤 회차면 원본을 전날에서 끊고 새 원본(원본 등록자)을 만든다
   */
  private async updateFollowing(
    userId: number,
    series: EventRow,
    exceptions: EventExceptionRow[],
    occurrence: Occurrence,
    dto: EventPatchDto,
    input: ParticipantsInput | undefined,
  ): Promise<EventView> {
    const slot = originalOccurrence(seriesRule(series), occurrence.occurrence);
    const original = occurrenceValues(series, slot);
    const next = mergeValues(original, dto);
    assertEventRange(next.startsAt, next.endsAt);
    const repeat = dto.repeat !== undefined ? dto.repeat : series.repeat;
    const repeatUntil = dto.repeatUntil !== undefined ? dto.repeatUntil : repeat ? inheritedUntil(series.repeatUntil, next.startsAt) : null;
    assertRepeatRule(repeat, repeatUntil, next.startsAt, next.endsAt);
    const isFirst = occurrence.occurrence === kstDate(series.startsAt);
    const repeatAnchor = followingAnchor(series, repeat, kstDate(next.startsAt) !== occurrence.occurrence, isFirst);
    if (repeat && !anchorMatchesStart(repeat, next.startsAt, repeatAnchor)) {
      throw new ApiException('EVENT_RANGE_INVALID', '반복 기준 날짜와 시작 날짜가 맞지 않아요');
    }
    // 기준 날짜는 비교하지 않는다. 그 뒤 회차에서 잇는 기준은 원본과 같은 규칙이다
    const sameRule = repeat === series.repeat && repeatUntil === series.repeatUntil;
    // (#248) 본문에 없으면 원본 참여자 (첫 회차는 그대로, 그 뒤 회차는 새 원본에 복사, D-135)
    const participants = resolveParticipants(input, participantsOf(series), userId, false);
    const sameMembers = sameParticipants(participantsOf(series), participants);
    // (#343) 본문에 없으면 원본 색 (새 원본에 복사)
    const inputColor = colorInput(dto.color);
    const color = inputColor === undefined ? series.color : inputColor;
    const colorChanged = color !== series.color;
    const log: ScopeLog = { actorId: userId, scope: 'FOLLOWING', occurrence: occurrence.occurrence };
    const resolver = await this.memberships.resolverFor(series.groupId);

    if (isFirst) {
      if (sameRule && sameMembers && exceptions.length === 0 && isUnchanged(series, next)) {
        // (#343) 색만 바꾸면 원본 색만 저장. 로그, 새 소식, 푸시 없음 (D-215)
        if (!colorChanged) return toOccurrenceView(series, occurrence, resolver);
        const row = await this.events.updateColor(series.id, color);
        return toOccurrenceView(row, occurrence, resolver);
      }
      // (#188) 예외를 모두 지우면 옮긴 회차의 시각도 바뀌므로 반복 규칙, 예외 유무까지 기준 시각 대상 (D-86)
      const timing = !sameRule || exceptions.length > 0 || reminderTimingChanged(series, next);
      const row = await this.events.updateSeriesFromStartTx(
        series,
        {
          ...next,
          repeat,
          repeatUntil,
          repeatAnchor,
          remindAt: storedRemindAt(next, repeat),
          ...(timing ? { reminderSetAt: new Date() } : {}),
          ...(sameMembers ? {} : { participants }),
          ...(colorChanged ? { color } : {}),
        },
        log,
      );
      return toEventView(row, resolver);
    }

    // 원래 회차 값과 같고 이 회차부터 예외가 없으면 나눠도 펼친 결과가 같다 (#62)
    const hasFollowingExceptions = exceptions.some((exception) => exception.occurrence >= occurrence.occurrence);
    const onlyColor = sameRule && sameMembers && !hasFollowingExceptions && isUnchanged(original, next);
    if (onlyColor && !colorChanged) return toOccurrenceView(series, occurrence, resolver);

    const created: EventCreateInput = {
      groupId: series.groupId,
      ...next,
      creatorId: series.creatorId,
      repeat,
      repeatUntil,
      repeatAnchor,
      // (#188) 새 원본은 기준 시각이 지금 (D-86)
      remindAt: storedRemindAt(next, repeat),
      reminderSetAt: new Date(),
      participants,
      color,
    };
    // (#343) 색만 바꾸면 나누되 로그, 새 소식, 푸시 없음 (D-215)
    const row = onlyColor
      ? await this.events.splitSeriesQuietTx(series, occurrence.occurrence, created)
      : await this.events.splitSeriesTx(series, occurrence.occurrence, log, created);
    return toEventView(row, resolver);
  }

  /** 규칙상 회차 날짜가 아니거나 repeatUntil 뒤, 또는 취소된 회차면 NOT_FOUND */
  private resolveOccurrence(row: EventRow, exceptions: EventExceptionRow[], date: string): Occurrence {
    const rule = seriesRule(row);
    if (!isOccurrenceDate(rule, date)) throw NOT_FOUND();
    const occurrence = applyException(
      originalOccurrence(rule, date),
      exceptions.find((exception) => exception.occurrence === date),
    );
    if (!occurrence) throw NOT_FOUND();
    return occurrence;
  }

  /** 다른 팀 자원을 가리키는 ID 도 NOT_FOUND */
  private async findInGroup(groupId: number, eventId: number): Promise<EventRow> {
    const row = await this.events.findInGroup(groupId, eventId);
    if (!row) throw NOT_FOUND();
    return row;
  }
}
