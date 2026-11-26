import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import type { ResponseTarget } from '../events/event-view.js';
import { EventsService } from '../events/events.service.js';
import {
  EventResponsesRepository,
  type WriteOutcome,
} from './event-responses.repository.js';
import {
  NOT_PARTICIPANT_MESSAGE,
  parseReactionKind,
  parseRsvpStatus,
  type ReactionSummary,
  type RsvpSummary,
  summarizeReactions,
  summarizeRsvp,
} from './responses.js';

const idsOf = (target: ResponseTarget['members']): number[] =>
  target.flatMap((member) => (member.userId === null ? [] : [member.userId]));

/**
 * (#190) 일정 참석 여부와 짧은 반응 (설계 `참석-여부.md`).
 * - 참석 여부: 그 회차의 참여자만 (모두면 지금 팀원 전원). 아니면 403 NOT_PARTICIPANT
 * - 반응: 팀원 누구나, 사람당 하나
 * - 남의 응답은 바꿀 수 없다 (경로에 사람이 없고 늘 나). 같은 값이면 저장, 기록 모두 없다 (#62)
 */
@Injectable()
export class EventResponsesService {
  constructor(
    private readonly events: EventsService,
    private readonly responses: EventResponsesRepository,
  ) {}

  async setRsvp(
    userId: number,
    groupId: number,
    eventId: number,
    occurrenceRaw: unknown,
    statusRaw: unknown,
  ): Promise<RsvpSummary> {
    const status = parseRsvpStatus(statusRaw);
    const target = await this.events.resolveTarget(
      userId,
      groupId,
      eventId,
      occurrenceRaw,
    );
    const { view } = target;
    const outcome = await this.responses.saveRsvp({
      groupId,
      eventId,
      occurrence: target.occurrence,
      userId,
      status,
      startsAt: view.startsAt,
      endsAt: view.endsAt,
      news: {
        eventId,
        eventCode: view.publicCode,
        occurrence: view.occurrence,
        title: view.title,
        startsAt: view.startsAt.toISOString(),
        endsAt: view.endsAt.toISOString(),
        allDay: view.allDay,
      },
    });
    assertWritable(outcome);
    const { rsvps } = await this.responses.listForOccurrence(
      eventId,
      target.occurrence,
    );
    return summarizeRsvp(idsOf(target.participants), rsvps, userId);
  }

  async setReaction(
    userId: number,
    groupId: number,
    eventId: number,
    occurrenceRaw: unknown,
    reactionRaw: unknown,
  ): Promise<ReactionSummary> {
    const reaction = parseReactionKind(reactionRaw);
    const target = await this.events.resolveTarget(
      userId,
      groupId,
      eventId,
      occurrenceRaw,
    );
    assertWritable(
      await this.responses.saveReaction({
        groupId,
        eventId,
        occurrence: target.occurrence,
        userId,
        reaction,
      }),
    );
    const { reactions } = await this.responses.listForOccurrence(
      eventId,
      target.occurrence,
    );
    return summarizeReactions(idsOf(target.members), reactions, userId);
  }
}

/** 트랜잭션 안 확인 결과 → 오류. 그사이 팀을 나갔으면 FORBIDDEN, 참여자에서 빠졌으면 NOT_PARTICIPANT */
function assertWritable(outcome: WriteOutcome): void {
  if (outcome === 'NOT_MEMBER') throw new ApiException('FORBIDDEN');
  if (outcome === 'NOT_PARTICIPANT')
    throw new ApiException('NOT_PARTICIPANT', NOT_PARTICIPANT_MESSAGE);
}
