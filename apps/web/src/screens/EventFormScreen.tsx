"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { EventColorPicker } from "@/components/EventColorPicker";
import { ParticipantSheet, ParticipantValue } from "@/components/Participants";
import { IconBell, IconPalette, IconRepeat, IconTeam } from "@/components/icons";
import { NameField } from "@/components/NameField";
import { OverflowMenu } from "@/components/OverflowMenu";
import { PlaceField } from "@/components/PlaceField";
import { RepeatSheet, ScopeSheet } from "@/components/RecurrenceSheets";
import { ReminderSheet } from "@/components/ReminderPicker";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { useEventDeleteToast } from "@/components/useEventDeleteToast";
import { haptic } from "@/lib/app-bridge";
import { DatePicker, TimePicker } from "@/components/pickers";
import { Button, ConfirmDialog, InlineError, MemberDot, RowButton, RowGroup, Segmented, Sheet, Skeleton, ToggleRow } from "@/components/ui";
import { editSource, FROM_ASSISTANT } from "@/lib/assistant";
import { messageOf, useCreateEvent, useDeleteEvent, useEvent, useEventDraft, useUpdateEvent } from "@/hooks";
import { dateKeyOf, todayKey } from "@/lib/date";
import { missingEventTarget } from "@/lib/calendar-url";
import { canGoBack } from "@/lib/back-nav";
import { useLeaveGuard } from "@/lib/useLeaveGuard";
import { repeatRuleError } from "@/lib/recurrence";
import { formRuleDate, repeatLabel } from "@/lib/recurrence-label";
import { maybeOpenPushPrompt } from "@/lib/push";
import { REMINDER_LABEL, reminderError } from "@/lib/reminder";
import { copyPick, participantsChanged, participantsFromPick, showParticipantRow, type ParticipantPick } from "@/lib/participants";
import { charCount, nearLimit } from "@/lib/chars";
import { eventColorChanged, eventColorName, memberColor } from "@/lib/colors";
import {
  draftFromEvent,
  eventBody,
  eventInput,
  MEMO_MAX,
  memoHint,
  newDraft,
  rangeError as rangeErrorOf,
  ruleChangedOf,
  sentUntilOf,
  timesKeptOf,
  TITLE_MAX,
  titleError as titleErrorOf,
} from "@/lib/event-draft";
import { CALENDAR_PATH, calendarHref } from "@/lib/routes";
import type { EventDetailData, EventInput, EventScope, Repeat } from "@/lib/types";

type Props = {
  eventId?: number;
  /** (#311) `/events/<코드>/edit`, `?copy=` 페이지가 서버에서 미리 받은 일정. 있으면 스켈레톤 없이 채우고 뒤에서 다시 받는다 */
  initialEvent?: EventDetailData | null;
  /** 복제할 일정 ID. 값만 채우고 새 일정으로 저장한다. 반복 회차를 복제해도 한 번짜리로 시작한다 (QA3-L2) */
  copyFrom?: number;
  /** 반복 일정의 회차 날짜 (?occurrence=, #187). 없으면 첫 회차 */
  occurrence?: string | null;
  /** 미리 정한 범위 (?scope=). 있으면 저장할 때 묻지 않고, "이 일정만" 이면 반복 줄을 숨긴다 */
  presetScope?: EventScope | null;
  initialStart?: string | null;
  initialEnd?: string | null;
};

/** 시트와 확인 창. 한 번에 하나만 뜬다 ("이후 모두" 확인은 범위 시트 위에 겹친다) */
type Dialog =
  | { kind: "repeat" }
  | { kind: "reminder" }
  | { kind: "participants" }
  | { kind: "color" }
  | { kind: "scope"; mode: "save" | "delete"; confirmFollowing?: boolean };

