import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { Member, MemberResolver } from '../common/member.js';
import { isCalendarDate, parseIsoDate } from '../common/validation.js';
import { MembershipService } from '../groups/membership.service.js';
import type { EventInputDto, EventPatchDto } from './dto/event.dto.js';
import {
  EventCreateInput,
  EventExceptionRow,
  EventRow,
  EventsRepository,
  type EventUpdateInput,
  type ExceptionFields,
  type LogSnapshot,
  type ScopeLog,
} from './events.repository.js';
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
}

/** 단건 GET 응답. 웹이 "이후 모두" 확인 문구를 띄울지 정한다 (D-67) */
export interface EventDetailView extends EventView {
  hasLaterExceptions: boolean;
}

/** 반복 일정 수정/삭제 범위 쿼리 (원문) */
export interface ScopeQuery {
  occurrence?: unknown;
  scope?: unknown;
}

type Scope = 'this' | 'following';

/** 비교와 저장에 쓰는 일정 값 */
type EventValues = Pick<EventUpdateInput, 'title' | 'startsAt' | 'endsAt' | 'allDay' | 'memo'>;

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

/** 저장하려는 값이 현재 값과 모두 같은지. 시각은 같은 순간이면 같다 (`+09:00` 표기 차이 무시) */
export function isUnchanged(current: EventUpdateInput, next: EventUpdateInput): boolean {
  return (
    current.title === next.title &&
    current.startsAt.getTime() === next.startsAt.getTime() &&
    current.endsAt.getTime() === next.endsAt.getTime() &&
    current.allDay === next.allDay &&
    current.memo === next.memo
  );
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
  };
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
  };
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
  };
}

