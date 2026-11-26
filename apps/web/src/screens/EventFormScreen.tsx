"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { EventColorPicker } from "@/components/EventColorPicker";
import { ParticipantSheet } from "@/components/Participants";
import { OverflowMenu } from "@/components/OverflowMenu";
import { RepeatSheet, ScopeSheet } from "@/components/RecurrenceSheets";
import { ReminderSheet } from "@/components/ReminderPicker";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { Button, ConfirmDialog, MemberDot, Sheet, Skeleton } from "@/components/ui";
import { useEventDraft } from "@/hooks";
import { canGoBack } from "@/lib/back-nav";
import { useLeaveGuard } from "@/lib/useLeaveGuard";
import { maybeOpenPushPrompt } from "@/lib/push";
import { newDraft } from "@/lib/event-draft";
import { dateKeyOf } from "@/lib/date";
import { calendarHref } from "@/lib/routes";
import type { EventDetailData, EventScope } from "@/lib/types";
import { DateRangeGroup } from "./event-form/DateRangeGroup";
import { EventOptionRows } from "./event-form/EventOptionRows";
import { MemoField } from "./event-form/MemoField";
import { TitlePlaceGroup } from "./event-form/TitlePlaceGroup";
import { useEventFormUi } from "./event-form/useEventFormUi";
import { useEventFormValues } from "./event-form/useEventFormValues";
import { useEventLoad } from "./event-form/useEventLoad";
import { useEventMutations } from "./event-form/useEventMutations";
import { useEventSubmit } from "./event-form/useEventSubmit";
import { useMemoAutoGrow } from "./event-form/useMemoAutoGrow";

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

// (#497) 상태와 효과는 event-form/ 의 훅으로, 큰 묶음은 하위 컴포넌트로 나눴다. 시트와 확인 창은 폼의 바로 아래 자식 자리를 지키려고 여기에 둔다
// (자식 수가 바뀌면 useId 로 만든 id 가 달라진다)
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
  const { allDay, startDate, memo, repeat, reminder, color } = draft;
  const ui = useEventFormUi();
  const { dialog, setDialog, closeDialog, closeScope, scopePending, setParticipantError } = ui;

  const mutations = useEventMutations({ groupId, sourceId, query, initial: form.initial, draft });
  const { fromAssistant, saving, deleting } = mutations;

  const { loadedEvent, creator, saveError, setSaveError } = useEventLoad({
    groupId,
    eventId,
    sourceId,
    occurrence,
    initialEvent,
    editing,
    loaded,
    load: form.load,
    router,
    toast,
  });

  const values = useEventFormValues({
    draft,
    touched,
    initial: form.initial,
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
  });
  const { series, thisOnlyPreset, ruleChanged, ruleDateFor, currentPick, pickChanged, colorChanged, autoColors, canSave } = values;

  // 저장, 삭제가 끝나 화면을 떠나는 중이면 확인하지 않는다
  const [done, setDone] = useState(false);
  const leave = useLeaveGuard(!done && form.dirty);
  const untilLabelId = useId();
  // (#378) 머리줄 ‹. 앱 안에서 왔으면 뒤로, 바로 열었으면(알림, 외부 링크) 달력으로 (lib/back-nav, ScreenHeader 와 같은 판단)
  const cancel = useCallback(() => leave.request(() => (canGoBack() ? router.back() : router.push(calendarHref()))), [leave, router]);

  const memoRef = useMemoAutoGrow(memo, loaded);

  const { save, pickScope, submit, removeEvent } = useEventSubmit({
    eventId,
    editing,
    personal,
    presetScope,
    draft,
    touch: form.touch,
    payload: values.payload,
    series,
    loadedDate: loadedEvent ? (loadedEvent.occurrence ?? dateKeyOf(loadedEvent.startsAt)) : null,
    canSave,
    showParticipants: values.showParticipants,
    currentPick,
    initialPick: values.initialPick,
    initialColor: values.initialColor,
    dialog,
    setDialog,
    closeScope,
    setScopePending: ui.setScopePending,
    setParticipantError,
    setSaveError,
    setDone,
    create: mutations.create,
    update: mutations.update,
    remove: mutations.remove,
    deletedToast: mutations.deletedToast,
    router,
    toast,
  });

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
          <TitlePlaceGroup
            title={draft.title}
            place={draft.place}
            dispatch={dispatch}
            touch={form.touch}
            titleEditedRef={ui.titleEdited}
            editing={editing}
            titleError={values.titleError}
          />

          {/* 2. 종일, 시작, 종료 */}
          <DateRangeGroup draft={draft} dispatch={dispatch} touched={touched} rangeError={values.rangeError} lunarError={values.lunarError} />

          {/* 3. 참여자, 알림, 반복, 색: 줄 넷을 카드 한 장에 (값 ›, 누르면 시트) */}
          <EventOptionRows
            draft={draft}
            dispatch={dispatch}
            setDialog={setDialog}
            meId={meId}
            showParticipants={values.showParticipants}
            participantsShown={values.participantsShown}
            participantError={ui.participantError}
            remindError={values.remindError}
            showRepeat={values.showRepeat}
            ruleDateFor={ruleDateFor}
            untilLabelId={untilLabelId}
            repeatError={values.repeatError}
            autoColors={autoColors}
            thisOnlyPreset={thisOnlyPreset}
          />

          {/* 4. 메모. 글자 수는 80% 부터 */}
          <MemoField draft={draft} dispatch={dispatch} memoRef={memoRef} />

          {editing && creator && (
            <p className="flex items-center gap-1.5 px-1 text-[12px] text-ink-2">
              <MemberDot color={creator.color} size={8} />
              {creator.displayName}님이 등록한 일정
            </p>
          )}

          {/* 저장 줄: 폰은 바닥에 붙는다(독은 폼 화면에서 숨김 #137). 넓은 화면은 내용 바로 아래 */}
          <div className="sticky bottom-0 z-10 -mx-5 bg-surface px-5 pb-[calc(12px+var(--sab))] pt-2 fold:static fold:mx-0 fold:bg-transparent fold:px-0 fold:pb-0 fold:pt-1">
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