export function EventFormScreen({ eventId, initialEvent = null, copyFrom, occurrence, presetScope = null, initialStart, initialEnd }: Props) {
  const router = useRouter();
  const toast = useToast();
  const editing = Boolean(eventId);
  const sourceId = eventId ?? copyFrom;
  // 달력 빠른 추가의 "자세히"(#46) 가 넘긴 제목, 종일, 알림(#188) 은 새 일정일 때만 쓴다
  const query = useSearchParams();

  // (#248) 참여자: 팀 멤버, 내 id, 개인 팀 여부는 AppShell 이 받은 팀 정보에서. (#311) 팀 번호도 (주소에 없다)
  const { groupId, group } = useGroupContext();
  const meId = group?.me.userId ?? null;
  const personal = group?.type === "PERSONAL";

  // (#359) 폼 값과 시작/종료 연동, 처음 값 비교는 useEventDraft. 수정, 복제는 불러온 일정을 채운 뒤부터 처음 값이 생긴다
  const form = useEventDraft("range", () => newDraft({ start: initialStart, end: initialEnd, query: sourceId ? null : query }), { waitForLoad: Boolean(sourceId) });
  const { draft, touched, dispatch, loaded } = form;
  const { title, allDay, startDate, startTime, endDate, endTime, memo, repeat, untilOn, untilDate, reminder, pick, color } = draft;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  // 고른 범위의 요청 중 표시 (범위 시트, 확인 창의 버튼)
  const [scopePending, setScopePending] = useState<EventScope | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [participantError, setParticipantError] = useState<string | null>(null);
  // 제목을 한 번이라도 고쳤는지. 빈 제목 오류는 고친 뒤 벗어나거나 저장을 눌렀을 때만 띄운다 (#80)
  const titleEdited = useRef(false);

  // (#450) AI 비서 [고치기]로 연 새 일정 폼(?from=assistant). 저장 요청에 X-Client-Source 를 싣는다 (AI-비서.md 6-1)
  const fromAssistant = !sourceId && query.get("from") === FROM_ASSISTANT;
  const source = fromAssistant && form.initial ? editSource(form.initial, draft) : null;
  // 성공 뒤 달력으로 이동하므로 이동 중 버튼을 로딩으로 둔다
  const create = useCreateEvent(groupId, { keepPendingAfterSuccess: true, source });
  const update = useUpdateEvent(groupId, { keepPendingAfterSuccess: true });
  const remove = useDeleteEvent(groupId, { keepPendingAfterSuccess: true });
  const deletedToast = useEventDeleteToast(groupId);
  const saving = create.isPending || update.isPending;
  const deleting = remove.isPending;

  // 수정(또는 복제)이면 기존 일정을 받아 폼에 채운다. 다시 받으면 다시 채운다
  const eventQ = useEvent(groupId, sourceId, occurrence, { initialData: initialEvent });
  const loadedEvent = eventQ.data;
  const { load } = form;
  useEffect(() => {
    if (!loadedEvent) return;
    const next = draftFromEvent(loadedEvent, !eventId);
    // 효과 본문에서 직접 setState 하지 않도록 마이크로태스크로 미룬다
    queueMicrotask(() => load(next));
  }, [loadedEvent, eventId, load]);
  const creator = editing && loaded ? (loadedEvent?.creator ?? null) : null;

  const loadError = eventQ.error;
  // 회차 주소가 404 면 원본이 아직 있는지 occurrence 없이 한 번 더 본다 (QA3-L7, lib/calendar-url missingEventTarget)
  const occurrenceMissing = loadError?.status === 404 && Boolean(occurrence);
  const seriesQ = useEvent(groupId, sourceId, null, { enabled: occurrenceMissing });
  const seriesSettled = !occurrenceMissing || seriesQ.data !== null || seriesQ.error !== null;
  const seriesAlive = seriesQ.data !== null;
  const goneHandled = useRef(false);
  useEffect(() => {
    if (!loadError) return;
    if (loadError.status === 404) {
      if (!seriesSettled || goneHandled.current) return;
      goneHandled.current = true;
      const target = missingEventTarget(occurrence, seriesAlive, todayKey());
      queueMicrotask(() => {
        toast.show(target.deleted ? "이미 삭제된 일정이에요" : "일정이 바뀌어서 그날 일정을 열었어요");
        router.replace(target.href);
      });
      return;
    }
    queueMicrotask(() => setSaveError(messageOf(loadError, "일정을 불러오지 못했어요. 새로고침해 주세요")));
  }, [loadError, seriesSettled, seriesAlive, occurrence, groupId, router, toast]);

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
  const initialPick = editing ? (form.initial?.pick ?? null) : null;
  const initialColor = editing ? (form.initial?.color ?? null) : null;
  const pickChanged = participantsChanged({ editing, current: currentPick, initial: initialPick });
  const participantsShown = group && currentPick ? participantsFromPick(currentPick, group.members) : null;
  // (#343) 색 줄. "이 일정만" 으로 들어온 반복 수정은 막고 안내 (참여자 줄과 같은 규칙, D-215)
  const colorChanged = eventColorChanged({ editing, current: color, initial: initialColor });
  const autoColors = participantsShown ? participantsShown.members.map((m) => memberColor(m.color)) : [];
  const canSave = Boolean(payload) && title.trim().length > 0 && !rangeError && !repeatError && !remindError && !saving && scopePending === null;

  // 저장, 삭제가 끝나 화면을 떠나는 중이면 확인하지 않는다
  const [done, setDone] = useState(false);
  const leave = useLeaveGuard(!done && form.dirty);
  const untilLabelId = useId();
  // (#378) 머리줄 ‹. 앱 안에서 왔으면 뒤로, 바로 열었으면(알림, 외부 링크) 달력으로 (lib/back-nav, ScreenHeader 와 같은 판단)
  const cancel = useCallback(() => leave.request(() => (canGoBack() ? router.back() : router.push(calendarHref()))), [leave, router]);

  const memoNear = nearLimit(charCount(memo), MEMO_MAX);
  // 메모 칸은 내용만큼 늘어난다 (손잡이 대신, #140 L17)
  const memoRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = memoRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [memo, loaded]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    form.touch();
    if (!canSave || !payload) return;
    setSaveError(null);
    setParticipantError(null);
    // 반복 일정은 범위를 먼저 묻는다 (주소로 정해 왔으면 그 범위로 바로)
    if (series && !presetScope) {
      setDialog({ kind: "scope", mode: "save" });
      return;
    }
    await submit(series ? presetScope : null);
  }

  /** 범위 시트에서 고른 뒤. "이후 모두" 인데 뒤에 따로 바꾼 회차가 있으면 한 번 더 묻는다 (기획 3-4) */
  function pickScope(scope: EventScope) {
    if (dialog?.kind === "scope" && dialog.mode === "delete") {
      void removeEvent(scope);
      return;
    }
    if (scope === "following" && series?.hasLaterExceptions) {
      setDialog({ kind: "scope", mode: "save", confirmFollowing: true });
      return;
    }
    void submit(scope);
  }

  /** 범위 시트를 닫는다 (위에 뜬 확인 창도). 다른 시트는 그대로 */
  const closeScope = () => setDialog((d) => (d?.kind === "scope" ? null : d));

  async function submit(scope: EventScope | null) {
    if (!payload) return;
    const input = eventBody({ draft, input: payload, scope, series, editing, personal, showParticipants, currentPick, initialPick, initialColor });
    // "이후 모두" 확인 창을 닫고 범위 시트는 요청이 끝날 때까지 둔다
    setDialog((d) => (d?.kind === "scope" && d.confirmFollowing ? { kind: "scope", mode: d.mode } : d));
    setScopePending(scope);
    const target = series && scope ? { occurrence: series.occurrence ?? undefined, scope } : {};
    const r = eventId ? await update.mutate({ eventId, input, ...target }) : await create.mutate(input as EventInput);
    setScopePending(null);
    closeScope();
    if (r.ok) {
      setDone(true);
      haptic("success");
      // 권한 안내 시트 계기 ① 일정 저장 성공 직후 (푸시 지원 앱에서 한 번만, 8-1). 시트는 루트에 있어 화면이 바뀌어도 남는다
      void maybeOpenPushPrompt();
      router.push(calendarHref({ date: dateKeyOf(payload.startsAt) }));
      return;
    }
    if (r.error.status === 404) {
      toast.show("이미 삭제된 일정이에요");
      router.replace(CALENDAR_PATH);
      return;
    }
    // 참여자 검증 실패(멤버가 방금 나감 등)는 참여자 줄 아래에 (#248 7-3)
    const participantDetail = r.error.details?.find((d) => d.field === "participants");
    if (participantDetail) {
      setParticipantError(participantDetail.message || r.error.message);
      return;
    }
    setSaveError(messageOf(r.error, "저장하지 못했어요. 입력 내용은 그대로 있으니 다시 저장해 주세요"));
  }

  async function removeEvent(scope: EventScope | null = null) {
    if (!eventId) return;
    setScopePending(scope);
    const target = series && scope ? { occurrence: series.occurrence ?? undefined, scope } : {};
    const r = await remove.mutate({ eventId, ...target });
    setScopePending(null);
    closeScope();
    if (r.ok) {
      setDone(true);
      // (#375) 7초 안 되돌리기. 달력으로 옮긴 뒤 되돌려도 달력이 다시 받는다 (D-251)
      deletedToast(r.data.deletionId);
      router.replace(calendarHref({ date: startDate }));
      return;
    }
    setSaveError(messageOf(r.error, "삭제하지 못했어요. 다시 시도해 주세요"));
  }

  // (#378) 고친 일정이면 머리줄 ⋯ 에 삭제. 반복 일정은 범위 시트가 확인을 대신하고, 아니면 확인 창 → 삭제 → 되돌리기(#375)
  const menu = editing ? (
    <OverflowMenu
      label="일정 메뉴"
      disabled={!loaded || deleting || saving}
      items={[
        series
          ? { label: "삭제", onSelect: () => setDialog({ kind: "scope", mode: "delete" }) }
          : {
              label: "삭제",
              destructive: true,
              confirm: { title: "이 일정을 삭제할까요?", body: "팀원 모두에게서 사라져요", confirmLabel: "삭제" },
              onSelect: () => removeEvent(),
            },
      ]}
    />
  ) : undefined;
  const colorDots = color ? [memberColor(color)] : autoColors.length ? autoColors.slice(0, 2) : ["var(--mute)"];

  return (
    // (#378) 폭 전체 한 단. 넓은 화면은 가운데 640 한 단 (예전 2단은 오른쪽만 길어 균형이 맞지 않았다).
    // data-sticky-foot: 폰에서 바닥에 붙는 저장 줄만큼 포커스 스크롤을 띄운다 (globals.css, 줄이 입력 칸을 가리지 않게)
    <form onSubmit={save} data-sticky-foot className="mx-auto w-full fold:max-w-[640px]">
      <ScreenHeader
        title={editing ? "일정 수정" : copyFrom ? "일정 복제" : "새 일정"}
        fallbackHref={calendarHref()}
        backLabel="취소"
        onBack={cancel}
        right={menu}
      />

      {saveError && (
        <p role="alert" className="mt-2 rounded-xl bg-paper px-3.5 py-2.5 text-[14px] text-danger">
          {saveError}
        </p>
      )}

      {!loaded ? (
        <div className="mt-3 space-y-3" aria-busy="true" aria-label="불러오는 중">
          <Skeleton className="h-[104px] w-full rounded-lg" />
          <Skeleton className="h-[148px] w-full rounded-lg" />
          <Skeleton className="h-[184px] w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {/* 1. 제목 + 장소 (#199 장소를 제목 바로 아래로) */}
          <RowGroup>
            <NameField
              id="ev-title"
              label="제목"
              placeholder="무슨 일정인가요?"
              value={title}
              max={TITLE_MAX}
              onChange={(v) => {
                dispatch({ type: "title", value: v });
                titleEdited.current = true;
              }}
              // 자동 포커스된 빈 제목에서 그냥 벗어나는 것(모바일 키보드 닫기, 날짜 칸 탭)은 오류로 보지 않는다 (#80).
              // 예전에는 blur 마다 touched 를 켜서 제목 아래 오류 줄(약 26px)이 끼어들며 아래 칸이 한 번에 밀렸다
              onBlur={() => {
                if (titleEdited.current) form.touch();
              }}
              autoFocus={!editing}
              autoComplete="off"
              enterKeyHint="next"
              error={titleError}
              errorId="ev-title-err"
            />
            <PlaceField
              place={draft.place}
              onType={(value) => dispatch({ type: "placeText", value })}
              onPick={(value, query) => dispatch({ type: "placePick", value, query })}
              onClear={() => dispatch({ type: "placeClear" })}
            />
          </RowGroup>

          {/* 2. 종일, 시작, 종료 */}
          <RowGroup>
            <ToggleRow label="종일" checked={allDay} onChange={(v) => dispatch({ type: "allDay", value: v })} />
            {(
              [
                { key: "start", label: "시작", date: startDate, time: startTime },
                { key: "end", label: "종료", date: endDate, time: endTime },
              ] as const
            ).map((row) => (
              <div key={row.key} className="flex min-h-12 items-center gap-2 py-1.5">
                <span aria-hidden="true" className="w-9 shrink-0 text-[14px] text-ink-2">
                  {row.label}
                </span>
                <div className="ml-auto flex min-w-0 items-center justify-end gap-1.5">
                  <DatePicker
                    look="chip"
                    label={`${row.label} 날짜`}
                    value={row.date}
                    min={row.key === "end" ? startDate : undefined}
                    onChange={(v) =>
                      dispatch(row.key === "start" ? { type: "start", date: v, time: startTime } : { type: "end", date: v, time: endTime, by: "date" })
                    }
                  />
                  {!allDay && (
                    <TimePicker
                      look="chip"
                      label={`${row.label} 시각`}
                      value={row.time}
                      onChange={(v) =>
                        dispatch(row.key === "start" ? { type: "start", date: startDate, time: v } : { type: "end", date: endDate, time: v, by: "time" })
                      }
                    />
                  )}
                </div>
              </div>
            ))}
            {rangeError && (
              <div className="py-2">
                {touched ? <InlineError>{rangeError}</InlineError> : <p className="t-sub">{rangeError}</p>}
              </div>
            )}
          </RowGroup>

          {/* 3. 참여자, 알림, 반복, 색: 줄 넷을 카드 한 장에 (값 ›, 누르면 시트) */}
          <RowGroup>
            {/* 참여자 (#248, 7-3). "이 일정만" 반복 수정과 개인 팀은 숨긴다 */}
            {showParticipants && participantsShown && (
              <div>
                <RowButton
                  label="참여자"
                  icon={<IconTeam size={18} />}
                  onClick={() => setDialog({ kind: "participants" })}
                  aria-haspopup="dialog"
                  aria-describedby={participantError ? "ev-participants-err" : undefined}
                >
                  <ParticipantValue value={participantsShown} meId={meId} />
                </RowButton>
                {participantError && (
                  <p id="ev-participants-err" role="alert" className="pb-2 text-[13px] text-danger">
                    {participantError}
                  </p>
                )}
              </div>
            )}

            {/* 알림 (#188, 8장). 종일 여부로 선택지가 갈린다. 못 받는 기기 안내는 알림 시트 안에 */}
            <div>
              <RowButton label="알림" icon={<IconBell size={18} />} value={REMINDER_LABEL[reminder]} onClick={() => setDialog({ kind: "reminder" })} aria-haspopup="dialog" />
              {remindError && <InlineError className="pb-2">{remindError}</InlineError>}
            </div>

            {showRepeat && (
              <div>
                <RowButton
                  label="반복"
                  icon={<IconRepeat size={18} />}
                  value={repeat ? repeatLabel(repeat, ruleDateFor(repeat)) : "반복 안 함"}
                  onClick={() => setDialog({ kind: "repeat" })}
                  aria-haspopup="dialog"
                />
                {repeat && (
                  <div role="group" aria-label="반복 종료" className="space-y-2 pb-2 pl-8">
                    <div className="flex min-h-9 items-center gap-3">
                      <span id={`${untilLabelId}`} className="shrink-0 text-[14px] text-ink-2">
                        종료
                      </span>
                      <div className="ml-auto w-[176px]">
                        <Segmented
                          labelledBy={untilLabelId}
                          value={untilOn ? "date" : "forever"}
                          options={UNTIL_OPTIONS}
                          onChange={(v) => dispatch({ type: "untilOn", value: v === "date" })}
                        />
                      </div>
                    </div>
                    {untilOn && (
                      <div className="flex justify-end">
                        <DatePicker look="chip" label="반복 종료 날짜" value={untilDate} min={startDate} onChange={(v) => dispatch({ type: "untilDate", value: v })} />
                      </div>
                    )}
                  </div>
                )}
                {repeatError && <InlineError className="pb-2">{repeatError}</InlineError>}
              </div>
            )}

            {/* (#343) 일정 색: 줄 "색 ● 자동 ›" → 시트에서 자동(참여자 색) + 8색. 반복 "이 일정만" 은 막고 한 줄 안내 */}
            <div>
              <RowButton
                label="색"
                icon={<IconPalette size={18} />}
                onClick={() => setDialog({ kind: "color" })}
                aria-haspopup="dialog"
                aria-label={`색, ${eventColorName(color)}`}
                aria-describedby={thisOnlyPreset ? "ev-color-note" : undefined}
                disabled={thisOnlyPreset}
              >
                <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[14px] text-ink-2">
                  <span aria-hidden="true" className="inline-flex items-center">
                    {colorDots.map((c, i) => (
                      <i key={i} className="block size-3 rounded-full" style={{ background: c, marginLeft: i ? -4 : 0, boxShadow: i ? "0 0 0 1.5px var(--tile)" : undefined }} />
                    ))}
                  </span>
                  <span className="truncate">{eventColorName(color)}</span>
                </span>
              </RowButton>
              {thisOnlyPreset && (
                <p id="ev-color-note" className="t-sub pb-2 pl-8">
                  반복 일정의 색은 이후 모두에서 바꿀 수 있어요
                </p>
              )}
            </div>
          </RowGroup>

          {/* 4. 메모. 글자 수는 80% 부터 */}
          <div className="rounded-lg bg-paper px-3.5 py-2.5">
            <label htmlFor="ev-memo" className="sr-only">
              메모
            </label>
            <textarea
              ref={memoRef}
              id="ev-memo"
              rows={3}
              aria-describedby={memoNear ? "ev-memo-count" : undefined}
              className="-mx-1.5 block max-h-[50dvh] min-h-[72px] w-[calc(100%+12px)] resize-none overflow-y-auto rounded-sm bg-transparent px-1.5 py-1.5 text-[14px] leading-5 text-ink placeholder:text-ink-2 focus:outline-2 focus:outline-ink focus:outline-offset-0"
              placeholder="메모 (준비물, 링크 등)"
              value={memo}
              onChange={(e) => dispatch({ type: "memo", value: e.target.value })}
            />
            {memoNear && (
              <p id="ev-memo-count" className="t-sub pb-0.5 text-right tabular-nums">
                {memoHint(draft)}
              </p>
            )}
          </div>

          {editing && creator && (
            <p className="flex items-center gap-1.5 px-1 text-[12px] text-ink-2">
              <MemberDot color={creator.color} size={8} />
              {creator.displayName}님이 등록한 일정
            </p>
          )}

          {/* 저장 줄: 폰은 바닥에 붙는다(독은 폼 화면에서 숨김 #137). 넓은 화면은 내용 바로 아래 */}
          <div className="sticky bottom-0 z-10 -mx-5 bg-surface px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-2 fold:static fold:mx-0 fold:bg-transparent fold:px-0 fold:pb-0 fold:pt-1">
            <Button type="submit" size="xl" full disabled={!canSave} loading={saving}>
              {editing ? "저장" : "추가"}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={leave.pending}
        title="작성 중인 내용을 버릴까요?"
        body="지금 나가면 입력한 내용이 저장되지 않아요"
        confirmLabel="나가기"
        cancelLabel="계속 쓰기"
        danger
        onConfirm={leave.confirm}
        onCancel={leave.cancel}
      />
      <RepeatSheet
        open={dialog?.kind === "repeat"}
        value={repeat}
        firstDate={startDate}
        labelDate={ruleDateFor}
        onPick={(v) => {
          dispatch({ type: "repeat", value: v });
          closeDialog();
        }}
        onClose={closeDialog}
      />
      {group && (
        <ParticipantSheet
          open={dialog?.kind === "participants"}
          members={group.members}
          meId={meId}
          value={currentPick ?? []}
          onDone={(v) => {
            // 새 일정에서 기본값([나]) 그대로 고르면 작성 중으로 보지 않는다 (이탈 확인, lib/event-draft)
            dispatch({ type: "pick", value: v, meId });
            setParticipantError(null);
            closeDialog();
          }}
          onClose={closeDialog}
        />
      )}
      <ReminderSheet
        open={dialog?.kind === "reminder"}
        allDay={allDay}
        value={reminder}
        onPick={(v) => {
          dispatch({ type: "reminder", value: v });
          closeDialog();
          // 권한 안내 시트 계기 ② "없음" 이 아닌 값을 처음 고를 때 (8-1)
          if (v !== "NONE") void maybeOpenPushPrompt();
        }}
        onClose={closeDialog}
      />
      {series && (
        <ScopeSheet
          open={dialog?.kind === "scope"}
          mode={dialog?.kind === "scope" ? dialog.mode : "save"}
          occurrence={series.occurrence ?? startDate}
          onlyFollowing={dialog?.kind === "scope" && dialog.mode === "save" && (ruleChanged || pickChanged || colorChanged)}
          pending={scopePending}
          onPick={pickScope}
          onClose={closeScope}
        />
      )}
      <ConfirmDialog
        open={dialog?.kind === "scope" && Boolean(dialog.confirmFollowing)}
        title="이후 모두 바꿀까요?"
        body="이후 따로 바꾼 회차도 새 값으로 바뀌어요"
        confirmLabel="바꾸기"
        neutral
        loading={scopePending === "following"}
        onConfirm={() => void submit("following")}
        onCancel={() => setDialog((d) => (d?.kind === "scope" ? { kind: "scope", mode: d.mode } : d))}
      />
      <Sheet open={dialog?.kind === "color"} onClose={closeDialog} title="색">
        <EventColorPicker
          bare
          value={color}
          onChange={(v) => dispatch({ type: "color", value: v })}
          onPicked={closeDialog}
          autoColors={autoColors}
          disabled={thisOnlyPreset}
        />
        <p className="t-sub mt-2 pb-1">자동은 참여자 색을 따라가요</p>
      </Sheet>
    </form>
  );
}

const UNTIL_OPTIONS: { value: "forever" | "date"; label: string }[] = [
  { value: "forever", label: "계속" },
  { value: "date", label: "날짜까지" },
];
