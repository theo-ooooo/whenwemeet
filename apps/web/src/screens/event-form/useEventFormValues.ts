"use client";
// (#497) 일정 폼의 파생 값: 전송할 값, 반복 일정 여부, 오류 문장, 참여자와 색 비교, 저장 가능 여부. EventFormScreen 에서 옮김
import { useMemo } from "react";
import type { useGroupContext } from "@/components/AppShell";
import { repeatRuleError } from "@/lib/recurrence";
import { formRuleDate } from "@/lib/recurrence-label";
import { reminderError } from "@/lib/reminder";
import { copyPick, participantsChanged, participantsFromPick, showParticipantRow, type ParticipantPick } from "@/lib/participants";
import { eventColorChanged, memberColor } from "@/lib/colors";
import {
  eventInput,
  lunarError as lunarErrorOf,
  rangeError as rangeErrorOf,
  ruleChangedOf,
  sentUntilOf,
  timesKeptOf,
  titleError as titleErrorOf,
  type EventDraft,
} from "@/lib/event-draft";
import type { EventDetailData, EventInput, EventScope, Repeat } from "@/lib/types";

type Args = {
  draft: EventDraft;
  touched: boolean;
  /** 처음 채운 값 (useEventDraft initial) */
  initial: EventDraft | null;
  eventId: number | undefined;
  copyFrom: number | undefined;
  editing: boolean;
  presetScope: EventScope | null;
  loadedEvent: EventDetailData | null | undefined;
  group: ReturnType<typeof useGroupContext>["group"];
  meId: number | null;
  personal: boolean;
  fromAssistant: boolean;
  saving: boolean;
  scopePending: EventScope | null;
};

export function useEventFormValues({
  draft,
  touched,
  initial,
  eventId,
  copyFrom,
  editing,
  presetScope,
  loadedEvent,
  group,
  meId,
  personal,
  fromAssistant,
  saving,
  scopePending,
}: Args) {
  const { title, allDay, startDate, repeat, reminder, pick, color } = draft;

  // 전송할 값 (종일이면 KST 자정 ~ 다음 날 자정). "이 일정만" 은 그 회차에, "이후 모두" 는 (새) 원본에 저장된다
  const payload = useMemo<EventInput | null>(() => eventInput(draft, eventId ? (loadedEvent ?? null) : null), [draft, eventId, loadedEvent]);

  // 수정 중인 일정이 반복 일정인지 (범위를 묻는다). 복제는 새 일정이라 해당 없음
  const series = eventId && loadedEvent?.repeat ? loadedEvent : null;
  // "이 일정만" 수정은 반복 줄을 숨긴다 (반복은 이후 모두에서만 바꾼다, 기획 3-4)
  const thisOnlyPreset = Boolean(series && presetScope === "this");
  const showRepeat = !thisOnlyPreset;
  // 반복 규칙을 바꿨는지. 바꿨으면 범위 시트에서 "이 일정만" 을 막는다
  const ruleChanged = ruleChangedOf(draft, series);

  const titleError = titleErrorOf(draft, touched);
  const rangeError = rangeErrorOf(draft, "range");
  // (#566) 음력으로 고른 날짜가 없는 날이면 저장을 막는다 (D-298)
  const lunarError = lunarErrorOf(draft);
  const sentUntil = sentUntilOf(draft, series);
  const timesKept = timesKeptOf(payload, series);
  // 반복 줄, 반복 시트의 설명 날짜. 규칙을 이어받으면 원본 기준 날짜("매월 31일"), 아니면 폼의 시작 날짜
  const ruleDateFor = (r: Repeat) => formRuleDate(series, r, startDate, timesKept);
  // 반복 규칙 (설계 4-1): 길이 < 주기, 종료 날짜 >= 첫 회차 날짜. 줄을 숨기면 보지 않는다. 보내지 않는 종료 날짜는 보지 않는다
  const repeatError =
    payload && showRepeat
      ? repeatRuleError(repeat, Date.parse(payload.startsAt), Date.parse(payload.endsAt), startDate, sentUntil === undefined ? null : sentUntil)
      : null;
  // 종일 전환에서 "없음" 으로 되돌리므로 정상 흐름에선 생기지 않는다. 서버와 같은 문장으로 막아 둔다
  const remindError = reminderError(reminder, allDay);
  // 참여자 줄 (#248, 7-3). "이 일정만" 으로 들어온 반복 수정과 개인 팀은 숨긴다
  const showParticipants = Boolean(group) && showParticipantRow({ personal, thisOnly: thisOnlyPreset });
  const memberIds = useMemo(() => (group?.members ?? []).flatMap((m) => (m.userId === null ? [] : [m.userId])), [group]);
  // 지금 값. 새 일정 기본은 [나], 복제는 원본 참여자를 지금 멤버로 거르고 비면 [나] (D-142)
  const currentPick: ParticipantPick | null =
    pick === null
      ? meId !== null
        ? [meId]
        : null
      : (copyFrom || fromAssistant) && !eventId && meId !== null && group
        ? copyPick(pick, memberIds, meId)
        : pick;
  // 수정이면 불러온 참여자, 색과 비교한다 (새 일정, 복제는 비교하지 않는다)
  const initialPick = editing ? (initial?.pick ?? null) : null;
  const initialColor = editing ? (initial?.color ?? null) : null;
  const pickChanged = participantsChanged({ editing, current: currentPick, initial: initialPick });
  const participantsShown = group && currentPick ? participantsFromPick(currentPick, group.members) : null;
  // (#343) 색 줄. "이 일정만" 으로 들어온 반복 수정은 막고 안내 (참여자 줄과 같은 규칙, D-215)
  const colorChanged = eventColorChanged({ editing, current: color, initial: initialColor });
  const autoColors = participantsShown ? participantsShown.members.map((m) => memberColor(m.color)) : [];
  const canSave = Boolean(payload) && title.trim().length > 0 && !rangeError && !lunarError && !repeatError && !remindError && !saving && scopePending === null;

  return {
    payload,
    series,
    thisOnlyPreset,
    showRepeat,
    ruleChanged,
    titleError,
    rangeError,
    lunarError,
    ruleDateFor,
    repeatError,
    remindError,
    showParticipants,
    currentPick,
    initialPick,
    initialColor,
    pickChanged,
    participantsShown,
    colorChanged,
    autoColors,
    canSave,
  };
}
