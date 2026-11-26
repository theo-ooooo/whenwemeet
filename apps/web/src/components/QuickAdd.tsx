"use client";
// 달력에서 바로 일정 추가 (#46). 폴더블.md 5-2 부터는 날짜 상세(DayPanel) 의 "이날 일정 추가" 가 같은 자리에서 이 폼으로 바뀐다.
// 날짜 칸을 누르면 바로 열리던 경로(모바일 재탭, PC 빈 곳 클릭)는 없앴다. 바로 추가는 + 버튼이 맡는다.
// 필드: 제목, 종일, 시작/종료 시각. 저장은 useCreateEvent, "자세히" 는 새 일정 폼으로 값을 넘긴다.
// (#378) 일정 폼과 같은 카드, 줄 모양. 알림은 줄(누르면 카드 안에 펼침), 버튼은 "자세히 | 추가"
import { useRouter } from "next/navigation";
import { newEventHref } from "@/lib/routes";
import { useId, useState } from "react";
import { IconBell, IconChevronLeft } from "./icons";
import { NameField } from "./NameField";
import { TimeList, TimePicker } from "./pickers";
import { ReminderInline } from "./ReminderPicker";
import { Button, CloseButton, InlineError, RowButton, RowGroup, ToggleRow } from "./ui";
import { messageOf, useCreateEvent, useEventDraft } from "@/hooks";
import { haptic } from "@/lib/app-bridge";
import { maybeOpenPushPrompt } from "@/lib/push";
import { REMINDER_LABEL } from "@/lib/reminder";
import { dowOf, parseKey, WEEKDAYS, type DateKey } from "@/lib/date";
import { quickDetailQuery, quickDraft, quickInput, rangeError as rangeErrorOf, titleError as titleErrorOf } from "@/lib/event-draft";
import type { Event } from "@/lib/types";

type GroupId = Event["groupId"];

type Props = {
  groupId: GroupId;
  date: DateKey;
  titleId: string;
  onClose: () => void;
  /** ← : 날짜 상세로 */
  onBack: () => void;
  /** 저장 성공. 화면은 목록을 다시 받아 바로 보여준다 */
  onSaved: (ev: Event) => void;
  /** (#192) 처음 시작 시각 'HH:mm'. 종료는 1시간 뒤(자정에서 멈춘다). 없으면 10:00~11:00 */
  initialStart?: string;
};

/* ---------- 폼 (시트, 팝오버 공통) ---------- */

