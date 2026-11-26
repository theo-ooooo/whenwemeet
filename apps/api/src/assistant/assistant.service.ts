import { Inject, Injectable, Logger } from '@nestjs/common';
import { BirthdaysService } from '../anniversaries/birthdays.service.js';
import { AnniversariesService } from '../anniversaries/anniversaries.service.js';
import { birthdayAnniversary, birthdayTitle } from '../anniversaries/birthdays.js';
import { ApiException } from '../common/errors.js';
import { toMember } from '../common/member.js';
import { EventsService } from '../events/events.service.js';
import { MAX_RANGE_DAYS } from '../events/event-input.js';
import { addDays, dateToDay, kstDate, kstMidnight } from '../events/recurrence.js';
import { FreeSlotsService } from '../free-slots/free-slots.service.js';
import { MembershipService } from '../groups/membership.service.js';
import { GroupsRepository } from '../groups/groups.repository.js';
import { reportError } from '../monitoring/sentry.js';
import { anniversaryItemsOn, type AnniversaryLike } from '../push/anniversary-items.js';
import { UsersRepository } from '../users/users.repository.js';
import { ASSISTANT_MODEL, AssistantModelError, type AssistantModel, type ModelResult } from './assistant-model.js';
import type { AssistantDay, AssistantEvent, AssistantReply, ComposedReply, EventEditDraft, EventTarget } from './assistant.types.js';
import type { AssistantRequestDto } from './dto/assistant-request.dto.js';
import { decide } from './guard.js';
import {
  type DraftEventsArgs,
  type DraftPollArgs,
  type FindAnniversaryArgs,
  type FindFreeTimeArgs,
  type ListEventsArgs,
  type NormalizeContext,
  NormalizeProblem,
  filterByDays,
  membersOf,
  minutesOf,
  normalizeDraftEvents,
  normalizeDraftPoll,
  normalizeFindAnniversary,
  normalizeFreeTime,
  normalizeListEvents,
  matchName,
} from './normalize.js';
import { buildMessages } from './prompt.js';
import {
  anniversaryReply,
  alreadyReply,
  clarifyReply,
  DAYS_MAX,
  eventChoiceReply,
  eventDeleteReply,
  eventDraftsReply,
  eventEditReply,
  eventListReply,
  freeSlotsReply,
  greetReply,
  invalidReply,
  LIST_MAX,
  pollDraftReply,
  refusalReply,
  SLOTS_MAX,
  targetNotFoundReply,
  unsupportedReply,
} from './replies.js';
import { type FindEditArgs, type TargetArgs, editTargetArgs, firstTargets, hasChanges, matchTargets, normalizeEdit, targetKeyword, targetSearch, toTarget } from './targets.js';
import { ASSISTANT_TOOLS, type ModelUnsupportedAction, type ModelClarifyField } from './tools.js';
import { AssistantUsageRepository } from './usage.repository.js';

/** 사용자당 KST 하루 횟수 (D-269) */
export const DAILY_LIMIT = 30;
/** 같은 원인(키 인증, 잔액) Sentry 알림 간격 */
export const ALERT_INTERVAL_MS = 10 * 60 * 1000;

/** 요청 로그 한 줄 (D-275). 사용자 글, 모델 인자, 답은 남기지 않는다 */
interface LogLine {
  userId: number;
  groupId: number;
  textLength: number;
  historyTurns: number;
  tool: string | null;
  outcome: string;
  latencyMs: number;
  promptTokens: number | null;
  cachedTokens: number | null;
  completionTokens: number | null;
  model: string | null;
}