/** 부분 변경을 기준 값과 합친다. 시각 형식 오류는 VALIDATION_FAILED */
function mergeValues(base: EventValues, dto: EventPatchDto): EventValues {
  return {
    title: dto.title ?? base.title,
    startsAt: dto.startsAt !== undefined ? parseIsoDate(dto.startsAt, 'startsAt') : base.startsAt,
    endsAt: dto.endsAt !== undefined ? parseIsoDate(dto.endsAt, 'endsAt') : base.endsAt,
    allDay: dto.allDay ?? base.allDay,
    // 빈 메모('')는 메모 지우기 = null. 회차 예외에서는 아래에서 '' 로 다시 바꿔 저장한다 (D-65)
    memo: dto.memo !== undefined ? (dto.memo === '' ? null : dto.memo) : base.memo,
  };
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

@Injectable()
export class EventsService {
  constructor(
    private readonly events: EventsRepository,
    private readonly memberships: MembershipService,
  ) {}

  /**
   * 겹침 조건 `startsAt < to AND endsAt > from`. 반복 원본은 기간 안 회차로 펼친다 (#187).
   * startsAt 오름차순, 같으면 id, 그다음 회차 날짜
   */
  async list(userId: number, groupId: number, fromRaw: string, toRaw: string): Promise<EventView[]> {
    await this.memberships.assertMember(userId, groupId);
    const { from, to } = parseRange(fromRaw, toRaw, MAX_RANGE_DAYS);
    const [rows, series] = await Promise.all([this.events.listInRange(groupId, from, to), this.events.listSeriesForRange(groupId, from, to)]);
    const resolver = await this.memberships.resolverFor(groupId);
    const views = rows.map((row) => toEventView(row, resolver));
    for (const row of series) {
      for (const occurrence of expand(seriesRule(row), row.exceptions, from, to)) views.push(toOccurrenceView(row, occurrence, resolver));
    }
    return views.sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id || (a.occurrence ?? '').localeCompare(b.occurrence ?? ''),
    );
  }

  /** 반복이면 `occurrence` 회차 (없으면 첫 회차). 한 번짜리는 `occurrence` 를 무시한다 */
  async get(userId: number, groupId: number, eventId: number, occurrenceRaw?: unknown): Promise<EventDetailView> {
    await this.memberships.assertMember(userId, groupId);
    const row = await this.findInGroup(groupId, eventId);
    const resolver = await this.memberships.resolverFor(groupId);
    if (!row.repeat) return { ...toEventView(row, resolver), hasLaterExceptions: false };

    const date = occurrenceRaw === undefined || occurrenceRaw === '' ? kstDate(row.startsAt) : parseOccurrence(occurrenceRaw);
    const exceptions = await this.events.listExceptions(row.id);
    const occurrence = this.resolveOccurrence(row, exceptions, date);
    return {
      ...toOccurrenceView(row, occurrence, resolver),
      hasLaterExceptions: exceptions.some((exception) => exception.occurrence > date),
    };
  }

  async create(userId: number, groupId: number, dto: EventInputDto): Promise<EventView> {
    await this.memberships.assertMember(userId, groupId);
    const startsAt = parseIsoDate(dto.startsAt, 'startsAt');
    const endsAt = parseIsoDate(dto.endsAt, 'endsAt');
    assertEventRange(startsAt, endsAt);
    const repeat = dto.repeat ?? null;
    const repeatUntil = dto.repeatUntil ?? null;
    assertRepeatRule(repeat, repeatUntil, startsAt, endsAt);

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
      },
      userId,
    );
    const resolver = await this.memberships.resolverFor(groupId);
    return toEventView(row, resolver);
  }

  /**
   * 부분 변경은 현재 값과 합쳐 검증한 뒤 UPDATED 로그와 함께 저장.
   * 합친 값이 현재 값과 같으면 저장도 로그도 하지 않고 현재 값을 돌려준다 (updatedAt 유지, 새 소식 없음, #62).
   * 반복 일정은 `occurrence` + `scope` 필수 (설계 4장 표). 한 번짜리는 둘 다 무시한다
   */
  async update(userId: number, groupId: number, eventId: number, dto: EventPatchDto, query: ScopeQuery = {}): Promise<EventView> {
    await this.memberships.assertMember(userId, groupId);
    const current = await this.findInGroup(groupId, eventId);
    if (!current.repeat) return this.updateOnce(userId, current, dto);

    const { scope, occurrence: date } = parseScopeQuery(query);
    if (scope === 'this' && (dto.repeat !== undefined || dto.repeatUntil !== undefined)) {
      const field = dto.repeat !== undefined ? 'repeat' : 'repeatUntil';
      throw validationFailed(field, '이 일정만 수정할 때는 반복을 바꿀 수 없어요');
    }
    const exceptions = await this.events.listExceptions(current.id);
    const occurrence = this.resolveOccurrence(current, exceptions, date);
    return scope === 'this'
      ? this.updateThis(userId, current, occurrence, dto)
      : this.updateFollowing(userId, current, exceptions, occurrence, dto);
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
  private async updateOnce(userId: number, current: EventRow, dto: EventPatchDto): Promise<EventView> {
    const next: EventUpdateInput = mergeValues(current, dto);
    assertEventRange(next.startsAt, next.endsAt);
    const repeat = dto.repeat ?? null;
    const repeatUntil = dto.repeatUntil ?? null;
    assertRepeatRule(repeat, repeatUntil, next.startsAt, next.endsAt);
    if (repeat) Object.assign(next, { repeat, repeatUntil });

    const unchanged = !repeat && isUnchanged(current, next);
    const row = unchanged ? current : await this.events.updateWithLogTx(current.id, next, userId);
    const resolver = await this.memberships.resolverFor(current.groupId);
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
    };
    const isEmpty = Object.values(fields).every((value) => value === null);
    await this.events.saveExceptionWithLogTx(
      series,
      occurrence.occurrence,
      isEmpty ? null : fields,
      { actorId: userId, scope: 'THIS', occurrence: occurrence.occurrence },
      { ...next, repeat: series.repeat },
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
    const log: ScopeLog = { actorId: userId, scope: 'FOLLOWING', occurrence: occurrence.occurrence };
    const resolver = await this.memberships.resolverFor(series.groupId);

    if (isFirst) {
      if (sameRule && exceptions.length === 0 && isUnchanged(series, next)) return toOccurrenceView(series, occurrence, resolver);
      const row = await this.events.updateSeriesFromStartTx(series.id, { ...next, repeat, repeatUntil, repeatAnchor }, log);
      return toEventView(row, resolver);
    }

    // 원래 회차 값과 같고 이 회차부터 예외가 없으면 나눠도 펼친 결과가 같다 (#62)
    const hasFollowingExceptions = exceptions.some((exception) => exception.occurrence >= occurrence.occurrence);
    if (sameRule && !hasFollowingExceptions && isUnchanged(original, next)) return toOccurrenceView(series, occurrence, resolver);

    const created: EventCreateInput = { groupId: series.groupId, ...next, creatorId: series.creatorId, repeat, repeatUntil, repeatAnchor };
    const row = await this.events.splitSeriesTx(series, occurrence.occurrence, log, created);
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