export function QuickAddForm({ groupId, date, onClose, onBack, onSaved, titleId, initialStart }: Props) {
  const router = useRouter();
  const ids = useId();
  // 값과 시작/종료 연동(길이 유지, 종료 보정, 자정에서 멈춤)은 일정 폼과 같은 lib/event-draft (#359). 하루 안이라 span "day"
  const { draft, touched, dispatch, touch } = useEventDraft("day", () => quickDraft(date, initialStart));
  const { title, allDay, startTime: start, endTime: end, reminder } = draft;
  // 펼친 시각 목록(시작, 종료 중 하나). 알림 목록은 시트 안이라 줄 아래로 따로 펼친다 (#188, 8장 "빠른 추가 시트 포함")
  const [timeOpen, setTimeOpen] = useState<"start" | "end" | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  // 펼친 시각 목록을 닫으면 포커스를 그 시각 버튼으로 돌린다
  function closeTime() {
    if (timeOpen) document.getElementById(`${ids}-${timeOpen}`)?.focus({ preventScroll: true });
    setTimeOpen(null);
  }
  const create = useCreateEvent(groupId);

  const titleError = titleErrorOf(draft, touched);
  const rangeError = rangeErrorOf(draft, "day");
  const saveError = create.error ? messageOf(create.error, "저장하지 못했어요. 다시 저장해 주세요") : null;

  const changeStart = (v: string) => dispatch({ type: "start", date, time: v });
  const changeEnd = (v: string) => dispatch({ type: "end", date, time: v, by: "time" });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    touch();
    if (title.trim().length === 0 || rangeError || create.isPending) return;
    const r = await create.mutate(quickInput(draft));
    if (r.ok) {
      haptic("success");
      // 권한 안내 시트 계기 ① 일정 저장 성공 직후 (8-1)
      void maybeOpenPushPrompt();
      onSaved(r.data);
    }
  }

  function more() {
    router.push(newEventHref(quickDetailQuery(draft)));
  }

  return (
    <form onSubmit={save} noValidate>
      {/* 머리: "← 12일 목요일에 추가" + 닫기 (폴더블.md 5-2). 뒤로 화살표 선을 시트 여백 16 에 맞춘다(광학 정렬, 일정 상세와 같음). 버튼 칸은 왼쪽으로 내밀고 누르는 영역 44 는 hit 가 유지 (#174 L9) */}
      <div data-drag className="flex h-10 touch-none items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="날짜 상세로"
          className="hit -ml-2 flex size-8 shrink-0 items-center rounded-sm pl-0.5 text-ink-2 hover:bg-hover hover:text-ink"
        >
          <IconChevronLeft size={18} />
        </button>
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-[18px] font-bold leading-6 tracking-[-0.02em]">
          {parseKey(date).d}일 {WEEKDAYS[dowOf(date)]}요일에 추가
        </h2>
        <CloseButton onClick={onClose} className="shrink-0" />
      </div>

      {/* (#378) 일정 폼과 같은 카드 모양. 패널이 흰 면이라 카드는 바탕색(inset) */}
      <RowGroup inset className="mt-2">
        <NameField
          id={`${ids}-title`}
          label="제목"
          autoFocus
          placeholder="무슨 일정인가요?"
          value={title}
          onChange={(v) => dispatch({ type: "title", value: v })}
          error={titleError}
          errorId={`${ids}-title-err`}
          enterKeyHint="done"
          autoComplete="off"
        />
      </RowGroup>

      <RowGroup inset className="mt-2">
        <ToggleRow label="종일" checked={allDay} onChange={(v) => dispatch({ type: "allDay", value: v })} />
        {!allDay && (
          <div className="flex min-h-12 items-center gap-2 py-1.5">
            <span aria-hidden="true" className="shrink-0 text-[14px] text-ink-2">
              시간
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <TimePicker
                id={`${ids}-start`}
                look="chipInset"
                label="시작 시각"
                value={start}
                onChange={changeStart}
                to={23 * 60 + 30}
                inlineOpen={timeOpen === "start"}
                onInlineToggle={() => setTimeOpen((o) => (o === "start" ? null : "start"))}
              />
              <span aria-hidden="true" className="text-ink-2">
                ~
              </span>
              <TimePicker
                id={`${ids}-end`}
                look="chipInset"
                label="종료 시각"
                value={end}
                onChange={changeEnd}
                allow24
                inlineOpen={timeOpen === "end"}
                onInlineToggle={() => setTimeOpen((o) => (o === "end" ? null : "end"))}
                aria-invalid={Boolean(rangeError)}
                aria-describedby={rangeError ? `${ids}-range-err` : undefined}
              />
            </div>
          </div>
        )}
        {!allDay && timeOpen && (
          <div className="py-1.5">
            <TimeList
              key={timeOpen}
              value={timeOpen === "start" ? start : end}
              to={timeOpen === "start" ? 23 * 60 + 30 : undefined}
              allow24={timeOpen === "end"}
              listClassName="max-h-[200px]"
              onPick={(v) => {
                if (timeOpen === "start") changeStart(v);
                else changeEnd(v);
                closeTime();
              }}
              onClose={closeTime}
            />
          </div>
        )}
        <div>
          <RowButton
            label="알림"
            icon={<IconBell size={18} />}
            value={REMINDER_LABEL[reminder]}
            onClick={() => setReminderOpen((o) => !o)}
            aria-expanded={reminderOpen}
          />
          {reminderOpen && (
            <ReminderInline
              allDay={allDay}
              value={reminder}
              onPick={(v) => {
                dispatch({ type: "reminder", value: v });
                setReminderOpen(false);
                // 권한 안내 시트 계기 ② (8-1)
                if (v !== "NONE") void maybeOpenPushPrompt();
              }}
            />
          )}
        </div>
      </RowGroup>
      {rangeError && (
        <InlineError id={`${ids}-range-err`} className="mt-1.5">
          {rangeError}
        </InlineError>
      )}
      {saveError && <InlineError className="mt-2">{saveError}</InlineError>}

      {/* 자세히 | 추가 (새로 만들면 "추가", 입력 화면 규칙 5) */}
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="secondary" size="xl" onClick={more} className="basis-[30%] shrink-0 px-4">
          자세히
        </Button>
        <Button type="submit" size="xl" full loading={create.isPending} className="min-w-0 flex-1">
          추가
        </Button>
      </div>
    </form>
  );
}