/**
 * (#450) AI 비서 볼까 (설계 AI-비서.md, D-264 ~ D-275).
 * 멤버, 동의 확인 → 하루 횟수 +1 → 모델 한 번(도구 강제) → 가드 → 인자 정규화 → 기존 서비스로 읽기만 → 서버 문구 틀.
 * 일정, 투표, 새 소식, 알림을 만들지 않는다. 대화는 저장하지 않는다
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger('Assistant');
  private readonly lastAlertAt = new Map<string, number>();

  /** 지금 시각 (테스트가 바꾼다) */
  now: () => Date = () => new Date();

  constructor(
    @Inject(ASSISTANT_MODEL) private readonly model: AssistantModel,
    private readonly usage: AssistantUsageRepository,
    private readonly users: UsersRepository,
    private readonly memberships: MembershipService,
    private readonly groups: GroupsRepository,
    private readonly events: EventsService,
    private readonly freeSlots: FreeSlotsService,
    private readonly anniversaries: AnniversariesService,
    private readonly birthdays: BirthdaysService,
  ) {}

  /** 서버에 모델이 있는가 (`GET /me` 의 assistant.available) */
  get available(): boolean {
    return this.model.kind !== 'unavailable';
  }

  /** `GET /me` 의 assistant (D-270, D-271). usedToday 는 오늘 KST 행 (없으면 0) */
  async status(userId: number): Promise<{ available: boolean; consented: boolean; dailyLimit: number; usedToday: number }> {
    const [consentAt, usedToday] = await Promise.all([this.users.findAssistantConsent(userId), this.usage.count(userId, kstDate(this.now()))]);
    return { available: this.available, consented: consentAt !== null, dailyLimit: DAILY_LIMIT, usedToday };
  }

  /** `POST /me/assistant-consent`. 멱등 (이미 했으면 처음 값) */
  async consent(userId: number): Promise<{ consentedAt: Date }> {
    return { consentedAt: await this.users.recordAssistantConsent(userId, this.now()) };
  }

  /** `POST /groups/:groupId/assistant/messages` */
  async send(userId: number, groupId: number, dto: AssistantRequestDto, signal?: AbortSignal): Promise<AssistantReply> {
    const started = Date.now();
    const history = dto.history ?? [];
    const line: LogLine = {
      userId,
      groupId,
      textLength: Array.from(dto.text).length,
      historyTurns: history.length,
      tool: null,
      outcome: 'error:INTERNAL',
      latencyMs: 0,
      promptTokens: null,
      cachedTokens: null,
      completionTokens: null,
      model: null,
    };

    // 1. 멤버 (403), 쓸 수 있는가 (503, 안 셈), 동의 (409, 안 셈)
    await this.memberships.assertMember(userId, groupId);
    if (!this.available) {
      this.log({ ...line, outcome: 'error:ASSISTANT_UNAVAILABLE', latencyMs: Date.now() - started });
      throw new ApiException('ASSISTANT_UNAVAILABLE');
    }
    if ((await this.users.findAssistantConsent(userId)) === null) throw new ApiException('ASSISTANT_CONSENT_REQUIRED');

    // 2. 하루 횟수 +1 (넘으면 429)
    const now = this.now();
    const day = kstDate(now);
    const used = await this.usage.take(userId, day, DAILY_LIMIT);
    if (used === null) {
      this.log({ ...line, outcome: 'error:ASSISTANT_DAILY_LIMIT', latencyMs: Date.now() - started });
      throw new ApiException('ASSISTANT_DAILY_LIMIT', undefined, { limit: DAILY_LIMIT, resetAt: kstMidnight(addDays(day, 1)).toISOString() });
    }

    try {
      const [rows, group] = await Promise.all([this.memberships.listMembers(groupId), this.groups.findType(groupId)]);
      const context: NormalizeContext = {
        now,
        userId,
        personal: group?.type === 'PERSONAL',
        // (#458) 이름, "모두" 확인용 사용자 글 (이번 글 + 기록의 사용자 글, D-277)
        spoken: [...history.filter((turn) => turn.role === 'user').map((turn) => turn.text), dto.text].join('\n'),
        // (#459) 이번 글만 (기간 길이, 전원 말, D-278)
        text: dto.text,
        members: rows.map((row) => {
          const { joinedAt: _joinedAt, ...member } = toMember(row);
          return { userId: row.userId, displayName: member.displayName, nickname: row.user.nickname, member };
        }),
      };

      // 3~4. 모델 한 번
      const messages = buildMessages(
        { now, personalTeam: context.personal, members: context.members.map((member) => ({ displayName: member.displayName, me: member.userId === userId })) },
        history,
        dto.text,
      );
      const result = await this.callModel(messages, signal, line);

      // 5~6. 가드 → 정규화 → 읽기 → 문구 틀
      const outcome = decide(result);
      line.tool = result.toolCalls[0]?.name ?? null;
      const composed = await this.execute(outcome, userId, groupId, context);
      line.outcome = composed.outcome;
      this.log({ ...line, latencyMs: Date.now() - started });
      return { ...composed.reply, usage: { used, limit: DAILY_LIMIT } };
    } catch (error) {
      // 우리 쪽 실패로 답을 못 줬으면 되돌린다. 사용자가 끊은 요청은 되돌리지 않는다 (7-2)
      const aborted = error instanceof AssistantModelError && error.kind === 'aborted';
      if (!aborted) await this.usage.refund(userId, day).catch(() => undefined);
      const api = this.toApiError(error);
      this.log({ ...line, outcome: aborted ? 'error:aborted' : `error:${api.code}`, latencyMs: Date.now() - started });
      throw api;
    }
  }

  private async callModel(messages: Parameters<AssistantModel['complete']>[0], signal: AbortSignal | undefined, line: LogLine): Promise<ModelResult> {
    try {
      const result = await this.model.complete(messages, ASSISTANT_TOOLS, signal);
      line.model = result.model;
      line.promptTokens = result.usage?.promptTokens ?? null;
      line.cachedTokens = result.usage?.cachedTokens ?? null;
      line.completionTokens = result.usage?.completionTokens ?? null;
      return result;
    } catch (error) {
      if (error instanceof AssistantModelError && error.alert) this.alert(error);
      throw error;
    }
  }

  /** 키 인증 실패, 잔액 부족은 계정 주인이 알아야 한다. error 로그 + Sentry, 같은 원인은 10분에 한 번 (D-271) */
  private alert(error: AssistantModelError): void {
    const cause = error.alert as string;
    this.logger.error(`OpenAI ${cause === 'quota' ? '잔액, 한도 부족' : '키 인증 실패'} (HTTP ${error.httpStatus ?? '-'})`);
    const now = Date.now();
    const last = this.lastAlertAt.get(cause);
    if (last !== undefined && now - last < ALERT_INTERVAL_MS) return;
    this.lastAlertAt.set(cause, now);
    reportError(error, `assistant:${cause}`);
  }

  private toApiError(error: unknown): ApiException {
    if (error instanceof AssistantModelError) return new ApiException(error.kind === 'unavailable' ? 'ASSISTANT_UNAVAILABLE' : 'ASSISTANT_TIMEOUT');
    if (error instanceof ApiException) return error;
    this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return new ApiException('INTERNAL');
  }

  private log(line: LogLine): void {
    this.logger.log(`assistant ${JSON.stringify(line)}`);
  }

  /** 가드 결과 → 답. 정규화 문제는 되묻기, 형식 실패, 못 하는 일로 바꾼다 */
  private async execute(
    outcome: ReturnType<typeof decide>,
    userId: number,
    groupId: number,
    context: NormalizeContext,
  ): Promise<{ reply: ComposedReply; outcome: string }> {
    if (outcome.kind === 'refusal') return { reply: refusalReply(), outcome: 'refusal' };
    if (outcome.kind === 'greet') return { reply: greetReply(), outcome: 'greet' };
    if (outcome.kind === 'invalid') return { reply: invalidReply(), outcome: 'invalid' };
    try {
      const reply = await this.runTool(outcome.name, outcome.args, userId, groupId, context);
      return { reply, outcome: reply.cards.map((card) => card.type).join('+') || outcome.name };
    } catch (error) {
      if (!(error instanceof NormalizeProblem)) throw error;
      const problem = error.problem;
      if (problem.kind === 'invalid') return { reply: invalidReply(), outcome: 'invalid' };
      if (problem.kind === 'unsupported') return { reply: unsupportedReply(problem.action), outcome: `unsupported:${problem.action}` };
      return { reply: clarifyReply(problem.field, problem), outcome: `clarify:${problem.field}` };
    }
  }

  private async runTool(name: string, args: Record<string, unknown>, userId: number, groupId: number, context: NormalizeContext): Promise<ComposedReply> {
    switch (name) {
      case 'draft_event':
        return eventDraftsReply(normalizeDraftEvents(args as unknown as DraftEventsArgs, context));
      case 'find_free_time':
        return this.findFreeTime(args as unknown as FindFreeTimeArgs, context);
      case 'draft_poll': {
        const draft = normalizeDraftPoll(args as unknown as DraftPollArgs, context);
        return pollDraftReply(draft, membersOf(draft.participants, context));
      }
      case 'list_events':
        return this.listEvents(args as unknown as ListEventsArgs, userId, groupId, context);
      case 'find_anniversary':
        return this.findAnniversary(args as unknown as FindAnniversaryArgs, userId, groupId, context);
      case 'ask_clarification':
        return clarifyReply((args as { field: ModelClarifyField }).field);
      case 'find_event_to_edit':
        return this.findEventToEdit(args as unknown as FindEditArgs, userId, groupId, context);
      case 'find_event_to_delete':
        return this.findEventToDelete(args as unknown as TargetArgs, userId, groupId, context);
      case 'report_unsupported':
        return unsupportedReply((args as { action: ModelUnsupportedAction }).action);
      default:
        return invalidReply();
    }
  }

  /**
   * (#511) 고치기, 지우기 대상 후보 (D-283). 기존 일정 목록(멤버 검사, 반복 회차 펼치기 포함)을 기간으로 읽고
   * 제목 말, 지금 시각으로 거른 뒤 지금과 가까운 순. 목록 한도(62일)를 넘는 기간은 나눠 읽는다
   */
  private async findTargets(args: TargetArgs, userId: number, groupId: number, context: NormalizeContext): Promise<EventTarget[]> {
    const search = targetSearch(args, context);
    const views = await this.listWindow(userId, groupId, search.fromDate, search.toDate);
    return matchTargets(views, search, context.now).map(toTarget);
  }

  /** [fromDate, toDate] (양끝 포함 KST 날짜) 일정. 62일씩 나눠 읽고 같은 일정(회차)은 한 번만 */
  private async listWindow(userId: number, groupId: number, fromDate: string, toDate: string) {
    const seen = new Set<string>();
    const views: Awaited<ReturnType<EventsService['list']>> = [];
    for (let start = fromDate; start <= toDate; start = addDays(start, MAX_RANGE_DAYS)) {
      const end = addDays(start, MAX_RANGE_DAYS - 1) < toDate ? addDays(start, MAX_RANGE_DAYS - 1) : toDate;
      for (const view of await this.events.list(userId, groupId, kstMidnight(start).toISOString(), kstMidnight(addDays(end, 1)).toISOString())) {
        const key = `${view.id}:${view.occurrence ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        views.push(view);
      }
    }
    return views;
  }

  /**
   * (#511) 고치기: 바꿀 값이 없으면 되묻기 → 대상 찾기(0개 못 찾음) → 후보마다 고친 뒤 값 → 이미 같은 후보는 빼고 1개면 확인 카드, 여럿이면 고르기
   */
  private async findEventToEdit(raw: FindEditArgs, userId: number, groupId: number, context: NormalizeContext): Promise<ComposedReply> {
    const args = editTargetArgs(raw);
    const keyword = targetKeyword(args.title);
    if (!hasChanges(args.changes)) return clarifyReply('change', keyword ? { subject: keyword } : {});
    const targets = await this.findTargets(args, userId, groupId, context);
    if (targets.length === 0) return targetNotFoundReply(keyword);
    const drafts: EventEditDraft[] = [];
    for (const target of targets) {
      const after = normalizeEdit(target, args.changes, context);
      if (after) drafts.push({ target, after });
    }
    if (drafts.length === 0) return alreadyReply(targets[0]);
    if (drafts.length === 1) return eventEditReply(drafts[0]);
    return eventChoiceReply('edit', firstTargets(drafts), drafts.length);
  }

  /** (#511) 지우기: 대상 찾기 → 0개 못 찾음, 1개 확인 카드, 여럿 고르기 (앞 5개) */
  private async findEventToDelete(args: TargetArgs, userId: number, groupId: number, context: NormalizeContext): Promise<ComposedReply> {
    const targets = await this.findTargets(args, userId, groupId, context);
    if (targets.length === 0) return targetNotFoundReply(targetKeyword(args.title));
    if (targets.length === 1) return eventDeleteReply(targets[0]);
    return eventChoiceReply(
      'delete',
      firstTargets(targets).map((target) => ({ target, after: null })),
      targets.length,
    );
  }

  /** 고른 멤버로 빈 시간 → 요일 거르기 → 앞 5개. 투표면 앞 k개를 최소 길이 후보로 */
  private async findFreeTime(args: FindFreeTimeArgs, context: NormalizeContext): Promise<ComposedReply> {
    const plan = normalizeFreeTime(args, context);
    const all = await this.freeSlots.computeFor(
      plan.participants,
      plan.from,
      plan.to,
      { dayStartMin: minutesOf(plan.dayStart), dayEndMin: minutesOf(plan.dayEnd), minMinutes: plan.minMinutes, includeAllDay: false },
      context.now,
    );
    const filtered = filterByDays(all, plan.days);
    const shown = filtered.slice(0, SLOTS_MAX);
    const slots = shown.map((slot) => ({ startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() }));
    const poll =
      plan.poll && shown.length >= 2 && context.members.length >= 2
        ? {
            draft: {
              title: plan.pollTitle ?? '약속',
              options: shown.map((slot) => ({
                startsAt: slot.startsAt.toISOString(),
                endsAt: new Date(slot.startsAt.getTime() + plan.minMinutes * 60_000).toISOString(),
                allDay: false as const,
              })),
              participants: plan.participants,
            },
            members: membersOf(plan.participants, context),
          }
        : null;
    return freeSlotsReply({
      query: {
        from: plan.from.toISOString(),
        to: plan.to.toISOString(),
        dayStart: plan.dayStart,
        dayEnd: plan.dayEnd,
        minMinutes: plan.minMinutes,
        days: plan.days,
        participants: plan.participants,
      },
      slots,
      total: filtered.length,
      pollTitle: plan.pollTitle,
      poll,
    });
  }

  /** 기존 일정 목록(멤버 검사, 반복 펼치기 포함) → 그 사람이 참여자인 것만 → 앞 10개 */
  private async listEvents(args: ListEventsArgs, userId: number, groupId: number, context: NormalizeContext): Promise<ComposedReply> {
    const plan = normalizeListEvents(args, context);
    const views = await this.events.list(userId, groupId, plan.from.toISOString(), plan.to.toISOString());
    const matched = plan.memberId === null ? views : views.filter((view) => view.participants.members.some((member) => member.userId === plan.memberId));
    const events: AssistantEvent[] = matched.slice(0, LIST_MAX).map((view) => ({
      id: view.id,
      publicCode: view.publicCode,
      title: view.title,
      startsAt: view.startsAt.toISOString(),
      endsAt: view.endsAt.toISOString(),
      allDay: view.allDay,
      occurrence: view.occurrence,
      members: view.participants.members,
    }));
    return eventListReply({ fromDate: plan.fromDate, toDate: plan.toDate, from: plan.from, to: plan.to, events, total: matched.length }, kstDate(context.now));
  }

  /** 기념일 + 생일의 기간 안 첫 날짜 (웹 lib/anniversary.ts 와 같은 규칙, push/anniversary-items.ts). 이름 포함 검색 */
  private async findAnniversary(args: FindAnniversaryArgs, userId: number, groupId: number, context: NormalizeContext): Promise<ComposedReply> {
    const plan = normalizeFindAnniversary(args, context);
    const [anniversaries, birthdays] = await Promise.all([this.anniversaries.list(userId, groupId), this.birthdays.list(userId, groupId)]);
    const candidates: { name: string; kind: AssistantDay['kind']; source: AnniversaryLike; userId: number | null }[] = [
      // (#562) 음력 기념일, 생일도 같은 함수가 해마다 양력으로 바꾼다
      ...anniversaries.map((a) => ({
        name: a.name,
        kind: 'ANNIVERSARY' as const,
        source: { date: a.date, kind: a.kind, calendar: a.calendar, isLeapMonth: a.isLeapMonth },
        userId: null,
      })),
      ...birthdays.map((b) => ({
        name: birthdayTitle(b.member.displayName),
        kind: 'BIRTHDAY' as const,
        source: birthdayAnniversary({ date: b.date, calendar: b.calendar, isLeapMonth: b.isLeapMonth }),
        userId: b.member.userId,
      })),
    ];
    const filtered = filterAnniversaries(candidates, plan.keyword, context);
    const today = kstDate(context.now);
    const days: AssistantDay[] = [];
    for (const candidate of filtered) {
      const hit = firstOccurrence(candidate.source, plan.fromDate, plan.toDate);
      if (!hit) continue;
      days.push({ name: hit.label ? `${candidate.name} ${hit.label}` : candidate.name, date: hit.date, kind: candidate.kind, dday: dateToDay(hit.date) - dateToDay(today) });
    }
    days.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    return anniversaryReply({ from: plan.from, to: plan.to, days: days.slice(0, DAYS_MAX) });
  }
}

const compact = (text: string): string => text.replace(/\s+/g, '').toLowerCase();

/**
 * 검색어로 거른다. 없거나 "기념일", "우리 기념일" 이면 기념일 전부(+ 생일), "생일" 이면 생일만.
 * "하늘 생일", "하늘이 생일" 은 이름으로 멤버를 찾아 그 사람 생일, 그 밖은 이름 포함
 */
export function filterAnniversaries<T extends { name: string; kind: 'ANNIVERSARY' | 'BIRTHDAY'; userId: number | null }>(
  list: readonly T[],
  keyword: string | null,
  context: Pick<NormalizeContext, 'userId' | 'members'>,
): T[] {
  if (keyword === null) return [...list];
  const word = compact(keyword).replace(/^우리/, '');
  if (word === '' || word === '기념일') return list.filter((item) => item.kind === 'ANNIVERSARY');
  if (word === '생일') return list.filter((item) => item.kind === 'BIRTHDAY');
  const byName = list.filter((item) => compact(item.name).includes(word));
  if (byName.length > 0) return byName;
  // "하늘이 생일" → 멤버 이름 규칙(받침 + 이)으로 사람을 찾는다
  const match = matchName(word.replace(/생일$/, ''), context);
  if (match.kind !== 'one') return [];
  return list.filter((item) => item.kind === 'BIRTHDAY' && item.userId === match.member.userId);
}

/** [fromDate, toDate] 안에서 처음 보이는 날과 라벨 ("300일", "1주년") */
export function firstOccurrence(source: AnniversaryLike, fromDate: string, toDate: string): { date: string; label: string | null } | null {
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    const items = anniversaryItemsOn(source, date);
    if (items.length > 0) return { date, label: items[0].label };
  }
  return null;
}
