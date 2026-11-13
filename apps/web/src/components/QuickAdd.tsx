"use client";
// 달력에서 바로 일정 추가 (#46). 폴더블.md 5-2 부터는 날짜 상세(DayPanel) 의 "이 날 일정 추가" 가 같은 자리에서 이 폼으로 바뀐다.
// 날짜 칸을 누르면 바로 열리던 경로(모바일 재탭, PC 빈 곳 클릭)는 없앴다. 바로 추가는 + 버튼이 맡는다.
// 필드: 제목, 종일, 시작/종료 시각. 저장은 useCreateEvent, "자세히" 는 새 일정 폼으로 값을 넘긴다.
import { useRouter } from "next/navigation";
import { newEventHref } from "@/lib/routes";
import { useId, useState } from "react";
import { IconChevronLeft } from "./icons";
import { TimeList, TimePicker } from "./pickers";
import { ReminderInline, ReminderNote } from "./ReminderPicker";
import { Button, CloseButton, InlineError, RowButton, Toggle, captionClass, titleInputClass } from "./ui";
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
        <button type="button" onClick={onBack} aria-label="날짜 상세로" className="hit -ml-2 flex size-8 shrink-0 items-center rounded-sm pl-0.5 text-ink-2 hover:bg-hover hover:text-ink">
          <IconChevronLeft size={18} />
        </button>
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-[18px] font-bold leading-6 tracking-[-0.02em]">
          {parseKey(date).d}일 {WEEKDAYS[dowOf(date)]}요일에 추가
        </h2>
        <CloseButton onClick={onClose} className="shrink-0" />
      </div>

      <label htmlFor={`${ids}-title`} className="sr-only">
        제목
      </label>
      <input
        id={`${ids}-title`}
        autoFocus
        className={`${titleInputClass} mt-2`}
        placeholder="무슨 일정인가요?"
        value={title}
        onChange={(e) => dispatch({ type: "title", value: e.target.value })}
        aria-invalid={Boolean(titleError)}
        aria-describedby={titleError ? `${ids}-title-err` : undefined}
        enterKeyHint="done"
      />
      {titleError && (
        <InlineError id={`${ids}-title-err`} className="mt-1.5">
          {titleError}
        </InlineError>
      )}

      <div className="mt-2">
        <Toggle checked={allDay} onChange={(v) => dispatch({ type: "allDay", value: v })} label="종일" />
        {!allDay && (
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line pt-2.5">
            <div>
              <span className={captionClass}>시작</span>
              <TimePicker
                id={`${ids}-start`}
                label="시작 시각"
                value={start}
                onChange={changeStart}
                to={23 * 60 + 30}
                inlineOpen={timeOpen === "start"}
                onInlineToggle={() => setTimeOpen((o) => (o === "start" ? null : "start"))}
              />
            </div>
            <div>
              <span className={captionClass}>종료</span>
              <TimePicker
                id={`${ids}-end`}
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
          <div className="mt-2 rounded-sm border border-line p-1.5">
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
      </div>
      <div className="mt-2 border-t border-line pt-1">
        <RowButton
          label="알림"
          value={REMINDER_LABEL[reminder]}
          chevron={false}
          onClick={() => setReminderOpen((o) => !o)}
          aria-expanded={reminderOpen}
          className="rounded-sm"
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
        <ReminderNote className="-mt-1" />
      </div>
      {rangeError && (
        <InlineError id={`${ids}-range-err`} className="mt-1.5">
          {rangeError}
        </InlineError>
      )}
      {saveError && <InlineError className="mt-2">{saveError}</InlineError>}

      <div className="mt-3 flex gap-2">
        <Button type="button" variant="secondary" size="lg" onClick={more} className="shrink-0 px-4">
          자세히
        </Button>
        <Button type="submit" size="lg" full loading={create.isPending}>
          저장
        </Button>
      </div>
    </form>
  );
}
