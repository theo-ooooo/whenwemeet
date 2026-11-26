import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { MembershipService } from '../groups/membership.service.js';
import type { EventPatchDto } from './dto/event.dto.js';
import { assertEventRange, assertRepeatRule, colorInput, inheritedUntil, isUnchanged, mergeValues, reminderTimingChanged, sameOccurrenceValues, storedRemindAt } from './event-input.js';
import { followingAnchor, occurrenceValues, seriesRule } from './event-occurrences.js';
import { type EventView, participantsOf, toEventView, toOccurrenceView } from './event-view.js';
import type { EventExceptionRow, EventRow } from './event-rows.js';
import { EventSeriesRepository } from './event-series.repository.js';
import type { EventCreateInput, ExceptionFields, ScopeLog } from './event-write-data.js';
import { EventWritesRepository } from './event-writes.repository.js';
import { type ParticipantsInput, resolveParticipants, sameParticipants } from './participants.js';
import { CLEARED_PLACE, samePlace } from './place.js';
import { anchorMatchesStart, applyException, kstDate, type Occurrence, originalOccurrence, withinShiftLimit } from './recurrence.js';

/** 반복 일정의 "이 일정만", "이후 모두" 수정. EventsService 에서 옮김 (#496) */
@Injectable()
export class EventSeriesService {
  constructor(
    private readonly writes: EventWritesRepository,
    private readonly seriesWrites: EventSeriesRepository,
    private readonly memberships: MembershipService,
  ) {}

  /**
   * "이 일정만" 수정 (D-65). 원래 회차와 다른 필드만 예외에 저장하고, 모두 원래 값이 되면 예외 행을 지운다.
   * 회차의 현재 값과 같으면 저장도 로그도 없다 (#62)
   */
  async updateThis(userId: number, series: EventRow, occurrence: Occurrence, dto: EventPatchDto): Promise<EventView> {
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
      // (#199) 원본 장소와 같으면 null, 이 회차만 지우면 CLEARED_PLACE (메모와 같은 규칙)
      place: samePlace(next.place, series.place) ? null : (next.place ?? CLEARED_PLACE),
    };
    const isEmpty = Object.values(fields).every((value) => value === null);
    await this.seriesWrites.saveExceptionWithLogTx(
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
  async updateFollowing(
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
    const resolver = await this.memberships.resolverFor(series.groupId);
    const participants = resolveParticipants(input, participantsOf(series), userId, false, resolver.userIds());
    const sameMembers = sameParticipants(participantsOf(series), participants);
    // (#343) 본문에 없으면 원본 색 (새 원본에 복사)
    const inputColor = colorInput(dto.color);
    const color = inputColor === undefined ? series.color : inputColor;
    const colorChanged = color !== series.color;
    // (#566) 음력 입력 표시도 색과 같은 규칙 (본문에 없으면 원본 값, 이것만 바꾸면 조용히, D-298)
    const lunarInput = dto.lunarInput ?? series.lunarInput;
    const lunarChanged = lunarInput !== series.lunarInput;
    const displayChanged = colorChanged || lunarChanged;
    const log: ScopeLog = { actorId: userId, scope: 'FOLLOWING', occurrence: occurrence.occurrence };

    if (isFirst) {
      if (sameRule && sameMembers && exceptions.length === 0 && isUnchanged(series, next)) {
        // (#343) 색만 바꾸면 원본 색만 저장. 로그, 새 소식, 푸시 없음 (D-215). (#566) 음력 입력 표시도 같다
        if (!displayChanged) return toOccurrenceView(series, occurrence, resolver);
        const row = lunarChanged
          ? await this.writes.updateDisplay(series.id, { ...(colorChanged ? { color } : {}), lunarInput })
          : await this.writes.updateColor(series.id, color);
        return toOccurrenceView(row, occurrence, resolver);
      }
      // (#188) 예외를 모두 지우면 옮긴 회차의 시각도 바뀌므로 반복 규칙, 예외 유무까지 기준 시각 대상 (D-86)
      const timing = !sameRule || exceptions.length > 0 || reminderTimingChanged(series, next);
      const row = await this.seriesWrites.updateSeriesFromStartTx(
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
          ...(lunarChanged ? { lunarInput } : {}),
        },
        log,
      );
      return toEventView(row, resolver);
    }

    // 원래 회차 값과 같고 이 회차부터 예외가 없으면 나눠도 펼친 결과가 같다 (#62)
    const hasFollowingExceptions = exceptions.some((exception) => exception.occurrence >= occurrence.occurrence);
    const onlyColor = sameRule && sameMembers && !hasFollowingExceptions && isUnchanged(original, next);
    if (onlyColor && !displayChanged) return toOccurrenceView(series, occurrence, resolver);

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
      lunarInput,
    };
    // (#343) 색만 바꾸면 나누되 로그, 새 소식, 푸시 없음 (D-215)
    const row = onlyColor
      ? await this.seriesWrites.splitSeriesQuietTx(series, occurrence.occurrence, created)
      : await this.seriesWrites.splitSeriesTx(series, occurrence.occurrence, log, created);
    return toEventView(row, resolver);
  }
}
