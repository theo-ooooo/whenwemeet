import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { MemberResolver } from '../common/member.js';
import { parsePublicCode } from '../common/public-code.js';
import { parseIsoDate } from '../common/validation.js';
import { MembershipService } from '../groups/membership.service.js';
import { remindAt } from '../push/remind-at.js';
import { EventResponsesRepository } from '../event-responses/event-responses.repository.js';
import { reactionMembers, rsvpMembers, occurrenceKey, summarizeReactions, summarizeRsvp } from '../event-responses/responses.js';
import type { EventInputDto, EventPatchDto } from './dto/event.dto.js';
import {
  assertEventRange,
  assertRepeatRule,
  COLOR_THIS_SCOPE_MESSAGE,
  colorInput,
  type EventValues,
  isUnchanged,
  MAX_RANGE_DAYS,
  mergeValues,
  parseOccurrence,
  parseRange,
  parseScopeQuery,
  reminderTimingChanged,
  resolveReminder,
  type ScopeQuery,
  storedRemindAt,
  validationFailed,
} from './event-input.js';
import { NOT_FOUND, occurrenceValues, resolveOccurrence, seriesRule } from './event-occurrences.js';
import { EventSeriesService } from './event-series.service.js';
import {
  type EventDetailView,
  type EventView,
  type EventWithResponses,
  groupBy,
  idsOf,
  participantsOf,
  type ResponseTarget,
  responseOccurrence,
  type SearchItem,
  type SearchResult,
  sortViews,
  toEventView,
  toOccurrenceView,
} from './event-view.js';
import { EventRow, EventsRepository, type EventUpdateInput, likePattern, type LogSnapshot, type ScopeLog } from './events.repository.js';
import { type ParticipantsInput, parseParticipants, participantsFailed, PARTICIPANTS_THIS_SCOPE_MESSAGE, resolveParticipants, sameParticipants } from './participants.js';
import { compareSearchItems, type MatchedField, matchedFields, parseSearchQuery, representativeOccurrence, SEARCH_SERIES_CAP } from './event-search.js';
import { parsePlace } from './place.js';
import { applyException, expand, isOccurrenceDate, kstDate, originalOccurrence } from './recurrence.js';

@Injectable()
export class EventsService {
  constructor(
    private readonly events: EventsRepository,
    private readonly memberships: MembershipService,
    private readonly responses: EventResponsesRepository,
    private readonly series: EventSeriesService,
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
      view = toOccurrenceView(row, resolveOccurrence(row, exceptions, date), resolver);
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
      view = toOccurrenceView(row, resolveOccurrence(row, exceptions, date), resolver);
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
    // (#248) 생략하면 [요청자] (D-131, D-133). 멤버 검사는 저장 트랜잭션 안에서. (#444) 'ALL' 은 지금 멤버 id 목록 (D-263)
    const resolver = await this.memberships.resolverFor(groupId);
    const participants = resolveParticipants(parseParticipants(dto.participants), null, userId, true, resolver.userIds());

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
    const occurrence = resolveOccurrence(current, exceptions, date);
    return scope === 'this'
      ? this.series.updateThis(userId, current, occurrence, dto)
      : this.series.updateFollowing(userId, current, exceptions, occurrence, dto, participants);
  }

  /**
   * 삭제 전 스냅샷으로 DELETED 로그를 남긴다. 반복 일정은 `occurrence` + `scope` 필수 (설계 4장 표).
   * (#375) 삭제 직전 모습을 보관하고 그 번호(`deletionId`)를 돌려준다. 되돌리기는 restore (D-251)
   */
  async remove(userId: number, groupId: number, eventId: number, query: ScopeQuery = {}): Promise<{ ok: true; deletionId: number }> {
    await this.memberships.assertMember(userId, groupId);
    const current = await this.findInGroup(groupId, eventId);
    if (!current.repeat) {
      return { ok: true, deletionId: await this.events.deleteWithLogTx(current, userId) };
    }

    const { scope, occurrence: date } = parseScopeQuery(query);
    const exceptions = await this.events.listExceptions(current.id);
    const occurrence = resolveOccurrence(current, exceptions, date);
    const snapshot: LogSnapshot = { ...occurrenceValues(current, occurrence), repeat: current.repeat };
    const log: ScopeLog = { actorId: userId, scope: scope === 'this' ? 'THIS' : 'FOLLOWING', occurrence: date };
    let deletionId: number;
    if (scope === 'this') {
      deletionId = await this.events.cancelOccurrenceWithLogTx(current, date, log, snapshot);
    } else if (date === kstDate(current.startsAt)) {
      deletionId = await this.events.deleteSeriesWithLogTx(current, log, snapshot);
    } else {
      deletionId = await this.events.splitSeriesTx(current, date, log, null, snapshot);
    }
    return { ok: true, deletionId };
  }

  /**
   * (#375) 일정 삭제 되돌리기 `POST /groups/:groupId/event-deletions/:deletionId/restore` (D-251).
   * 팀원 누구나, 지운 뒤 7일 안. 없거나 다른 팀이거나 기간이 지났으면 404, 그 사이 일정이 바뀌었으면 409
   */
  async restore(userId: number, groupId: number, deletionId: number, now: Date = new Date()): Promise<{ ok: true; eventId: number; occurrence: string | null }> {
    await this.memberships.assertMember(userId, groupId);
    const result = await this.events.restoreDeletionTx(groupId, deletionId, now);
    if (result === 'NOT_FOUND') throw new ApiException('NOT_FOUND', '되돌릴 수 있는 기간이 지났어요');
    if (result === 'CONFLICT') throw new ApiException('EVENT_RESTORE_CONFLICT');
    return { ok: true, ...result };
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
    const resolver = await this.memberships.resolverFor(current.groupId);
    const participants = resolveParticipants(input, participantsOf(current), userId, false, resolver.userIds());
    const participantsChanged = !sameParticipants(participantsOf(current), participants);
    if (participantsChanged) next.participants = participants;

    const color = colorInput(dto.color);
    const colorChanged = color !== undefined && color !== current.color;

    const unchanged = !repeat && !participantsChanged && isUnchanged(current, next);
    // (#343) 색만 바꾸면 로그, 새 소식, 푸시 없이 색만 저장 (D-215)
    if (unchanged) return toEventView(colorChanged ? await this.events.updateColor(current.id, color) : current, resolver);
    if (colorChanged) next.color = color;
    // (#188) 반복을 켜면 회차마다 틱에서 계산. 시각, 종일, 알림, 반복이 바뀌면 기준 시각을 지금으로 (D-85, D-86)
    next.remindAt = storedRemindAt(next, repeat);
    if (repeat || reminderTimingChanged(current, next)) next.reminderSetAt = new Date();
    const row = await this.events.updateWithLogTx(current, next, userId);
    return toEventView(row, resolver);
  }

  /** 다른 팀 자원을 가리키는 ID 도 NOT_FOUND */
  private async findInGroup(groupId: number, eventId: number): Promise<EventRow> {
    const row = await this.events.findInGroup(groupId, eventId);
    if (!row) throw NOT_FOUND();
    return row;
  }
}
